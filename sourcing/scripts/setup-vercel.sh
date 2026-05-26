#!/usr/bin/env bash
# Sourcing(광고 성과 분석기) Vercel 프로젝트 자동 셋업 스크립트
#
# 사용법:
#   1) https://vercel.com/account/tokens 에서 토큰 발급 (Expiration 1 day 권장)
#   2) 이 스크립트를 본인 노트북에서 실행 (이 환경이 아닌 로컬 터미널!)
#      bash sourcing/scripts/setup-vercel.sh
#   3) 토큰 + Supabase 값 입력
#
# 필요 도구: curl, jq (대부분 맥/리눅스 기본 설치, 없으면 brew install jq)

set -euo pipefail

TEAM_ID="team_hZWnXK5iu9U2VO870fgnXxpi"
GITHUB_REPO="kyw1984-code/hoonpro"
GITHUB_REPO_ID="1178563725"
PROJECT_NAME="hoonproad"
ROOT_DIR="sourcing"
PROD_BRANCH="main"

API="https://api.vercel.com"

# ─── 사전 확인 ─────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || { echo "❌ $1 가 필요합니다."; exit 1; }; }
need curl
need jq

# ─── 입력 받기 ─────────────────────────────────────────────
if [ -z "${VERCEL_TOKEN:-}" ]; then
  read -rsp "Vercel Token: " VERCEL_TOKEN; echo
fi
if [ -z "$VERCEL_TOKEN" ]; then echo "❌ VERCEL_TOKEN 필요"; exit 1; fi

if [ -z "${SUPABASE_URL:-}" ]; then
  read -rp "SUPABASE_URL (예: https://xxxx.supabase.co): " SUPABASE_URL
fi
if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  read -rsp "SUPABASE_SERVICE_KEY: " SUPABASE_SERVICE_KEY; echo
fi
if [ -z "${JWT_SECRET:-}" ]; then
  read -rsp "JWT_SECRET (엔터 = 자동 생성): " JWT_SECRET; echo
  if [ -z "$JWT_SECRET" ]; then
    if command -v openssl >/dev/null 2>&1; then
      JWT_SECRET=$(openssl rand -hex 32)
    else
      JWT_SECRET=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
    fi
    echo "🔐 JWT_SECRET 자동 생성됨 (보관용): $JWT_SECRET"
  fi
fi

AUTH_H=(-H "Authorization: Bearer $VERCEL_TOKEN")
JSON_H=(-H "Content-Type: application/json")

# ─── 토큰 검증 ─────────────────────────────────────────────
echo "🔍 Vercel 토큰 검증 중..."
WHOAMI=$(curl -sS "${AUTH_H[@]}" "$API/v2/user")
USER_NAME=$(echo "$WHOAMI" | jq -r '.user.username // .username // empty')
if [ -z "$USER_NAME" ]; then
  echo "❌ 토큰 유효하지 않음:"; echo "$WHOAMI" | jq .; exit 1
fi
echo "✅ 인증 성공 — $USER_NAME"

# ─── 중복 프로젝트 확인 ────────────────────────────────────
EXISTING=$(curl -sS "${AUTH_H[@]}" "$API/v9/projects/$PROJECT_NAME?teamId=$TEAM_ID")
EXISTING_ID=$(echo "$EXISTING" | jq -r '.id // empty')
if [ -n "$EXISTING_ID" ]; then
  echo "⚠️  '$PROJECT_NAME' 프로젝트가 이미 존재합니다 (id=$EXISTING_ID)."
  read -rp "계속해서 환경변수만 갱신/추가할까요? (y/N): " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { echo "중단됨."; exit 0; }
  PROJECT_ID="$EXISTING_ID"
  SKIP_CREATE=1
else
  SKIP_CREATE=0
fi

