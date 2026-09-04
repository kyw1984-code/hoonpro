# 기존 수강생용 버전 (legacy)

이 브랜치는 **기존 수강생 전용 버전**입니다. `hoonpro.vercel.app`에서 서비스합니다.

- 기준 커밋: `18f2a0a` (2026-06-24) — 앱 코드는 이 시점 그대로이며 수정하지 않습니다
- 유료화(구독·결제·쿠폰) 기능이 없고, 로그인은 이메일만으로 이루어집니다
- **Supabase는 유료 버전과 분리된 별도 프로젝트**를 사용합니다
  (테이블: `users` · `api_usage` · `api_calls` · `app_config`)
- `JWT_SECRET`은 유료 버전과 반드시 다른 값을 씁니다

유료 버전(`hoonproai.com`)은 `main` 브랜치입니다. 두 버전은 DB와 배포가 완전히 분리되어 있으므로,
이 브랜치에 유료 버전의 변경사항을 병합하지 마세요.

## 배포 설정

| 항목 | 값 |
|---|---|
| Vercel 프로젝트 | `hoonpro-lecgacy` |
| Root Directory | `./` — **`sourcing`이 아닙니다** |
| Production Branch | `legacy-2026-06` |
| 서비스 주소 | `hoonpro.vercel.app` |

서버리스 함수는 **12개**가 나와야 정상입니다. 5개로 나오면 Root Directory가
`sourcing`(별개의 소싱 분석기 앱)으로 잘못 잡힌 것입니다.

이 브랜치는 배포하려면 **커밋을 푸시해야** 합니다. Vercel의 Redeploy는 같은 커밋을
다시 빌드할 뿐이라 브랜치 전환이 반영되지 않습니다.
