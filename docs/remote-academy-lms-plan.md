# 훈프로 원격학원 홈페이지·LMS 자체 구축 상세 기획안

> 2026.09 작성 — 라이브클래스(동영상 시청 + 수강생 모집) 대체를 위한 자체 홈페이지·LMS 구축 계획.
> 전제: 원격학원 등록 사업자 · 운영/관리는 대표가 직접 · 스택은 기존 훈프로(Vite/React · Vercel · Supabase · 토스페이먼츠 · 포트원 PASS) 재사용.
> 모든 외부 서비스 요금은 2026.09 시점의 공개 요금표 기준 근사치이며, 환율 1,380원/USD로 환산했다. 계약 전 공식 요금 페이지를 재확인한다.

---

## 0. 결론 요약

| 질문 | 답 |
|------|----|
| 자체 구축이 가능한가 | **가능.** 필수 기능(진도율·배속 제한·백그라운드 감지·서명 URL 스트리밍·동적 워터마크·관리자 엑셀·PASS 본인인증·중복 로그인 차단)은 전부 표준 기술로 구현된다. 훈프로에 이미 있는 회원/결제/본인인증/엑셀 코드를 그대로 가져온다. |
| 초기 비용 | **직접 구축 시 10만 원 안팎** (도메인 + 본인인증 심사 초기비 + 선택 법률검토). 외주 시 1,500만~4,000만 원(국내 커스텀 LMS 시장 추정). 추천은 "직접 구축 + 플레이어·보안 부분만 전문가 검수(100만~300만 원, 선택)". |
| 월 운영 비용 (결제 수수료 제외) | **수강생 100명 ≈ 8만~16만 원 · 300명 ≈ 9만~30만 원 · 1,000명 ≈ 11만~76만 원.** 폭이 큰 이유는 영상 전송 요금(어떤 스트리밍 업체를 쓰느냐)이며, 고정비는 규모와 무관하게 월 7만 원 수준이다. |
| 결제 수수료 | 토스페이먼츠 일반결제 약 2~3.3% (영세·중소 우대 시 인하). 라이브클래스 수수료 대비 절감분이 곧 구축 이익. |
| 추천 영상 인프라 | **1순위 Bunny Stream**(가장 저렴, 토큰 인증 + 워터마크 + DRM 옵션), **2순위 Cloudflare Stream**(가장 단순, 분당 과금이라 규모 커지면 비쌈), **3순위 Cloudflare R2 + 자체 HLS 암호화**(운영비 거의 0, 구축 난도 최고). 인프라는 어댑터로 감싸서 교체 가능하게 설계한다. |
| 구축 기간 | 직접 구축 기준 **약 10주**(설계 1 · 회원/보안 2 · 플레이어/진도 3 · 관리자 2 · 결제/이관/QA 2). |

---

## 1. 배경과 목표

### 1.1 현재 상황

- 라이브클래스에서 ① 강의 동영상 시청 ② 수강생 모집(결제) 두 가지를 쓰고 있고, 이 두 가지가 핵심이다.
- 플랫폼 수수료(월 이용료 + 결제액 비례 수수료)가 부담이고, 원격학원 등록 사업자로서 진도·출결·본인확인 요건을 자체 시스템에서 통제해야 한다.
- 훈프로 SaaS(hoonpro)로 이미 회원가입·JWT 인증·토스 결제·포트원 PASS·Resend 이메일·엑셀 내보내기를 운영 중이므로 기술 리스크가 낮다.

### 1.2 목표

1. 라이브클래스의 동영상 시청·수강 판매 기능을 자체 사이트로 완전 대체한다.
2. 원격학원 LMS 필수 요건(진도율 기반 수료, 본인확인, 학습 기록 보존·조회)을 충족한다.
3. 영상 불법 복제·계정 공유를 실질적으로 억제한다(기술 차단 + 식별 워터마크 + 약관).
4. 운영자 1인이 관리 가능한 수준의 단순한 구조를 유지한다(관리자 화면 안에서 모든 일상 업무 처리).

### 1.3 범위

| 포함 | 제외 (추후) |
|------|-------------|
| 학원 홈페이지(과정 소개·모집), 회원/본인인증, 과정 구매(단건 결제), 강의실·플레이어, 진도율/수료, 관리자 대시보드·엑셀, Q&A·공지, 중복 로그인 차단, 워터마크 | 실시간 라이브 강의(줌 링크 안내로 대체), 커뮤니티/채팅, 모바일 앱(반응형 웹으로 충족), 시험/퀴즈 출제(2차), 정기 구독형 강의(필요 시 훈프로 빌링 코드 재사용) |

---

## 2. 비용

### 2.1 초기 비용

| 항목 | 금액 | 비고 |
|------|------|------|
| 도메인 | 1.5만~3만 원/년 | 예: `hoonpro-academy.com` 등. SSL은 Vercel 무료 |
| PASS 본인인증 심사 | 0~10만 원 | 포트원 경유 KCB/다날 심사 1~2주. 훈프로 유료화 기획에서 이미 진행 중이면 **같은 가맹점으로 공유 가능(추가 비용 0)** |
| 토스페이먼츠 | 0원 | 이미 가입·사용 중. 과정 판매는 일반결제(단건)라 빌링 심사 불필요 |
| 약관·환불규정 법률 검토 (선택) | 0~50만 원 | 학원법 교습비 반환기준 + 전자상거래법 청약철회 반영본. 초안은 직접 작성 후 검토만 의뢰 |
| 영상 인코딩/재업로드 | 0원 (작업 시간) | 라이브클래스 원본 다운로드 → 스트리밍 업체 업로드. 60시간 기준 1~2일 |
| 개발 — A. 직접 구축(AI 코딩) | 0원 | 훈프로와 같은 방식. 약 10주 |
| 개발 — B. 전액 외주 | 1,500만~4,000만 원 | 영상 보안·진도 로직 포함 국내 커스텀 LMS 시장 추정치. 이후 유지보수 월 30만~100만 원 별도 |
| 개발 — C. 직접 구축 + 핵심 검수 (추천) | 100만~300만 원 | 플레이어·토큰 발급·세션 로직만 프리랜서 보안 검수 1~2일 |
| 부하 테스트·디자인 템플릿 (선택) | 0~10만 원 | Tailwind 기반 자체 디자인으로 충분 |
| **합계 (A 또는 C 기준)** | **약 5만~15만 원 (+검수 시 최대 300만 원)** | |

