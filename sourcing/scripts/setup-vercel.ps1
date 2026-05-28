# Sourcing (Ad Performance Analyzer) Vercel auto-setup script (PowerShell)
#
# Usage:
#   irm https://raw.githubusercontent.com/kyw1984-code/hoonpro/main/sourcing/scripts/setup-vercel.ps1 -OutFile setup-vercel.ps1
#   .\setup-vercel.ps1

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

# --- Inputs ---
if ($env:VERCEL_TOKEN) { $VercelToken = $env:VERCEL_TOKEN }
else { $VercelToken = Read-Secret "Vercel Token (from https://vercel.com/account/tokens)" }
if (-not $VercelToken) { Write-Host "ERROR: Vercel token required" -ForegroundColor Red; exit 1 }

$SupabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { Read-Host "SUPABASE_URL (e.g. https://xxxx.supabase.co)" }
$SupabaseKey = if ($env:SUPABASE_SERVICE_KEY) { $env:SUPABASE_SERVICE_KEY } else { Read-Secret "SUPABASE_SERVICE_KEY" }
$JwtSecret   = if ($env:JWT_SECRET) { $env:JWT_SECRET } else { Read-Secret "JWT_SECRET (press Enter to auto-generate)" }

if (-not $JwtSecret) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JwtSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Write-Host "[INFO] Auto-generated JWT_SECRET (save this): $JwtSecret" -ForegroundColor Yellow
}

$Headers = @{
  "Authorization" = "Bearer $VercelToken"
  "Content-Type"  = "application/json"
}

function Get-ApiError($exception) {
  if ($exception.ErrorDetails.Message) {
    try { return ($exception.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { return $exception.ErrorDetails.Message }
  }
  return $exception.Exception.Message
}

# --- Verify token ---
Write-Host "[1/4] Verifying Vercel token..."
try {
  $me = Invoke-RestMethod -Uri "$Api/v2/user" -Headers $Headers -Method Get
  $userName = if ($me.user.username) { $me.user.username } else { $me.username }
  Write-Host "      OK - authenticated as $userName" -ForegroundColor Green
} catch {
  Write-Host "      FAIL - $(Get-ApiError $_)" -ForegroundColor Red
  exit 1
}

# --- Check for existing project ---
$ExistingId = $null
try {
  $existing = Invoke-RestMethod -Uri "$Api/v9/projects/${ProjectName}?teamId=$TeamId" -Headers $Headers -Method Get -ErrorAction Stop
  $ExistingId = $existing.id
} catch {
  # 404 means not found, that's fine
}

if ($ExistingId) {
  Write-Host "[2/4] Project '$ProjectName' already exists (id=$ExistingId)" -ForegroundColor Yellow
  $yn = Read-Host "      Continue and just upsert env vars? (y/N)"
  if ($yn -notmatch '^[Yy]$') { Write-Host "Aborted."; exit 0 }
  $ProjectId = $ExistingId
} else {
  Write-Host "[2/4] Creating Vercel project '$ProjectName'..."
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
    Write-Host "      OK - id=$ProjectId" -ForegroundColor Green
  } catch {
    Write-Host "      FAIL - $(Get-ApiError $_)" -ForegroundColor Red
    exit 1
  }
}

# --- Upsert env vars ---
function Upsert-Env($key, $value) {
  $body = @{
    key    = $key
    value  = $value
    type   = "encrypted"
    target = @("production","preview","development")
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "$Api/v10/projects/$ProjectId/env?teamId=$TeamId&upsert=true" -Headers $Headers -Method Post -Body $body | Out-Null
    Write-Host "      OK  $key" -ForegroundColor Green
  } catch {
    $msg = Get-ApiError $_
    if ($msg -match "already exists") {
      Write-Host "      SKIP  $key (already exists)" -ForegroundColor Yellow
    } else {
      Write-Host "      FAIL  $key - $msg" -ForegroundColor Red
    }
  }
}

Write-Host "[3/4] Upserting environment variables..."
Upsert-Env "SUPABASE_URL"         $SupabaseUrl
Upsert-Env "SUPABASE_SERVICE_KEY" $SupabaseKey
Upsert-Env "JWT_SECRET"           $JwtSecret

# --- Trigger deployment ---
Write-Host "[4/4] Triggering production deployment from branch '$ProdBranch'..."
$deployBody = @{
  name      = $ProjectName
  target    = "production"
  gitSource = @{ type = "github"; repoId = $GitHubRepoId; ref = $ProdBranch }
} | ConvertTo-Json -Depth 5

try {
  $deploy = Invoke-RestMethod -Uri "$Api/v13/deployments?teamId=$TeamId&forceNew=1" -Headers $Headers -Method Post -Body $deployBody
  Write-Host "      OK - deployment started" -ForegroundColor Green
  Write-Host "      ID:        $($deploy.id)"
  Write-Host "      Build URL: https://$($deploy.url)"
  Write-Host "      Dashboard: https://vercel.com/kyw1984-codes-projects/$ProjectName"
  Write-Host "      Alias:     https://$ProjectName.vercel.app  (mapped after build succeeds)"
} catch {
  $msg = Get-ApiError $_
  Write-Host "      WARN - deploy trigger response: $msg" -ForegroundColor Yellow
  Write-Host "      Hint: branch 'main' may not have sourcing/ yet." -ForegroundColor Yellow
  Write-Host "      Merge claude/nice-heisenberg-e2KmU to main, or change Production Branch" -ForegroundColor Yellow
  Write-Host "      in Vercel dashboard: Settings -> Git -> Production Branch."  -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Next: run sourcing/supabase-schema.sql in Supabase SQL Editor."
Write-Host "Dashboard: https://vercel.com/kyw1984-codes-projects/$ProjectName"
