# 쿠팡 윙 Open API 연동 — 설치와 운영 안내

훈프로에 붙인 쿠팡 연동 9개 기능(순이익·정산 캘린더·주간 리포트·재고 예측·반품 분석·
고객문의 AI·순위와 매출·코칭AI 데이터 주입·가격 조정)을 실제로 돌리기 위해 필요한 준비를
정리한다.

---

## 1. 가장 먼저 알아야 할 제약

### 키는 업체코드당 1개뿐이다

쿠팡 Open API 키는 판매자 ID(업체코드)당 **1개만** 발급된다. 연동업체를 2개 이상 등록할 수
없고, 연동업체 1개와 자체개발 1개를 동시에 둘 수도 없다.

그래서 이미 사방넷·이지어드민 같은 주문수집 프로그램을 쓰는 판매자가 키를 **재발급하면 그쪽
연동이 끊긴다**. 온보딩 화면은 이 경고를 가장 위에 두고, "기존 키를 그대로 붙여넣으라"를
기본 안내로 삼는다. 같은 키를 여러 프로그램이 동시에 호출하는 것 자체는 문제없다.

### 쿠팡은 등록된 IP에서만 호출을 받는다

자체개발(직접입력) 연동은 IP를 10개까지 등록하고, **등록되지 않은 IP의 호출은 차단된다.**
그런데 Vercel 서버리스는 고정 아웃바운드 IP가 없다. Vercel의 Static IPs 기능은 프로젝트당
월 $100다.

그래서 이 연동은 **고정 IP 중계 서버**를 거치도록 만들었다. 아무 VPS에나 중계 서버를 띄우고
그 IP 하나만 판매자들이 윙에 등록하면 된다.

### 고정 IP를 얻는 값

| 방법 | 월 비용 | 비고 |
|---|---|---|
| Vercel Static IPs | 약 $100 (14만원) + 전송량 | **쓰지 않는다.** 아래 방법과 결과가 같은데 값이 20배다 |
| **AWS Lightsail 서울** | **$5 (약 7천원)** | **이걸 쓴다.** 고정 IP·전송 1TB 포함 |
| Vultr 서울 | $5 (약 7천원) | 같은 수준의 대안 |
| Hetzner | $4~5 | 싸지만 아시아 리전이 없어 쿠팡 호출이 멀다 |
| 오라클 클라우드 Always Free | 0원 | 권하지 않는다. 인스턴스가 회수되면 전체 수집이 멈춘다 |

중계 서버가 하는 일은 요청을 그대로 넘기는 것뿐이라 가장 싼 인스턴스로 충분하다.
CPU도 메모리도 거의 쓰지 않는다.

**이 비용은 서비스 전체에 한 번만 든다.** 판매자가 100명이든 1000명이든 중계 서버는 하나고,
모두 같은 IP 하나를 윙에 등록한다. 사용자 수에 비례하지 않는다.

> 연동정보 수정은 주 10회까지만 가능하다. 판매자에게 안내할 때 한 번에 정확히 입력하도록
> 강조해야 한다.

---

## 2. 중계 서버 띄우기

### 무엇에 가입해야 하나

**AWS Lightsail, 서울 리전, 월 $5 플랜.** 이유는 셋이다.

- 고정 IP가 요금에 포함돼 있고 별도 설정이 없다
- 서울 리전이 있어 쿠팡 호출이 가장 빠르다
- 전송량 1TB가 포함이라 초과 걱정이 없다

**오라클 무료 티어는 권하지 않는다.** 공짜지만 인스턴스 확보가 어렵고, 정책이 바뀌거나
인스턴스가 회수되면 **모든 판매자의 수집이 한꺼번에 멈춘다**. 서비스 전체가 이 서버 하나에
매달려 있는데 7천원을 아끼려고 걸 위험이 아니다.

Vultr 서울 리전도 같은 가격대로 무난하다. Hetzner는 싸지만 아시아 리전이 없어 쿠팡 호출이 멀다.

### 만드는 순서

1. Lightsail 콘솔에서 인스턴스 생성
   - 리전: **서울 (ap-northeast-2)**
   - 이미지: Linux/Unix → OS 전용 → **Ubuntu 24.04 LTS**
   - 플랜: **$5/월** (2 vCPU · 512MB · 1TB 전송)
2. 인스턴스 생성 후 [네트워킹] 탭에서 **고정 IP 연결**
   (기본 IP는 재부팅 시 바뀐다. 반드시 고정 IP를 붙일 것)