### 2.2 월 운영 비용 — 고정비

| 항목 | 월 비용 | 비고 |
|------|---------|------|
| Vercel Pro | $20 ≈ 27,600원 | 서버리스 함수 한도·크론·대역폭. 훈프로가 이미 Pro면 같은 팀 안에 프로젝트만 추가(추가 비용 0) |
| Supabase Pro | $25 ≈ 34,500원 | 일일 백업·프로젝트 일시정지 방지·8GB DB. 학습 기록은 법적 보존 대상이라 **Free 플랜 비권장** |
| Resend (이메일) | $0~20 | 월 3,000통까지 무료 |
| Sentry (오류 모니터링) | $0 | 무료 티어 |
| 도메인 | ≈ 1,500원 | 연 요금 월할 |
| **고정비 합계** | **약 6.5만~9만 원** | Vercel/Supabase를 훈프로와 공유하면 약 3만 원까지 감소 |

### 2.3 월 운영 비용 — 변동비

| 항목 | 단가 | 발생 시점 |
|------|------|-----------|
| PASS 본인인증 | 건당 30~100원 | 가입 시 1회 |
| 알림톡/SMS | 알림톡 7~15원 · SMS 10~20원 | 수강 만료 예고, 수료 통보 등. 100명 × 월 5건 ≈ 5천 원 |
| 결제 수수료 | 매출의 약 2~3.3% | 토스 일반결제. 영세·중소 우대 신청 필수 |
| 영상 저장·전송 | 아래 2.4 | 시청량 비례 |

### 2.4 영상 인프라 비용 비교 (핵심 변동비)

**가정**: 총 강의 60시간(3,600분), 수강생 1인 월 평균 8시간(480분) 시청, 평균 전송 비트레이트 1.5Mbps(1분 ≈ 11MB).

| 규모 | 월 시청 분수 | 월 전송량 |
|------|-------------|-----------|
| 100명 | 48,000분 | ≈ 540GB |
| 300명 | 144,000분 | ≈ 1,620GB |
| 1,000명 | 480,000분 | ≈ 5,400GB |

| 업체 | 과금 기준 | 100명 | 300명 | 1,000명 | 보안 기능 | 평가 |
|------|-----------|-------|-------|---------|-----------|------|
| **Bunny Stream** | 저장 $0.01/GB · 전송 $0.005~0.01/GB | ≈ $4~9 (0.5만~1.3만 원) | ≈ $9~18 (1.3만~2.5만 원) | ≈ $28~56 (4만~8만 원) | 토큰 인증 URL(만료·IP 바인딩), 서버측 워터마크, MediaCage DRM 옵션(별도 과금), 서울 엣지 | **추천.** 압도적으로 저렴, 기능 충분. 영문 콘솔 |
| **Cloudflare Stream** | 저장 $5/1,000분 · 전송 $1/1,000분 | ≈ $66 (9만 원) | ≈ $162 (22만 원) | ≈ $498 (69만 원) | 서명 토큰(만료·IP 규칙), 도메인 제한, HLS/DASH 자동 | 가장 단순. 분당 과금이라 규모 커질수록 불리. DRM 없음 |
| **Mux** | 저장 $0.003/분 · 전송 $0.00096/분 | ≈ $57 (8만 원) | ≈ $149 (21만 원) | ≈ $472 (65만 원) | 서명 재생 토큰, Widevine/FairPlay DRM 옵션(별도) | Cloudflare와 유사 가격, DRM 필요 시 후보 |
| **Cloudflare R2 + 자체 HLS** | 저장 $0.015/GB · 전송 무료 · Workers $5 | ≈ $7 (1만 원) | ≈ $7 | ≈ $7~10 | ffmpeg로 HLS AES-128 암호화 직접 생성, 키 서버(Worker)가 JWT 검증 | 운영비 사실상 0. 인코딩·키 서버·플레이리스트 서명을 직접 구축해야 함 → 2단계 이전 후보 |
| 네이버클라우드 VOD Station + CDN | 트랜스코딩 분당 + 전송 GB당 수십~백 원대 | 수만 원 | 10만~20만 원 | 50만 원 이상 | Multi-DRM 패키지 제공 | 국내 서비스·한국어 지원. 해외 대비 5~10배 비쌈 |

**결정**: 1단계는 Bunny Stream. 코드에는 `VideoProvider` 인터페이스(업로드·토큰 발급·삭제·인코딩 상태)를 두고 Bunny/Cloudflare/R2 어댑터를 교체 가능하게 만든다. 전송량이 월 5TB를 넘고 운영 여력이 생기면 R2 자체 HLS로 이전을 검토한다.

### 2.5 규모별 월 운영비 총계 (결제 수수료 제외)

| 규모 | 고정비 | 영상(Bunny) | 영상(Cloudflare) | 본인인증·알림 | **합계 (Bunny)** | **합계 (Cloudflare)** |
|------|--------|-------------|------------------|---------------|------------------|-----------------------|
| 100명 | 7만 원 | 0.5만~1.3만 원 | 9만 원 | 0.5만~1만 원 | **약 8만~10만 원** | **약 16만 원** |
| 300명 | 7만 원 | 1.3만~2.5만 원 | 22만 원 | 1만~2만 원 | **약 9만~12만 원** | **약 30만 원** |
| 1,000명 | 7만 원 | 4만~8만 원 | 69만 원 | 3만~5만 원 | **약 14만~20만 원** | **약 76만 원** |