# ─── 프로젝트 생성 ─────────────────────────────────────────
if [ "$SKIP_CREATE" -eq 0 ]; then
  echo "🚀 Vercel 프로젝트 생성 중 ($PROJECT_NAME)..."
  CREATE_BODY=$(jq -n \
    --arg name "$PROJECT_NAME" \
    --arg root "$ROOT_DIR" \
    --arg repo "$GITHUB_REPO" \
    '{
      name: $name,
      framework: "vite",
      rootDirectory: $root,
      installCommand: "npm install",
      buildCommand: "npm run build",
      outputDirectory: "dist",
      gitRepository: { type: "github", repo: $repo }
    }')

  CREATE_RES=$(curl -sS -X POST "${AUTH_H[@]}" "${JSON_H[@]}" \
    "$API/v11/projects?teamId=$TEAM_ID" -d "$CREATE_BODY")

  PROJECT_ID=$(echo "$CREATE_RES" | jq -r '.id // empty')
  if [ -z "$PROJECT_ID" ]; then
    echo "❌ 프로젝트 생성 실패:"; echo "$CREATE_RES" | jq .; exit 1
  fi
  echo "✅ 프로젝트 생성 — id=$PROJECT_ID"
fi

# ─── 환경변수 등록 ─────────────────────────────────────────
upsert_env() {
  local KEY="$1" VAL="$2"
  local BODY
  BODY=$(jq -n --arg k "$KEY" --arg v "$VAL" '{
    key: $k, value: $v, type: "encrypted",
    target: ["production","preview","development"]
  }')
  RES=$(curl -sS -X POST "${AUTH_H[@]}" "${JSON_H[@]}" \
    "$API/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" -d "$BODY")
  local OK
  OK=$(echo "$RES" | jq -r '.created[0].key // .key // empty')
  if [ -n "$OK" ]; then
    echo "  ✓ $KEY"
  else
    local ERR
    ERR=$(echo "$RES" | jq -r '.error.message // .message // "unknown"')
    if echo "$ERR" | grep -qi "already exists"; then
      echo "  ↻ $KEY 이미 존재 (건너뜀)"
    else
      echo "  ✗ $KEY 실패: $ERR"
    fi
  fi
}

echo "🔑 환경변수 등록 중..."
upsert_env "SUPABASE_URL"         "$SUPABASE_URL"
upsert_env "SUPABASE_SERVICE_KEY" "$SUPABASE_SERVICE_KEY"
upsert_env "JWT_SECRET"           "$JWT_SECRET"

# ─── 배포 트리거 ───────────────────────────────────────────
echo "🚢 main 브랜치로 프로덕션 배포 트리거..."
DEPLOY_BODY=$(jq -n \
  --arg name "$PROJECT_NAME" \
  --arg repoId "$GITHUB_REPO_ID" \
  --arg ref "$PROD_BRANCH" \
  '{
    name: $name,
    target: "production",
    gitSource: { type: "github", repoId: ($repoId|tonumber), ref: $ref }
  }')

DEPLOY_RES=$(curl -sS -X POST "${AUTH_H[@]}" "${JSON_H[@]}" \
  "$API/v13/deployments?teamId=$TEAM_ID&forceNew=1" -d "$DEPLOY_BODY")

DEPLOY_URL=$(echo "$DEPLOY_RES" | jq -r '.url // empty')
DEPLOY_ID=$(echo "$DEPLOY_RES" | jq -r '.id // empty')
if [ -n "$DEPLOY_URL" ]; then
  echo "✅ 배포 시작됨"
  echo "   ID:        $DEPLOY_ID"
  echo "   배포 URL:  https://$DEPLOY_URL"
  echo "   대시보드:  https://vercel.com/kyw1984-codes-projects/$PROJECT_NAME"
  echo "   별칭:      https://$PROJECT_NAME.vercel.app  (배포 완료 후 자동 매핑)"
else
  echo "⚠️  배포 트리거 응답:"; echo "$DEPLOY_RES" | jq .
  echo "   → 빌드는 'git push' 시 자동으로 트리거됩니다 (gitRepository가 연결됐다면)."
fi

echo
echo "🎉 완료!"
echo "   다음 단계: Supabase SQL Editor에서 sourcing/supabase-schema.sql 실행"
echo "   배포 진행 상황: https://vercel.com/kyw1984-codes-projects/$PROJECT_NAME"