3. 같은 탭의 방화벽에서 **80, 443 포트 열기**
4. 도메인에 서브도메인을 하나 만들어 그 고정 IP로 A 레코드를 건다
   (예: `relay.hoonproai.com`)

### 설치

SSH로 접속한 뒤:

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy — 우분투 기본 저장소에 없어 공식 저장소를 먼저 등록한다
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# 비밀키 만들기 — 이 값을 Vercel에도 그대로 넣는다
openssl rand -hex 32
```

중계 서버 파일은 로컬에서 올린다.

```bash
scp -i 키.pem scripts/coupang-relay.mjs ubuntu@고정IP:~/
```

서비스로 등록해 재부팅에도 살아 있게 한다.

```bash
sudo tee /etc/systemd/system/coupang-relay.service > /dev/null <<'EOF'
[Unit]
Description=Coupang API relay
After=network.target

[Service]
ExecStart=/usr/bin/node /home/ubuntu/coupang-relay.mjs
Environment=PORT=8080
Environment=RELAY_SECRET=여기에-위에서-만든-값
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now coupang-relay
```

HTTPS를 붙인다. Caddy가 인증서를 자동으로 받아 준다.

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
relay.hoonproai.com {
  reverse_proxy localhost:8080
}
EOF

sudo systemctl restart caddy
```

**평문 HTTP로 열지 말 것.** 요청에 쿠팡 서명 헤더가 실려 나간다.

### 확인

```bash
curl https://relay.hoonproai.com/health
# {"ok":true}
```

이제 Vercel 환경변수에 아래 셋을 넣으면 끝이다.

```
COUPANG_RELAY_URL=https://relay.hoonproai.com/relay
COUPANG_RELAY_SECRET=위에서 만든 값
COUPANG_RELAY_IP=Lightsail 고정 IP
```

중계 서버는 목적지를 `api-gateway.coupang.com`으로 고정하고 공유 비밀키가 맞을 때만 응답한다.
서명은 훈프로 서버에서 이미 끝난 상태로 오므로 중계는 판매자의 키를 모른다.

---

## 3. Vercel 환경변수

```
COUPANG_RELAY_URL=https://relay.example.com/relay
COUPANG_RELAY_SECRET=중계 서버의 RELAY_SECRET과 같은 값
COUPANG_RELAY_IP=중계 서버의 공인 IP        # 온보딩 화면에 안내로 표시된다
```

셋을 비워 두면 Vercel에서 쿠팡을 직접 호출한다. IP 검증이 걸리지 않는 환경에서만 동작하므로
개발·테스트용으로만 쓴다.

이미 쓰고 있는 값 중 다음이 그대로 재사용된다.

| 변수 | 용도 |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | 수집 데이터 저장 |
| `BILLING_ENC_KEY` (없으면 `JWT_SECRET`) | Secret Key 암호화 |
| `CRON_SECRET` | 수집·리포트 크론 인증 |
| `RESEND_API_KEY`, `EMAIL_FROM` | 주간 리포트, 키 만료 알림 |
| `OPENAIAPIKEY`, `OPENAI_TEXT_MODEL` | 고객문의 답변 초안 |

---

## 4. DB 마이그레이션

`supabase-schema.sql`의 13번 절(쿠팡 윙 Open API 연동)을 Supabase SQL 편집기에서 실행한다.
전부 `create table if not exists`라 여러 번 실행해도 안전하다.

추가되는 테이블은 다음과 같다.

| 테이블 | 내용 |
|---|---|
| `coupang_accounts` | 사용자별 API 키 (Secret Key는 암호화) |
| `coupang_items` | 상품·옵션 마스터 |
| `coupang_costs` | 원가 (사용자 입력) |
| `coupang_sales_daily` | 일별 매출·수수료·정산예정액 |
| `coupang_orders_daily` | 일별 주문 (재고 예측·순위 상관용) |
| `coupang_settlements` | 지급 일정 |
| `coupang_returns` | 반품·교환 |
| `coupang_inquiries` | 고객문의와 AI 초안 |
| `coupang_price_rules`, `coupang_price_logs` | 가격 규칙과 변경 이력 |
| `coupang_reports` | 주간 리포트 발송 이력 |

기존 `app_config.feature_limits`에 `inquiry` 항목이 추가된다. 이미 값이 저장된 프로젝트라면
관리자 화면에서 한 번 저장해 주면 새 항목이 반영된다.

---

## 5. 크론

`vercel.json`에 세 개가 추가돼 있다. **Vercel Pro가 필요하다** (Hobby는 크론 2개, 하루 1회 제한).

