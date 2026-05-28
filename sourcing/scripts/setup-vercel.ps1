# Sourcing(광고 성과 분석기) Vercel 프로젝트 자동 셋업 (Windows PowerShell 버전)
#
# 사용법 (PowerShell 에서):
#   irm https://raw.githubusercontent.com/kyw1984-code/hoonpro/main/sourcing/scripts/setup-vercel.ps1 -OutFile setup-vercel.ps1
#   .\setup-vercel.ps1
#
# 또는 git clone 후:
#   .\sourcing\scripts\setup-vercel.ps1

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$TeamId       = "team_hZWnXK5iu9U2VO870fgnXxpi"
$GitHubRepo   = "kyw1984-code/hoonpro"
$GitHubRepoId = 1178563725
$ProjectName  = "hoonproad"
$RootDir      = "sourcing"
$ProdBranch   = "main"
$Api          = "https://api.vercel.com"

function Read-Secret($prompt) {
  $sec = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# ─── 입력 ──────────────────────────────────────────────────
if ($env:VERCEL_TOKEN) { $VercelToken = $env:VERCEL_TOKEN }
else { $VercelToken = Read-Secret "Vercel Token (https://vercel.com/account/tokens 에서 발급)" }
if (-not $VercelToken) { Write-Host "❌ Vercel 토큰 필요" -ForegroundColor Red; exit 1 }

$SupabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { Read-Host "SUPABASE_URL (예: https://xxxx.supabase.co)" }
$SupabaseKey = if ($env:SUPABASE_SERVICE_KEY) { $env:SUPABASE_SERVICE_KEY } else { Read-Secret "SUPABASE_SERVICE_KEY" }
$JwtSecret   = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { Read-Secret "JWT_SECRET (엔터 = 자동 생성)" }

if (-not $JwtSecret) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JwtSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Write-Host "🔐 자동 생성된 JWT_SECRET (보관용): $JwtSecret" -ForegroundColor Yellow
}

$Headers = @{
  "Authorization" = "Bearer $VercelToken"
  "Content-Type"  = "application/json"
}

# ─── 헬퍼 ──────────────────────────────────────────────────
function Get-ApiError($exception) {
  if ($exception.ErrorDetails.Message) {
    try { return ($exception.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { return $exception.ErrorDetails.Message }
  }
  return $exception.Exception.Message
}

# ─── 토큰 검증 ─────────────────────────────────────────────
Write-Host "🔍 Vercel 토큰 검증 중..."
try {
  $me = Invoke-RestMethod -Uri "$Api/v2/user" -Headers $Headers -Method Get
  $userName = if ($me.user.username) { $me.user.username } else { $me.username }
  Write-Host "✅ 인증 성공 — $userName" -ForegroundColor Green
} catch {
  Write-Host "❌ 토큰 유효하지 않음: $(Get-ApiError $_)" -ForegroundColor Red
  exit 1
}

# ─── 중복 프로젝트 확인 ────────────────────────────────────
$ExistingId = $null
try {
  $existing = Invoke-RestMethod -Uri "$Api/v9/projects/${ProjectName}?teamId=$TeamId" -Headers $Headers -Method Get -ErrorAction Stop
  $ExistingId = $existing.id
} catch {
  # 404 = 없음, 계속 진행
}

if ($ExistingId) {
  Write-Host "⚠️  '$ProjectName' 프로젝트가 이미 존재합니다 (id=$ExistingId)." -ForegroundColor Yellow
  $yn = Read-Host "환경변수만 갱신/추가 진행할까요? (y/N)"
  if ($yn -notmatch '^[Yy]$') { Write-Host "중단됨."; exit 0 }
  $ProjectId = $ExistingId
} else {
  Write-Host "🚀 Vercel 프로젝트 생성 중 ($ProjectName)..."
  $createBody = @{
    name            = $ProjectName
    framework       = "vite"
    rootDirectory   = $RootDir
    installCommand  = "npm install"
    buildCommand    = "npm run build"
    outputDirectory = "dist"
    gitRepository   = @{ type = "github"; repo = $GitHubRepo }
  } | ConvertTo-Json -Depth 5

  try {
    $created = Invoke-RestMethod -Uri "$Api/v11/projects?teamId=$TeamId" -Headers $Headers -Method Post -Body $createBody
    $ProjectId = $created.id
    Write-Host "✅ 프로젝트 생성 — id=$ProjectId" -ForegroundColor Green
  } catch {
    Write-Host "❌ 프로젝트 생성 실패: $(Get-ApiError $_)" -ForegroundColor Red
    exit 1
  }
}

# ─── 환경변수 등록 ─────────────────────────────────────────
function Upsert-Env($key, $value) {
  $body = @{
    key    = $key
    value  = $value
    type   = "encrypted"
    target = @("production","preview","development")
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "$Api/v10/projects/$ProjectId/env?teamId=$TeamId&upsert=true" -Headers $Headers -Method Post -Body $body | Out-Null
    Write-Host "  ✓ $key" -ForegroundColor Green
  } catch {
    $msg = Get-ApiError $_
    if ($msg -match "already exists") {
      Write-Host "  ↻ $key 이미 존재 (건너뜀)" -ForegroundColor Yellow
    } else {
      Write-Host "  ✗ $key 실패: $msg" -ForegroundColor Red
    }
  }
}

Write-Host "🔑 환경변수 등록 중..."
Upsert-Env "SUPABASE_URL"         $SupabaseUrl
Upsert-Env "SUPABASE_SERVICE_KEY" $SupabaseKey
Upsert-Env "JWT_SECRET"           $JwtSecret

# ─── 배포 트리거 ───────────────────────────────────────────
Write-Host "🚢 main 브랜치로 프로덕션 배포 트리거..."
$deployBody = @{
  name      = $ProjectName
  target    = "production"
  gitSource = @{ type = "github"; repoId = $GitHubRepoId; ref = $ProdBranch }
} | ConvertTo-Json -Depth 5

try {
  $deploy = Invoke-RestMethod -Uri "$Api/v13/deployments?teamId=$TeamId&forceNew=1" -Headers $Headers -Method Post -Body $deployBody
  Write-Host "✅ 배포 시작됨" -ForegroundColor Green
  Write-Host "   ID:       $($deploy.id)"
  Write-Host "   배포 URL: https://$($deploy.url)"
  Write-Host "   대시보드: https://vercel.com/kyw1984-codes-projects/$ProjectName"
  Write-Host "   별칭:     https://$ProjectName.vercel.app  (배포 완료 후 자동 매핑)"
} catch {
  $msg = Get-ApiError $_
  Write-Host "⚠️  배포 트리거 응답: $msg" -ForegroundColor Yellow
  Write-Host "   → main 브랜치에 sourcing/ 폴더가 없을 수 있습니다." -ForegroundColor Yellow
  Write-Host "      git push 로 main 에 sourcing/ 합치면 자동 배포됩니다." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🎉 완료!" -ForegroundColor Green
Write-Host "   다음 단계: Supabase SQL Editor 에서 sourcing/supabase-schema.sql 실행"
Write-Host "   대시보드: https://vercel.com/kyw1984-codes-projects/$ProjectName"
