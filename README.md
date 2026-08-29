<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a17ce62f-04f4-4186-982d-2862e19a3db1

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## 소싱 파인더 설정

네이버 검색광고 API 기반 니치 키워드 발굴 도구. 필요한 환경변수 3개:

| 변수 | 발급 위치 |
|---|---|
| `NAVER_AD_API_KEY` | searchad.naver.com → 광고시스템 → 도구 → API 사용관리 (액세스라이선스) |
| `NAVER_AD_SECRET_KEY` | 같은 페이지의 비밀키 |
| `NAVER_AD_CUSTOMER_ID` | 광고시스템 접속 시 주소창 `customers/` 뒤 숫자 (API 사용관리 페이지에도 표시) |

응답 캐시용 Supabase 테이블은 `supabase-schema.sql`의 `sourcing_cache` 항목 참고.