### 2.6 라이브클래스 대비 손익분기

```
월 절감액 = 라이브클래스 월 이용료
          + 월 결제액 × (라이브클래스 결제 수수료율 − 토스 수수료율 약 3.3%)
          − 자체 운영비(2.5)
```

예시(가정): 월 매출 300만 원, 라이브클래스 수수료 10%, 월 이용료 5만 원, 수강생 100명(Bunny)
→ 5만 + 300만 × (10% − 3.3%) − 9만 = **약 16만 원/월 절감**, 매출 1,000만 원이면 약 60만 원/월.
실제 라이브클래스 청구서의 요율을 넣어 다시 계산한다. 절감 외에 ① 수강생 데이터 완전 소유 ② 원격학원 요건에 맞는 진도 로직 자체 통제 ③ 훈프로 툴과의 연계(수강생 = 훈프로 무료 쿠폰 자동 발급)가 정성적 이익이다.

---

## 3. 기술 스택과 아키텍처

### 3.1 스택 (훈프로와 동일)

| 영역 | 선택 | 이유 |
|------|------|------|
| 프런트 | Vite + React 19 + Tailwind 4 | 훈프로 코드·컴포넌트 재사용 |
| 백엔드 | Vercel 서버리스 함수(`api/*.ts`, action 멀티플렉싱) | 함수 수 절약, 운영 무관리 |
| DB | Supabase Postgres (**별도 프로젝트**) | 학원 데이터를 SaaS 데이터와 분리. 서비스 키로만 접근, RLS 비활성 유지 |
| 인증 | 자체 JWT + `user_sessions` 테이블(중복 로그인 제어) | 기존 `api/auth/*` 확장 |
| 본인인증 | 포트원 PASS (`src/lib/certification.ts`, `api/auth/signup.ts`에 이미 구현) | CI 기반 1인 1계정 |
| 결제 | 토스페이먼츠 일반결제(과정 단건 구매) | 이미 가입. 빌링 코드는 구독형 과정 도입 시 재사용 |
| 영상 | Bunny Stream (어댑터로 교체 가능) | 2.4 참조 |
| 플레이어 | hls.js + 자체 컨트롤 UI (Safari는 네이티브 HLS) | 배속 제한·탐색 제어·워터마크 오버레이를 완전히 통제하기 위해 업체 iframe 플레이어를 쓰지 않음 |
| 이메일/알림 | Resend + 알림톡(솔라피 등) | 만료 예고·수료 통보 |
| 엑셀 | SheetJS(`xlsx`, 이미 의존성에 있음) | 관리자 다운로드 |
| 모니터링 | Sentry | 이미 설정 |

### 3.2 별도 프로젝트로 구축하는 이유

- 훈프로는 서버리스 함수 11개로 Hobby 한도(12개) 직전이다. 학원 사이트는 함수 6~7개면 충분하므로 새 Vercel 프로젝트로 시작한다.
- 학원 회원 데이터(CI, 학습 기록)는 보존 의무가 있어 SaaS 데이터와 수명 주기가 다르다.
- 훈프로 연계는 "수강생 확인 API"(CI 해시 또는 이메일 매칭)로 느슨하게 붙인다. 예: 학원 수강생이 훈프로에 가입하면 자동으로 무료 쿠폰 발급.

### 3.3 구성도

```
[수강생 브라우저]
  ├─ 홈페이지/강의실 (React SPA, Vercel 정적 호스팅)
  ├─ 플레이어(hls.js) ──(서명 URL)──▶ [Bunny Stream CDN] ── HLS 세그먼트
  └─ 15초 heartbeat ─────────────▶ [Vercel 함수 api/lms]
                                        │  세션(jti) 검증 · 진도 버킷 갱신
                                        ▼
                                  [Supabase Postgres]
                                        ▲
[관리자 브라우저] ── api/admin ─────────┘  수강생·진도·로그 조회, 엑셀
[포트원 PASS] ── imp_uid ──▶ api/auth/signup (CI 검증·저장)
[토스페이먼츠] ── 결제 승인/웹훅 ──▶ api/payment
[Vercel Cron] ── 매일 ──▶ 만료 예고 알림 · 세션 청소 · 수료 재계산
```

---

## 4. 기능 명세

### 4.1 회원가입 · 본인인증

| 항목 | 명세 |
|------|------|
| 가입 흐름 | ① 약관·개인정보·영상 워터마크 고지 동의 → ② PASS 본인인증(포트원) → ③ 서버가 `imp_uid`로 인증 결과 재조회(클라이언트 값 불신) → CI·이름·휴대폰·생년월일 확보 → ④ 이메일·비밀번호 입력 → 가입 완료(자동 승인) |
| 1인 1계정 | `users.ci` unique. 이미 존재하면 "이미 가입된 본인입니다 → 로그인/비밀번호 찾기" 안내 |
| 연령 | 만 14세 미만 가입 차단(법정대리인 동의 흐름은 미구현, 안내만) |
| 비밀번호 | bcrypt 해시(현재 훈프로는 이메일만으로 로그인 → 학원은 비밀번호 필수). 8자 이상, 5회 실패 시 10분 잠금 |
| 휴대폰 변경 | 재인증(PASS) 필요 |
| 대체 수단 | PASS 장애 대비 SMS OTP(솔라피)를 관리자 설정으로 켤 수 있게 하되, 기본은 PASS. SMS OTP는 실명 확인이 아니므로 원격학원 본인확인용으로는 PASS를 표준으로 둔다 |
| 개인정보 | CI는 SHA-256 + 서버 솔트 해시 저장(원문 불보관). 휴대폰은 AES 암호화 저장 |

### 4.2 로그인 · 중복 세션 차단

