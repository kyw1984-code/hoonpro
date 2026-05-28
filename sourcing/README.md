# 쿠팡 광고 성과 분석기 (Sourcing)

훈프로 메인 앱에서 광고 성과 분석 기능만 분리한 독립 프로젝트입니다.
가입 즉시 7일 무료 체험을 제공합니다.

## 배포 (Vercel)

### 방법 A — 자동화 스크립트 (권장)

본인 노트북 터미널에서 한 줄만 실행:

```bash
git pull
bash sourcing/scripts/setup-vercel.sh
```

스크립트가 묻는 값:
- Vercel Token — https://vercel.com/account/tokens 에서 발급 (1 day 만료 권장)
- SUPABASE_URL / SUPABASE_SERVICE_KEY — 기존 hoonpro Vercel 프로젝트와 동일
- JWT_SECRET — 엔터 치면 자동 생성

스크립트가 자동으로 처리하는 것:
- Vercel 프로젝트 `hoonproad` 생성 (Root Directory = `sourcing`, Framework = Vite)
- GitHub 저장소 `kyw1984-code/hoonpro` 연결
- 환경변수 3종 등록
- main 브랜치로 프로덕션 배포 트리거

### 방법 B — 원클릭 Deploy Button

다음 링크를 클릭하면 Vercel 가져오기 화면이 열립니다.
환경변수는 자동 프롬프트되며, **Root Directory만 수동으로 `sourcing` 입력 필요**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkyw1984-code%2Fhoonpro&project-name=hoonproad&env=SUPABASE_URL,SUPABASE_SERVICE_KEY,JWT_SECRET&envDescription=hoonpro%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%EC%99%80%20%EB%8F%99%EC%9D%BC%ED%95%9C%20%EA%B0%92%20%EC%82%AC%EC%9A%A9)

### 모든 방법 공통 — Supabase 테이블 생성

배포 후 한 번만 실행:
- https://supabase.com/dashboard → 기존 hoonpro 프로젝트 → SQL Editor
- `sourcing/supabase-schema.sql` 내용 복붙 → Run

## 로컬 실행

```bash
cd sourcing
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:3001
```

## 7일 체험 흐름

- 가입 → `sourcing_users.trial_started_at = now()` 기록 후 즉시 JWT 발급
- JWT 만료 시간 = `trial_started_at + 7일`
- 로그인 시 만료된 사용자는 차단
- 헤더에 "체험 N일 남음" 배지 표시
