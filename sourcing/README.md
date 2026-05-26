# 쿠팡 광고 성과 분석기 (Sourcing)

훈프로 메인 앱에서 광고 성과 분석 기능만 분리한 독립 프로젝트입니다.
가입 즉시 7일 무료 체험을 제공합니다.

## 배포 (Vercel)

1. **New Project** 생성 후 이 저장소(`kyw1984-code/hoonpro`) 선택
2. **Root Directory**: `sourcing` 지정
3. Build/Output 설정은 기본값 사용 (Vite 자동 감지)
4. **Domains** 에 `hoonproad.vercel.app` 추가
5. **Environment Variables** 등록:
   - `SUPABASE_URL` — 기존 hoonpro 와 동일한 값
   - `SUPABASE_SERVICE_KEY` — 기존 hoonpro 와 동일한 값
   - `JWT_SECRET` — 임의의 긴 문자열 (hoonpro 와 달라도 무방)
6. Supabase SQL Editor 에서 `supabase-schema.sql` 한 번 실행 (sourcing_users 테이블 생성)

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