| 항목 | 명세 |
|------|------|
| 토큰 | JWT(만료 24시간, 슬라이딩 갱신) + `jti`(세션 ID). `user_sessions`에 jti·기기·IP·UA·last_seen 저장 |
| 정책 (관리자 설정) | **기본 "최신 로그인 우선"**: 새 로그인 시 기존 세션 전부 `revoked`, 기존 기기는 다음 요청/heartbeat에서 "다른 기기에서 로그인되어 종료되었습니다" 모달 후 로그아웃. 대안 "기존 세션 우선"(새 로그인 거부)도 선택 가능 |
| 허용 기기 수 | 기본 1대(동시 접속 1). 설정으로 2대까지 확장 가능(PC+모바일 등) |
| 검증 지점 | 모든 API 진입에서 `jti` 유효성 DB 조회(인덱스 1회, 수 ms). 플레이어 heartbeat(15초)에서도 검증 → 강제 종료가 최대 15초 내 반영 |
| 동시 재생 | 세션당 활성 플레이어 1개(`user_sessions.active_lecture_id`). 같은 계정이 두 탭에서 재생하면 두 번째 탭은 "다른 화면에서 재생 중" 안내 후 재생 불가 |
| 기기 관리 | 마이페이지 "로그인 기기" 목록·원격 로그아웃. 관리자 강제 로그아웃 버튼 |
| 로그 | `login_logs`(성공/실패, IP, UA, 사유). 5회 실패 잠금, 새 기기 로그인 시 이메일 통보(선택) |
| 이상 징후 | 같은 계정이 24시간 내 3개 이상의 서로 다른 IP 대역/기기에서 로그인 → 관리자 대시보드 "계정 공유 의심" 목록에 표시 |

### 4.3 과정 · 수강 신청 · 결제

| 항목 | 명세 |
|------|------|
| 과정(course) | 제목, 소개, 커리큘럼, 강사, 가격, 수강 기간(일수, 예 90일), 수료 기준 진도율(기본 90%), 배속 상한(기본 1.5x), 앞으로 건너뛰기 허용 여부, 판매 상태, 정원(선택), 교습비 게시 정보 |
| 강의(lecture) | 과정 하위 차시. 제목, 영상 ID, 길이(초), 순서, 공개/미공개, 첨부자료, 무료 미리보기 여부 |
| 구매 | 토스 결제위젯(카드·계좌이체·간편결제) → 승인 API → `orders` 기록 → `enrollments` 생성(입과일 = 결제일, 만료일 = 입과일 + 수강 기간). 현금영수증 자동 발행 옵션 |
| 무료/수동 배정 | 관리자가 결제 없이 수강 배정(라이브클래스 이관 수강생용). 입과일·만료일 직접 입력 |
| 연장 | 관리자 수동 연장 + 수강생 유료 연장 상품(선택) |
| 환불 | 학원법 시행령 교습비 반환기준 + 전자상거래법 청약철회를 관리자 화면에서 자동 계산(진도율·경과 기간 기준) 후 토스 부분 환불 API 호출. 섹션 8 참조 |
| 쿠폰 | 훈프로 쿠폰 모듈 재사용(정률·정액·코드형) |

### 4.4 강의 플레이어 · 진도율 추적 (LMS 핵심)

#### 4.4.1 재생 위치 기록과 이어보기

- 플레이어가 **15초마다 heartbeat**를 보낸다: `{lectureId, sessionId(jti), position, playbackRate, visible, focused, playing}`.
- 서버는 `lecture_progress.last_position`을 갱신하고, 강의 재진입 시 마지막 위치에서 이어본다.
- 재생 시작/종료마다 `lecture_view_sessions`에 시작·종료 시각, IP, 기기, 실제 시청 초를 기록한다(관리자 "시청 시작/종료 로그").

#### 4.4.2 진도율 계산 — 10초 버킷 커버리지

- 영상 길이를 10초 단위 버킷으로 나누고(60분 영상 = 360버킷), 시청 인정된 구간의 버킷을 비트 배열에 표시한다.
- **진도율 = 표시된 버킷 수 ÷ 전체 버킷 수.** 같은 구간을 반복 시청해도 100%를 넘지 않고, 앞으로 건너뛴 구간은 채워지지 않는다.
- 총 시청 시간(누적 초)은 별도 저장해 "실제 학습 시간"으로 관리자에게 보여준다.

#### 4.4.3 시청 인정 조건 (전부 만족해야 버킷 표시)

| 조건 | 판정 |
|------|------|
| 재생 중 | `playing = true`, 일시정지·버퍼링 아님 |
| 탭이 보임 | Page Visibility API `visible`. 숨김이면 클라이언트가 즉시 일시정지 + 서버도 인정 안 함 |
| 배속 ≤ 상한 | 클라이언트가 `playbackRate`를 상한(기본 1.5x)으로 강제. 서버는 heartbeat 간격 대비 재생 위치 증가량으로 검증: `Δposition ≤ Δ실제시간 × 상한 × 1.1 + 2초`. 초과하면 해당 구간 미인정 + `violations` 기록 |
| 사용자 활동 | 마우스/키보드/터치 입력이 **10분** 없으면 "학습 중이신가요?" 모달 → 60초 내 확인 없으면 일시정지, 이후 구간 미인정 |
| 집중 확인(선택) | 과정 설정으로 **N분(기본 20분)마다** 확인 팝업을 켤 수 있다(원격교육 관행) |
| 단일 재생 | 같은 계정의 다른 플레이어가 활성 상태면 미인정 |
| 세션 유효 | jti가 살아 있어야 함 |

#### 4.4.4 탐색(seek) 제어

- 뒤로 이동은 항상 허용.
- 앞으로 이동은 과정 설정에 따라 ① 자유 ② **최대 시청 지점까지만**(기본) ③ 금지. ②에서는 진도바 드래그가 `max_watched_position`을 넘지 못한다.
- 완강 처리된 강의는 자유 탐색으로 전환(복습 편의).

#### 4.4.5 수료(완강) 처리