| 경로 | 주기 | 하는 일 |
|---|---|---|
| `type=sync` | 매시 30분 | 20시간 넘게 안 돈 계정만 수집. 시간 예산 안에서 돌고 남은 계정은 다음 시간대가 이어받는다 |
| `type=daily` | 매일 09:00 KST | 키 만료 알림, 자동 가격 반영, 오래된 데이터 정리 |
| `type=weekly` | 매주 월 08:00 KST | 주간 성과 리포트 발송 |

---

## 6. 판매자에게 안내할 순서

1. 윙 → 판매자정보 → 추가판매정보 → OPEN API 키 발급
2. **이미 키가 있으면 재발급하지 말고 그 값을 그대로 쓴다**
3. 없으면 새로 발급하되 연동방식은 **자체개발(직접입력)** 선택
4. IP 입력란에 훈프로 중계 서버 IP를 추가한다. 기존 솔루션의 IP가 있으면 **지우지 말고 함께** 둔다
5. 훈프로 [쿠팡 매출·정산] 탭에서 업체코드·Access Key·Secret Key 입력
6. 발급 직후라면 권한이 열리기까지 최대 24시간 걸릴 수 있다. 실패해도 다음 날 다시 시도
7. [원가 입력]에서 매입원가를 채운다. **이걸 안 하면 순이익이 매출과 거의 같게 나온다**

---

## 7. 이 연동에 드는 비용

**고정비 (사용자 수와 무관)**

| 항목 | 월 비용 |
|---|---|
| 중계 서버 VPS | 0~7천원 |
| Vercel Pro · Supabase Pro | 이미 쓰는 비용, 추가 없음 |

**변동비 (사용자 수에 비례)**

쿠팡 Open API는 호출료가 없다. 그래서 순이익·정산·재고·반품·순위 상관은 **호출당 비용이 0원**이다.
돈이 드는 것은 다음 둘뿐이다.

| 기능 | 단가 | 100명 기준 월 예상 |
|---|---|---|
| 고객문의 답변 초안 | 건당 약 2원 | 사용량에 따라, 하루 한도 60건으로 상한이 걸린다 |
| 주간 리포트 이메일 | 건당 약 0.5원 | 약 220원 |

가격 조정은 경쟁가를 새로 긁지 않고 소싱AI가 이미 모아 둔 관측치를 쓰므로 추가 비용이 없다.

## 8. 운영 화면과 확인 방법

- **관리자 → 쿠팡 연동 탭**: 연동 인원, 키 거부·만료·수집 지연 계정, 첫 수집 진행 중인 계정을 한눈에 본다.
  문제 있는 계정이 위로 온다. 중계 서버가 설정돼 있지 않으면 경고가 뜬다.
- **원가 일괄 입력**: [원가 입력] 화면의 [양식 내려받기]로 현재 상품 목록을 엑셀로 받고, 채워서
  [엑셀로 올리기]로 올리면 옵션ID 기준으로 한 번에 저장된다.
- **자동 테스트**: `npm test`. 하한가 역산, 상관, 날짜 분할, 시각 정규화, 서명 형식을 고정한다.

## 9. 알려진 한계

- **광고비는 자동으로 못 가져온다.** 쿠팡 광고 데이터는 윙 API가 아니라 광고센터에 있고 일반
  셀러에게 열려 있지 않다. 순이익 화면에서 기간 광고비를 직접 입력하며, 저장된 광고 보고서가
  있으면 그 값을 기본값으로 채운다.
- **매출은 주문보다 늦다.** 매출인식일은 구매확정 또는 배송완료 3일 뒤라 최근 주문은 순이익에
  아직 안 잡힌다. 재고 예측과 순위 상관은 이 지연을 피하려고 주문 기준으로 계산한다.
- **재고 예측은 낙관적이다.** 품절이었던 기간에는 팔리지 않으므로 판매 속도가 실제 수요보다
  낮게 잡힌다.
- **반품 손실은 배송비만 센다.** 재판매가 불가능한 반품은 원가까지 잃으므로 실제 손실은 더 크다.
- **엔드포인트와 응답 필드는 검증이 필요하다.** 쿠팡 개발자 문서를 근거로 작성했고, 버전이
  갈리는 반품·문의는 v5와 v4를 차례로 시도한다. 응답 필드명은 후보를 순서대로 훑는 정규화
  계층을 거치므로 이름 하나가 달라도 수집 전체가 무너지지는 않지만, 첫 연동 시 수집 결과 건수를
  확인하는 것이 좋다.
