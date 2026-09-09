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

## 훈프로 소싱AI (소싱 파인더) 설정

네이버 검색광고 API 기반 니치 키워드 발굴 도구. 필요한 환경변수 3개:

| 변수 | 발급 위치 |
|---|---|
| `NAVER_AD_API_KEY` | searchad.naver.com → 광고시스템 → 도구 → API 사용관리 (액세스라이선스) |
| `NAVER_AD_SECRET_KEY` | 같은 페이지의 비밀키 |
| `NAVER_AD_CUSTOMER_ID` | 광고시스템 접속 시 주소창 `customers/` 뒤 숫자 (API 사용관리 페이지에도 표시) |

응답 캐시용 Supabase 테이블은 `supabase-schema.sql`의 `sourcing_cache` 항목 참고.

## 쿠팡 윙 Open API 연동

판매자가 자기 윙 API 키를 등록하면 매출·수수료·정산·재고·반품·문의를 매일 자동 수집해
상품별 순이익, 정산 캐시플로, 재고 소진 예측, 반품 손실, 고객문의 AI 답변, 순위와 판매의
상관, 마진 하한 가격 조정을 제공합니다.

설치와 운영 안내는 [docs/coupang-wing-setup.md](docs/coupang-wing-setup.md)를 참고하세요.
두 가지만 미리 알아두면 됩니다.

- **키는 업체코드당 1개뿐입니다.** 다른 주문수집 프로그램을 쓰는 판매자가 재발급하면 그쪽
  연동이 끊깁니다. 기존 키를 그대로 등록하게 안내합니다.
- **쿠팡은 등록된 IP에서만 호출을 받습니다.** Vercel은 고정 IP가 없으므로
  `scripts/coupang-relay.mjs`를 고정 IP 서버에 띄우고 그 IP를 윙에 등록해야 합니다.
  월 5달러짜리 최소 VPS면 충분하고, 이 비용은 사용자 수와 무관하게 한 번만 듭니다.

## 배포 (Vercel)

`main`에 올라간 것만 빌드합니다. 작업 브랜치 푸시는 `vercel.json`의 `ignoreCommand`가
빌드를 건너뜁니다.

```
main 브랜치        → 빌드
그 외 브랜치 푸시  → 건너뜀 (배포 기록만 남고 빌드 CPU를 쓰지 않음)
```

요금에서 실제로 비용이 나가는 항목은 **빌드 CPU 분**이고 나머지(함수 호출·전송량)는
사실상 0입니다. PR 하나를 머지하면 운영 배포 + 브랜치 동기화 푸시로 빌드가 두 번
돌던 것을, 이 설정으로 한 번만 돌게 했습니다.

프리뷰 URL로 확인이 필요한 브랜치가 생기면 `ignoreCommand`의 조건에 그 브랜치 이름을
추가하면 됩니다.