- 강의 완강: 진도율 ≥ 과정의 수료 기준(80~100%, 기본 90%) 도달 시 `completed_at` 기록. 이후 진도율은 100%까지 계속 올라가되 완강 시각은 최초값 유지.
- 과정 수료: 모든 필수 강의 완강 + (선택) 시험 통과 → `enrollments.completed_at` 기록, 수료증 번호 발급, 알림톡/이메일 통보.
- 만료일이 지나면 재생 불가·진도 동결. 관리자 연장 시 재개.
- 진도는 서버 계산값만 신뢰한다. 클라이언트는 표시만 한다.

#### 4.4.6 플레이어 UI 요구사항

- 자체 컨트롤: 재생/정지, 10초 앞뒤, 배속(0.75/1/1.25/1.5 — 상한까지만 노출), 화질, 자막, 전체화면, 진도바(시청 구간 색 표시).
- `controlsList="nodownload"`, 우클릭 메뉴 차단, PiP 비활성, 드래그 방지.
- 모바일: iOS Safari 네이티브 HLS, 백그라운드 전환 시 일시정지(iOS는 백그라운드 재생 자체를 막음).
- 다음 강의 자동 이동(완강 후), 첨부자료 다운로드, 강의별 Q&A 링크.

### 4.5 동영상 보안 · 불법 복제 방지

| 계층 | 조치 |
|------|------|
| 1. 접근 통제 | 재생 요청 시 `api/video?action=play` → 세션 유효 · 수강 중(입과일 ≤ 오늘 ≤ 만료일) · 강의가 해당 과정 소속인지 확인 후에만 **서명 재생 URL(만료 2시간, 가능 시 IP 바인딩)** 발급. MP4 직링크 없음 |
| 2. 전송 보안 | HLS 세그먼트는 토큰 있는 요청만 응답(Bunny Token Authentication). 도메인(Referer) 제한으로 다른 사이트 임베드 차단. DRM 필요 시 Bunny MediaCage 또는 Mux DRM 추가(비용 증가) |
| 3. 동적 워터마크 | 플레이어 위에 `pointer-events:none` 오버레이로 **이름(가운데 마스킹) · 휴대폰 뒤 4자리 · IP · 시각**을 반투명(0.2~0.3)으로 표시. 15~30초마다 무작위 위치 이동 + 20분에 1회 화면 전체에 옅게 1초 표시. 오버레이 DOM이 제거되면 MutationObserver가 감지해 재생 정지 |
| 4. 서버측 워터마크(선택) | Bunny 인코딩 시 로고 워터마크 소각. 개인 식별은 3번 오버레이가 담당 |
| 5. 억제 장치 | 약관에 "영상 유출 시 손해배상·형사 고소, 워터마크로 유출자 특정" 명시하고 가입·재생 화면에 고지. 개발자도구/단축키 차단은 우회가 쉬워 참고 수준으로만 |
| 6. 탐지 | 같은 계정의 비정상 IP 분산, 짧은 시간 내 전 강의 토큰 발급(스크래핑 징후) → 관리자 알림 및 자동 세션 종료 |

**한계 고지**: 화면 녹화(캡처 프로그램, 휴대폰으로 촬영)는 어떤 웹 기술로도 완전히 막을 수 없다. DRM(Widevine L1/FairPlay + HDCP)은 일부 소프트웨어 캡처를 막지만 비용이 크고 물리 촬영은 못 막는다. 따라서 이 기획의 목표는 "다운로드·재배포를 어렵게 하고, 유출되면 누구인지 특정"하는 것이다.

### 4.6 수료증

- 과정 수료 시 PDF 수료증 자동 생성(수료번호, 이름, 과정명, 교습 기간, 학원명·등록번호, 대표 직인 이미지). 마이페이지 다운로드, 관리자 재발급. 진위 확인 URL(`/verify/{수료번호}`).

### 4.7 Q&A · 공지 · 후기 (원격학원 요건 대응)

- 강의별 Q&A 게시판(비공개 기본, 관리자 답변, 답변 시 알림).
- 공지사항, FAQ, 교습비 게시 페이지(학원법상 게시 의무), 강사 소개.
- 수강 후기(수료자만 작성, 관리자 노출 승인) — 모집 페이지 신뢰도.

### 4.8 관리자 대시보드

| 메뉴 | 기능 |
|------|------|
| 홈 | 오늘 신규 가입·결제·시청자 수, 만료 임박(7일) 수강생, 수료 대기, 계정 공유 의심, 미답변 Q&A |
| 수강생 | 목록(검색·필터: 과정, 상태, 만료일), 상세(본인인증 정보, 입과일·만료일 수정, 연장, 수강 배정/해지, 로그인 기기·강제 로그아웃, 메모), CSV 일괄 등록(라이브클래스 이관) |
| 과정·강의 | 과정 CRUD, 강의 업로드(Bunny 직접 업로드 → 인코딩 상태 표시), 순서 드래그, 수료 기준·배속 상한·탐색 정책 설정, 첨부자료 |
| 진도 현황 | 수강생 × 강의 매트릭스(진도율, 완강 여부, 누적 시청 시간, 최초/최종 시청 시각), 과정별 평균 진도율, 정체 수강생(7일 미접속) |
| 시청 로그 | 강의별 시청 세션(시작·종료 시각, 시청 초, IP, 기기, 배속 위반 횟수), 기간·수강생 필터 |
| 수료 관리 | 자동 수료 목록, 수동 수료 처리(사유 기록), 수료증 재발급, 수료 취소 |
| 결제·환불 | 주문 목록, 환불 계산기(학원법 기준 자동 계산), 토스 환불 실행, 현금영수증 |
| Q&A·공지·후기 | 답변, 게시, 노출 승인 |
| 설정 | 세션 정책(최신 우선/기존 우선, 허용 기기 수), 기본 배속 상한, 자리비움 시간, 집중 확인 주기, 워터마크 문구·투명도, 알림 템플릿, 사업자 정보 |
| **엑셀 다운로드** | ① 수강생 명부(이름·연락처·이메일·과정·입과일·만료일·상태·최종 진도율·수료일) ② 진도 현황(수강생 × 강의) ③ 시청 로그(기간 지정) ④ 결제 내역. SheetJS로 브라우저에서 생성, 서버는 JSON만 반환. 5,000행 초과 시 서버 CSV 스트리밍 |

### 4.9 마이페이지 (수강생)

- 내 강의실: 수강 중 과정, 진도율 링, 만료 D-day, 이어보기.
- 학습 기록: 강의별 진도·시청 시간, 수료증.
- 계정: 이메일·비밀번호 변경, 휴대폰 재인증, 로그인 기기 관리, 알림 수신 설정, 탈퇴(학습 기록은 법정 기간 보존 후 파기 고지).
- 결제 내역·영수증.

---

## 5. 사이트맵 · 화면 목록

```
/                       홈(히어로, 대표 과정, 후기, 강사, CTA)
/courses                과정 목록
/courses/:slug          과정 상세(커리큘럼·가격·수강기간·후기·FAQ·미리보기)
/instructor             강사 소개
/notice, /faq           공지, FAQ
/tuition                교습비 게시(학원법)
/terms, /privacy, /refund-policy
/signup, /login, /find-password
/checkout/:courseId     결제
/my                     내 강의실
/my/courses/:id         과정 강의 목록·진도
/learn/:lectureId       플레이어(전체화면 레이아웃)
/my/records             학습 기록·수료증
/my/account             계정·기기
/verify/:certNo         수료증 진위 확인
/admin/*                관리자(4.8)
```

---

## 6. DB 스키마 (Supabase)

```sql
-- 회원
users (
  id uuid pk, email unique, password_hash, name, phone_enc, birth date,
  ci_hash text unique, phone_verified_at, status ('active'|'blocked'|'withdrawn'),
  role ('student'|'admin'), created_at, last_login_at
)
user_sessions (
  jti uuid pk, user_id fk, device_label, ip, user_agent,
  created_at, last_seen_at, revoked_at, revoke_reason,
  active_lecture_id uuid null, active_player_at timestamptz null
)
login_logs (id, user_id, email, success bool, reason, ip, user_agent, created_at)

-- 과정
courses (
  id, slug unique, title, summary, description, instructor, price int,
  duration_days int, completion_threshold int default 90,   -- %
  max_playback_rate numeric default 1.5, seek_policy ('free'|'watched'|'none'),
  focus_check_minutes int null, status ('draft'|'open'|'closed'), created_at
)
lectures (
  id, course_id fk, title, sort_order, video_provider, video_id,
  duration_sec int, is_preview bool, is_required bool default true,
  attachments jsonb, status ('encoding'|'ready'|'hidden')
)

-- 수강
orders (id, user_id, course_id, amount, status, toss_payment_key, order_no, receipt_url, paid_at, refunded_amount, refunded_at)
enrollments (
  id, user_id, course_id, order_id null, source ('paid'|'manual'|'migrated'),
  started_at date, expires_at date, status ('active'|'expired'|'completed'|'canceled'),
  completed_at, certificate_no unique null, note, unique(user_id, course_id)
)

-- 진도
lecture_progress (
  enrollment_id fk, lecture_id fk,
  buckets bytea,                 -- 10초 단위 비트맵
  watched_buckets int, total_buckets int, progress_pct numeric,
  watched_sec int,               -- 누적 실제 시청 초
  last_position int, max_position int,
  first_viewed_at, last_viewed_at, completed_at,
  violation_count int default 0, primary key (enrollment_id, lecture_id)
)
lecture_view_sessions (
  id, enrollment_id, lecture_id, session_jti, started_at, ended_at,
  watched_sec int, start_position int, end_position int, ip, user_agent, end_reason
)
heartbeats_raw (id bigserial, view_session_id, position, rate, visible, accepted bool, created_at)
  -- 분쟁 대응용 원본, 90일 보관 후 크론 삭제
violations (id, user_id, lecture_id, type ('rate'|'hidden'|'multi_player'|'seek'|'overlay_removed'), detail jsonb, created_at)

-- 기타
video_tokens (id, user_id, lecture_id, session_jti, ip, expires_at, created_at)
qna (id, lecture_id, user_id, question, answer, answered_at, is_public, created_at)
notices, faqs, reviews (수료자 후기, approved bool)
certificates (cert_no pk, enrollment_id, issued_at, pdf_url)
app_settings (key pk, value)  -- 세션 정책·배속 상한·워터마크 등
```

인덱스: `user_sessions(user_id, revoked_at)`, `enrollments(user_id, status)`, `lecture_view_sessions(lecture_id, started_at)`, `heartbeats_raw(created_at)`.

---

## 7. API 목록 (Vercel 함수 6개, action 멀티플렉싱)

| 함수 | action | 설명 |
|------|--------|------|
| `api/auth.ts` | `signup` `login` `logout` `refresh` `sessions` `revoke-session` `find-password` `reset-password` `cert-config` | 가입(PASS 검증), 로그인(세션 생성·정책 적용), 기기 관리 |
| `api/lms.ts` | `my-courses` `course` `lecture` `view-start` `heartbeat` `view-end` `progress` `qna-*` | 학습 API. `heartbeat`가 진도·세션·단일 재생 검증의 중심 |
| `api/video.ts` | `play-token` `upload-url` `encode-webhook` `delete` | 업체 어댑터. 재생 토큰 발급 전 수강 자격 확인 |
| `api/payment.ts` | `prepare` `confirm` `webhook` `refund-quote` `refund` `receipt` | 토스 일반결제, 환불 계산 |
| `api/admin.ts` | `dashboard` `students` `student` `enroll` `extend` `force-logout` `courses` `lectures` `progress-matrix` `view-logs` `complete` `certificate` `export-*` `settings` `import-students` | 관리자 전용(role=admin) |
| `api/cron.ts` | `daily` (만료 예고 D-7/D-1, 만료 처리, 오래된 세션·heartbeat 정리, 수료 재계산) | `CRON_SECRET` 검증 |

공통 미들웨어: `requireSession(req)` — JWT 검증 → `user_sessions.jti` 조회(revoked 아님) → `last_seen_at` 갱신(1분 단위로만 write). 실패 시 401 + `{code:'SESSION_REVOKED'}`로 프런트가 안내 모달을 띄운다.

---

## 8. 핵심 로직 상세

### 8.1 heartbeat 서버 처리 (의사코드)

```
input: lectureId, viewSessionId, position, rate, visible, playing
ctx = requireSession()                       -- jti 유효 확인
enr = activeEnrollment(ctx.user, lectureId)  -- 입과일~만료일 내인지
if user_sessions.active_lecture_id 가 다른 viewSession 소유 && 30초 내 활동 → 409 MULTI_PLAYER

prev = lecture_progress(enr, lecture)
dtWall = now - prev.last_hb_at              -- 실제 경과 초 (첫 hb면 0)
dPos   = position - prev.last_position

accepted =
  playing && visible &&
  rate <= course.max_playback_rate + 0.01 &&
  0 <= dPos && dPos <= dtWall * course.max_playback_rate * 1.1 + 2

if accepted:
  markBuckets(prev.buckets, from=prev.last_position, to=position)   -- 10초 단위
  watched_sec += min(dPos, dtWall)
else if rate 위반 or dPos 과다: violations.insert(type='rate'|'seek'), violation_count++

progress_pct = watched_buckets / total_buckets * 100
if progress_pct >= course.completion_threshold && completed_at is null:
  completed_at = now; 과정 수료 조건 재평가
last_position = position; max_position = max(max_position, position); last_hb_at = now
return { progressPct, completed, maxPosition, sessionOk: true }
```

- 15초 간격, 응답 실패 시 클라이언트가 최대 3회 재시도 후 재생 일시정지("네트워크 확인").
- heartbeat 사이에 브라우저가 닫히면 최대 15초 손실 — 수료 판정에는 무해(다음 시청에서 채워짐).

### 8.2 클라이언트 감지 로직

```
playbackRate 변경 이벤트 → 상한 초과 시 즉시 상한으로 되돌리고 토스트 안내
visibilitychange → hidden 이면 video.pause(); heartbeat(visible=false) 1회 전송
window blur (다른 창으로 이동) → 5초 유예 후 pause (설정으로 끌 수 있음)
mousemove/keydown/touchstart → lastActivity 갱신
setInterval 30초: now - lastActivity > 10분 && playing → 확인 모달, 60초 미응답 시 pause
seeking → seek_policy='watched' 이면 target > maxPosition+2초 시 maxPosition으로 되돌림
MutationObserver(워터마크 오버레이) → 제거/숨김 감지 시 pause + violations(overlay_removed)
```

### 8.3 재생 토큰 발급 (Bunny 기준)

```
POST api/video?action=play-token {lectureId}
1. requireSession → 수강 자격(활성 enrollment, 강의 소속, ready 상태) 확인
2. expires = now + 2h
3. token = sha256_hex(BUNNY_TOKEN_KEY + videoId + expires [+ clientIp])
4. video_tokens 기록(감사용)
5. 응답: { playlistUrl: `https://{pullzone}.b-cdn.net/{videoId}/playlist.m3u8?token=..&expires=..`,
          watermark: { name:'홍*동', phone4:'1234', ip, issuedAt }, maxRate, seekPolicy, resume: last_position }
```

Cloudflare Stream 어댑터는 서명 키로 JWT를 만들어 `accessRules`에 IP·만료를 넣고, R2 어댑터는 Worker가 세션 쿠키를 검증해 플레이리스트·AES-128 키를 응답한다. 프런트는 어댑터를 몰라도 되게 응답 형식을 통일한다.

### 8.4 세션 정책

```
login(email, pw):
  검증 실패 → login_logs(false), 5회 누적 시 10분 잠금
  성공:
    policy = settings.session_policy  ('latest_wins' 기본 | 'first_wins')
    active = user_sessions where user_id and revoked_at is null and last_seen_at > now-24h
    if policy == 'first_wins' and count(active) >= max_devices → 403 "이미 다른 기기에서 로그인 중"
    if policy == 'latest_wins' → active 전부 revoke(reason='new_login')
    새 jti 발급 · user_sessions insert · JWT(exp 24h) 반환
```

### 8.5 진도율·수료 정합성

- 강의 길이가 바뀌면(영상 교체) `total_buckets` 재계산, 기존 비트맵은 길이 비율로 보정하지 않고 **관리자 확인 후 초기화 또는 유지** 선택.
- 수료 기준을 과정 단위로 변경하면 크론이 다음 날 전체 재평가(이미 수료된 건은 유지).
- 관리자 수동 수료는 사유 필수 입력, 로그에 남김.

---

## 9. 법적 · 운영 체크리스트

| 항목 | 내용 |
|------|------|
| 원격학원 LMS 요건 | 본인확인(PASS), 학습 진도 관리, 출석(시청 로그) 기록, 질의응답, 공지, 교습비 게시, 강사 정보. **관할 교육청 원격학원 지침으로 세부 요건(기록 보존 기간 등) 확인** |
| 교습비 반환 | 학원법 시행령 별표(교습비 반환기준) 적용: 교습 시작 전 전액, 총 교습시간 1/3 경과 전 2/3, 1/2 경과 전 1/2, 1/2 경과 후 반환 없음(1개월 초과 과정은 해당 월 기준 + 잔여 월 전액). 자체 사이트에서는 "경과 기준"을 **수강 기간 경과일과 진도율 중 학원 규정에 맞는 쪽**으로 관리자 설정. 전자상거래법 7일 청약철회(미시청 시)와 병기 |
| 개인정보 | CI 해시·휴대폰 암호화, 개인정보처리방침에 워터마크(IP 표시) 목적 명시, 접속기록 1년 이상 보관, 탈퇴 시 학습 기록은 법정 보존 후 파기 |
| 약관 | 영상 저작권·유출 시 손해배상, 계정 공유 금지 및 제재(세션 종료·수강 정지), 진도 인정 기준(배속·백그라운드) 명시 → 분쟁 시 근거 |
| 전자상거래 | 통신판매업 신고(완료), 사업자 정보 푸터, 현금영수증·세금계산서 |
| 미성년자 | 만 14세 미만 차단 |
| 접근성/브라우저 | Chrome·Edge·Safari(iOS 포함)·삼성 인터넷 최근 2개 버전 |

---

## 10. 라이브클래스 이관 계획

1. **데이터 추출**: 라이브클래스에서 수강생 명단(이름·연락처·이메일·과정·시작일·만료일) CSV, 영상 원본 다운로드(원본 미제공 시 업로드 당시 원본 파일 사용).
2. **영상 업로드**: Bunny 라이브러리 생성 → 강의 순서대로 업로드 → 인코딩 완료 확인 → `lectures.video_id` 매핑.
3. **수강생 사전 등록**: 관리자 CSV 일괄 등록으로 `enrollments`(source='migrated', 기존 만료일 유지)만 먼저 만들고, 수강생은 가입 시 PASS 인증 → **휴대폰 번호(또는 이메일)로 사전 등록 건과 자동 매칭**.
4. **안내**: 알림톡/이메일로 "새 강의실 가입 안내 + 기존 수강 기간 그대로 유지" 발송, 가입 가이드 페이지.
5. **병행 운영 4주**: 신규 판매는 새 사이트에서만, 기존 수강생은 두 곳 모두 시청 가능. 진도는 새 사이트 기준으로 새로 시작(라이브클래스 진도 이관은 불가 → 필요 시 관리자 수동 수료 처리).
6. **종료**: 이관율 90% 이상 시 라이브클래스 해지, 도메인/링크 정리.

---

## 11. 구현 로드맵 (직접 구축, 약 10주)

| 주차 | 산출물 | 완료 기준 |
|------|--------|-----------|
| 1 | 설계 확정 · Supabase 스키마 · Bunny 계정/토큰 인증 PoC · 프로젝트 골격 | 서명 URL로 hls.js 재생 성공, 토큰 만료 시 재생 차단 확인 |
| 2 | 회원가입(PASS) · 로그인 · 세션 테이블 · 정책 · 기기 관리 | 두 기기 로그인 시 정책대로 차단/종료, 로그 기록 |
| 3 | 과정/강의 관리자 CRUD · 업로드 · 공개 홈페이지(과정 목록/상세) | 관리자가 강의 업로드 → 사이트에 노출 |
| 4~5 | 플레이어 · heartbeat · 진도 버킷 · 배속/가시성/자리비움 · 탐색 정책 · 워터마크 | 진도율이 서버 값과 일치, 배속 조작 시 미인정, 오버레이 제거 시 정지 |
| 6 | 수료 처리 · 수료증 PDF · 마이페이지 | 90% 도달 시 자동 완강, 과정 수료 알림 |
| 7 | 관리자 대시보드(진도 매트릭스·시청 로그·수료·계정 공유 의심) · 엑셀 4종 | 엑셀 다운로드 정합성 검증 |
| 8 | 토스 결제 · 주문/수강 생성 · 환불 계산기 · 쿠폰 · Q&A/공지/후기 | 테스트 결제 → 수강 자동 배정 → 환불 |
| 9 | 알림(알림톡/이메일) · 크론 · Sentry · 부하 테스트(동시 200명 heartbeat) · 보안 검수 | 취약점 조치, 응답 시간 확인 |
| 10 | 이관(영상·수강생) · 병행 운영 시작 · 문서화(운영 매뉴얼) | 실사용자 시청·진도 정상 |

---

## 12. 리스크와 대응

| 리스크 | 대응 |
|--------|------|
| 화면 녹화·촬영 유출 | 기술적 완전 차단 불가. 워터마크로 특정 + 약관 제재 + 필요 시 DRM 추가 |
| 진도 인정 분쟁("봤는데 안 올라감") | heartbeat 원본 90일 보관, 관리자 화면에서 타임라인 조회 후 수동 보정(사유 기록) |
| 서명 URL 유효 시간 내 다운로드 도구 사용 | 토큰 2시간 + IP 바인딩 + 강의당 토큰 발급 횟수 이상 감지 → 세션 종료. DRM 옵션 |
| Vercel 서버리스 콜드스타트로 heartbeat 지연 | 15초 간격에 3회 재시도, Pro 플랜. 필요 시 heartbeat만 Supabase Edge Function/Worker로 분리 |
| 영상 업체 장애·정책 변경 | 어댑터 구조로 Cloudflare/R2 전환 가능, 원본 파일 별도 보관(R2 또는 외장) |
| 운영자 1인 리스크 | Supabase 자동 백업, 운영 매뉴얼, 환경변수 문서화, 관리자 화면에 모든 일상 업무 통합 |
| iOS Safari 제약 | 네이티브 HLS 사용, 워터마크는 DOM 오버레이라 동일 적용, 전체화면 시 커스텀 컨트롤 유지 확인 |

---

## 13. 오픈 전 체크리스트

- [ ] 도메인·SSL·Vercel Pro·Supabase Pro 세팅, 백업 확인
- [ ] PASS 실키 전환, 토스 실키 전환, 테스트 결제·환불 1회
- [ ] 약관·개인정보처리방침·환불규정·교습비 게시·사업자 정보 게시
- [ ] 세션 정책·배속 상한·수료 기준·워터마크 문구 관리자 설정 확인
- [ ] 강의 전체 재생 점검(PC·모바일), 진도율 서버-화면 일치
- [ ] 엑셀 4종 다운로드 샘플 확인
- [ ] 알림 템플릿(가입 환영·만료 D-7·수료) 발송 테스트
- [ ] Sentry 알림 수신, 크론 실행 로그 확인
- [ ] 라이브클래스 수강생 CSV 등록·매칭 리허설
