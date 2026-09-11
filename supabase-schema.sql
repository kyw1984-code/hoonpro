-- 1. 사용자 테이블
create table if not exists users (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text not null,
  email text unique not null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now()
);

-- 2. API 사용량 테이블
create table if not exists api_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  date date default current_date,
  call_count integer default 0,
  unique(user_id, date)
);

-- 3. 원자적 사용량 증가 함수 (동시 요청 안전)
create or replace function increment_usage(p_user_id uuid, p_date date, p_limit int)
returns json
language plpgsql
set search_path = public   -- 호출자가 search_path를 바꿔 동명 객체를 끼워넣는 것을 차단
as $$
declare
  v_count int;
begin
  -- 행 잠금 후 현재 횟수 조회
  select call_count into v_count
  from api_usage
  where user_id = p_user_id and date = p_date
  for update;

  if v_count is null then
    -- 오늘 첫 호출
    insert into api_usage (user_id, date, call_count) values (p_user_id, p_date, 1);
    return json_build_object('exceeded', false, 'remaining', p_limit - 1);
  end if;

  if v_count >= p_limit then
    return json_build_object('exceeded', true, 'remaining', 0);
  end if;

  update api_usage set call_count = v_count + 1
  where user_id = p_user_id and date = p_date;

  return json_build_object('exceeded', false, 'remaining', p_limit - v_count - 1);
end;
$$;

-- 4. Row Level Security 활성화 (정책 없음 — 서비스 키로만 접근)
--    service_role은 RLS를 우회하므로 서버는 그대로 동작하고,
--    anon/authenticated 키로는 아무것도 읽거나 쓸 수 없다. 자세한 이유는 26번 참고.
alter table users enable row level security;
alter table api_usage enable row level security;

-- 5. 상세 API 호출 로그 (기능/모델/토큰/비용 추적)
create table if not exists api_calls (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  feature text not null,
  model text not null,
  input_tokens integer default 0,
  output_tokens integer default 0,
  cost_usd numeric(12, 6) default 0,
  created_at timestamptz default now()
);

create index if not exists idx_api_calls_user_id on api_calls(user_id);
create index if not exists idx_api_calls_created_at on api_calls(created_at);
create index if not exists idx_api_calls_feature on api_calls(feature);
create index if not exists idx_api_calls_model on api_calls(model);

alter table api_calls enable row level security;

-- 6. 앱 전역 설정 (관리자 제어, 서비스 키로만 접근)
create table if not exists app_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table app_config enable row level security;

-- 기본값 시드 (이미 존재하면 덮어쓰지 않음)
insert into app_config (key, value) values
  ('image_model', 'gpt-image-1.5'),
  ('image_quality', 'medium'),
  ('ai_integrated_text_enabled', 'false')
on conflict (key) do nothing;

-- 7. 소싱 파인더 외부 API 응답 캐시 (쿠팡 파트너스 검색 API 시간당 10회 제한 대응)
create table if not exists sourcing_cache (
  cache_key text primary key,
  payload jsonb not null,
  created_at timestamptz default now()
);

alter table sourcing_cache enable row level security;

-- 8. 소싱 파인더 리뷰 관측 기록 (수집 시마다 리뷰 수를 기록해 리뷰 증가속도(≒판매속도) 산출)
create table if not exists sourcing_product_obs (
  id bigserial primary key,
  product_id text not null,
  keyword text,
  review_count int,
  price int,
  captured_at timestamptz default now()
);

create index if not exists idx_spo_pid on sourcing_product_obs(product_id, captured_at);

alter table sourcing_product_obs enable row level security;

-- 9. 소싱 파인더 관심 키워드 (크론 자동 추적 대상)
create table if not exists sourcing_favorites (
  user_id uuid not null,
  keyword text not null,
  stat jsonb,
  created_at timestamptz default now(),
  primary key (user_id, keyword)
);

alter table sourcing_favorites enable row level security;

-- 10. 내 상품 순위 추적 — 등록 상품이 키워드 검색 결과 몇 위인지 수집 시마다 기록
create table if not exists sourcing_rank_watch (
  user_id uuid not null,
  keyword text not null,
  product_id text not null,
  product_name text,
  created_at timestamptz default now(),
  primary key (user_id, keyword, product_id)
);

alter table sourcing_rank_watch enable row level security;

create table if not exists sourcing_rank_obs (
  id bigserial primary key,
  keyword text not null,
  product_id text not null,
  rank int,            -- 광고 제외(오가닉) 순위, null = 1페이지(60위) 밖
  rank_with_ads int,   -- 광고 포함 노출 순서
  price int,
  captured_at timestamptz default now()
);

create index if not exists idx_sro on sourcing_rank_obs(keyword, product_id, captured_at);

alter table sourcing_rank_obs enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 11. 유료화(월 구독 자동결제) — plans / subscriptions / payments / coupons
-- ─────────────────────────────────────────────────────────────

-- 플랜 — 월간 39,800원 / 연간은 월 29,800원 기준 357,600원 일시 결제 (약 25% 할인)
create table if not exists plans (
  id text primary key,
  name text not null,
  price int not null,             -- 결제 1회 청구 금액
  interval text not null default 'month', -- 'month' | 'year'
  active boolean default true,
  created_at timestamptz default now()
);

alter table plans add column if not exists interval text not null default 'month';

insert into plans (id, name, price, interval) values
  ('standard', '훈프로 월간', 39800, 'month'),
  ('yearly', '훈프로 연간', 357600, 'year')
on conflict (id) do nothing;

update plans set name = '훈프로 월간' where id = 'standard' and name = '훈프로 스탠다드';

-- 구독 (1인 1구독)
create table if not exists subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references users(id) on delete cascade,
  plan_id text not null references plans(id),
  -- trial: 무료 기간 쿠폰 이용 중 / active: 정상 / past_due: 결제 실패 재시도 중
  -- paused: 3회 실패로 정지(데이터 보존) / canceled: 종료
  status text not null default 'active'
    check (status in ('trial', 'active', 'past_due', 'paused', 'canceled')),
  billing_key_enc text,          -- 토스 빌링키 (AES-256-GCM 암호화, 카드번호는 저장하지 않음)
  customer_key text not null,    -- 토스 customerKey
  card_summary text,             -- 표시용 (예: '신한 **** 1234')
  coupon_id uuid,
  coupon_remaining_cycles int,   -- 남은 할인 적용 회차 (null = 계속 적용)
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_at date,          -- 크론이 이 날짜에 청구 (실패 시 D+1, D+3로 갱신)
  fail_count int default 0,
  cancel_at_period_end boolean default false,
  canceled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_sub_user on subscriptions(user_id);
create index if not exists idx_sub_next_billing on subscriptions(next_billing_at)
  where status in ('trial', 'active', 'past_due');

alter table subscriptions enable row level security;

-- 결제 이력
create table if not exists payments (
  id uuid default gen_random_uuid() primary key,
  subscription_id uuid references subscriptions(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  order_id text unique not null,
  order_name text,
  amount int not null,           -- 실제 청구 금액 (할인 반영)
  discount int default 0,        -- 쿠폰 할인액
  status text not null
    check (status in ('paid', 'failed', 'canceled', 'partial_refund', 'refunded')),
  payment_key text,              -- 토스 paymentKey
  fail_reason text,
  receipt_url text,
  approved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_payments_user on payments(user_id, created_at);

alter table payments enable row level security;

-- 쿠폰
create table if not exists coupons (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  -- free_period: value=무료 일수 / percent: value=% / amount: value=원
  type text not null check (type in ('free_period', 'percent', 'amount')),
  value int not null,
  duration_cycles int default 1, -- 할인형만: 적용 회차 수 (null = 계속)
  max_redemptions int,           -- null = 무제한
  redeemed_count int default 0,
  expires_at timestamptz,
  active boolean default true,
  note text,
  created_at timestamptz default now()
);

alter table coupons enable row level security;

-- 쿠폰 사용 기록 — CI(본인인증 고유값) 기준 1인 1회로 재가입 어뷰징 차단
create table if not exists coupon_redemptions (
  id uuid default gen_random_uuid() primary key,
  coupon_id uuid not null references coupons(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  ci text,
  subscription_id uuid,
  created_at timestamptz default now(),
  unique (coupon_id, user_id)
);

create unique index if not exists idx_redemption_ci
  on coupon_redemptions(coupon_id, ci) where ci is not null;

alter table coupon_redemptions enable row level security;

-- users 확장 — 본인인증(PASS) 결과
alter table users add column if not exists ci text;
alter table users add column if not exists phone_verified_at timestamptz;
alter table users add column if not exists birth_date date;

create unique index if not exists idx_users_ci on users(ci) where ci is not null;

-- 유료화 강제 스위치 — 'true'가 되면 구독 없는 계정의 기능 사용이 차단됨 (소프트 오픈 때 켜기)
insert into app_config (key, value) values ('billing_enforced', 'false')
on conflict (key) do nothing;

-- 가입 이메일 인증코드 (6자리, 10분 유효 — 메일함 소유 확인용)
create table if not exists email_verifications (
  email text primary key,
  code_hash text not null,
  attempts int default 0,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table email_verifications enable row level security;
-- "훈프로에게 질문" RAG 챗봇 (지식 문서 + 청크 임베딩 + 질문 로그)
-- ─────────────────────────────────────────────────────────────

-- 11. pgvector 확장 (Supabase 대시보드 Extensions에서도 활성화 가능)
create extension if not exists vector;

-- 12. 지식 문서 (강의 정리본 / 카톡 Q&A) — content에 마스킹된 원문 보관 (수정 기능용)
create table if not exists knowledge_docs (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  source_type text not null default 'lecture' check (source_type in ('lecture', 'kakao')),
  chunk_count integer default 0,
  char_count integer default 0,
  content text,
  created_by uuid,
  created_at timestamptz default now()
);

-- 기존 설치본 마이그레이션 (이미 컬럼이 있으면 무시됨)
alter table knowledge_docs add column if not exists content text;

alter table knowledge_docs enable row level security;

-- 13. 지식 청크 (text-embedding-3-small = 1536차원)
create table if not exists knowledge_chunks (
  id uuid default gen_random_uuid() primary key,
  doc_id uuid references knowledge_docs(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index if not exists idx_knowledge_chunks_doc_id on knowledge_chunks(doc_id);
-- 코사인 유사도 검색 인덱스 (데이터가 수천 건 이상일 때 효과. 소량이면 없어도 정확 검색됨)
create index if not exists idx_knowledge_chunks_embedding on knowledge_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table knowledge_chunks enable row level security;

-- 14. 유사도 검색 RPC (코사인 유사도 상위 N개 청크 + 문서 정보)
create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  min_similarity float default 0.25
)
returns table (
  chunk_id uuid,
  doc_id uuid,
  doc_title text,
  source_type text,
  content text,
  similarity float
)
language sql
set search_path = public   -- 호출자가 search_path를 바꿔 동명 객체를 끼워넣는 것을 차단
stable
as $$
  select
    c.id as chunk_id,
    c.doc_id,
    d.title as doc_title,
    d.source_type,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from knowledge_chunks c
  join knowledge_docs d on d.id = c.doc_id
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- 15. 질문/답변 로그 (피드백 포함)
create table if not exists qa_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete set null,
  question text not null,
  answer text,
  sources jsonb,
  matched boolean default true,
  feedback smallint check (feedback in (1, -1)),
  model text,
  created_at timestamptz default now()
);

create index if not exists idx_qa_logs_created_at on qa_logs(created_at);
create index if not exists idx_qa_logs_user_id on qa_logs(user_id);

alter table qa_logs enable row level security;

-- 11. 광고 보고서 추이 — 분석 요약본을 저장해 지난 보고서 대비 변화를 비교
create table if not exists ad_reports (
  id bigserial primary key,
  user_id uuid not null,
  summary jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_adr_user on ad_reports(user_id, created_at desc);

alter table ad_reports enable row level security;

-- 12. 작업 보관함 — 상세페이지 기획안·썸네일 결과물 저장
create table if not exists saved_works (
  id bigserial primary key,
  user_id uuid not null,
  kind text not null,
  title text,
  payload jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_sw_user on saved_works(user_id, created_at desc);

alter table saved_works enable row level security;

-- 썸네일 이미지 보관용 공개 버킷
insert into storage.buckets (id, name, public) values ('works', 'works', true)
on conflict (id) do nothing;

-- 13. 알림 이메일 수신 거부 (순위·주간 리포트 메일 — 결제 관련 메일은 항상 발송)
alter table users add column if not exists email_opt_out boolean default false;

-- ─────────────────────────────────────────────────────────────
-- 21. 비밀번호 로그인 · 아이디/비밀번호 찾기 · 회원 탈퇴
-- ─────────────────────────────────────────────────────────────

-- 비밀번호 해시 (scrypt) — 기존 회원은 null이며, 비밀번호 찾기로 최초 설정한다
alter table users add column if not exists password_hash text;
-- 탈퇴 시각 — 값이 있으면 로그인 차단 (개인정보는 익명화, 결제 기록은 법정 보존)
alter table users add column if not exists withdrawn_at timestamptz;

-- 인증코드 용도 구분 (signup: 가입 / reset: 비밀번호 재설정)
alter table email_verifications add column if not exists purpose text default 'signup';

-- ─────────────────────────────────────────────────────────────
-- 22. 쿠폰 사용 횟수 원자적 증가 (동시 요청에서 max_redemptions 초과 방지)
-- ─────────────────────────────────────────────────────────────
create or replace function increment_coupon_redeemed(p_coupon_id uuid)
returns void
language sql
set search_path = public   -- 호출자가 search_path를 바꿔 동명 객체를 끼워넣는 것을 차단
as $$
  update coupons set redeemed_count = coalesce(redeemed_count, 0) + 1 where id = p_coupon_id;
$$;

-- ─────────────────────────────────────────────────────────────
-- 23. 해지 사유 수집 · 온보딩
-- ─────────────────────────────────────────────────────────────

-- 해지 시 사유 (개선 지점을 찾기 위한 수집. 선택 입력)
alter table subscriptions add column if not exists cancel_reason text;
alter table subscriptions add column if not exists cancel_reason_detail text;

-- 온보딩 카드를 닫은 시각 (완료 여부는 실제 사용 데이터로 판정하므로 별도 저장하지 않는다)
alter table users add column if not exists onboarding_dismissed_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 24. 매출 집계 — 환불액 기록
-- ─────────────────────────────────────────────────────────────
-- 기존에는 환불 시 status만 바꿔서 부분 환불 금액을 알 수 없었고,
-- 그래서 순매출(결제액 − 환불액)을 계산할 수 없었다.
alter table payments add column if not exists refunded_amount int default 0;
alter table payments add column if not exists refunded_at timestamptz;

-- 월별 매출 집계용
create index if not exists idx_payments_created on payments(created_at);

-- ─────────────────────────────────────────────────────────────
-- 25. 기능별 일일 한도
-- ─────────────────────────────────────────────────────────────
-- 기존 api_usage는 전 기능 합산 한 칸이라, 원가가 싼 코칭AI를 많이 쓰면
-- 원가가 비싼 소싱AI를 못 쓰게 되는 문제가 있었다. 기능별로 따로 센다.
create table if not exists feature_usage (
  user_id uuid not null references users(id) on delete cascade,
  date date not null default current_date,
  feature text not null,
  call_count integer not null default 0,
  primary key (user_id, date, feature)
);

alter table feature_usage enable row level security;

create index if not exists idx_feature_usage_date on feature_usage(date);

-- 원자적 증가 — 동시 요청에서도 한도를 넘지 않는다
create or replace function increment_feature_usage(
  p_user_id uuid, p_date date, p_feature text, p_limit int
)
returns json
language plpgsql
set search_path = public   -- 호출자가 search_path를 바꿔 동명 객체를 끼워넣는 것을 차단
as $$
declare
  v_count int;
begin
  -- 한도 0 = 사용 중지. 운영에서 기능을 내릴 때 쓴다.
  -- (예전에는 0을 무제한으로 취급했다. 기능을 끄려고 0을 넣으면 정반대로
  --  무제한이 되는 함정이라, 0은 차단, 무제한은 음수로 뒤집었다.)
  -- 사용량은 올리지 않는다 — 막은 호출을 세면 실측 단가의 분모가 부풀어
  -- 관리자 화면의 원가 계산이 틀어진다.
  if p_limit = 0 then
    return json_build_object('exceeded', true, 'remaining', 0, 'disabled', true);
  end if;

  -- 음수 = 무제한 (코칭AI 등)
  if p_limit < 0 then
    insert into feature_usage (user_id, date, feature, call_count)
    values (p_user_id, p_date, p_feature, 1)
    on conflict (user_id, date, feature)
    do update set call_count = feature_usage.call_count + 1;
    return json_build_object('exceeded', false, 'remaining', -1);
  end if;

  select call_count into v_count
  from feature_usage
  where user_id = p_user_id and date = p_date and feature = p_feature
  for update;

  if v_count is null then
    insert into feature_usage (user_id, date, feature, call_count)
    values (p_user_id, p_date, p_feature, 1);
    return json_build_object('exceeded', false, 'remaining', p_limit - 1);
  end if;

  if v_count >= p_limit then
    return json_build_object('exceeded', true, 'remaining', 0);
  end if;

  update feature_usage set call_count = v_count + 1
  where user_id = p_user_id and date = p_date and feature = p_feature;

  return json_build_object('exceeded', false, 'remaining', p_limit - v_count - 1);
end;
$$;

-- 기능별 한도 기본값 (관리자 화면에서 조정. 0 = 사용 중지, 음수 = 무제한)
-- image(썸네일·상세페이지 이미지)는 0 — 기능을 내렸다.
insert into app_config (key, value) values
  ('feature_limits', '{"image":0,"qa":100,"sourcing":60,"reviews":20,"rank":100,"analyze":40,"inquiry":60,"general":200}')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════
-- 26. 쿠팡 윙 Open API 연동 — 판매·정산·재고·반품·문의 자동 수집
--
-- 설계 원칙
--  · 키는 사용자별로 각자 발급받아 등록한다. 쿠팡 호출 한도는 업체코드
--    단위로 적용되므로 사용자가 늘어도 한도가 서로 잠식하지 않는다.
--  · Secret Key만 AES-256-GCM으로 암호화한다(빌링키와 동일 방식).
--    Access Key와 업체코드는 조회용 식별자라 평문으로 둔다.
--  · 원본(raw)은 매핑 검증이 필요한 반품·문의·정산에만 남기고,
--    행 수가 가장 많은 매출은 집계만 저장해 저장공간을 아낀다.
-- ═════════════════════════════════════════════════════════════

-- 사용자별 윙 API 키
create table if not exists coupang_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  vendor_id text not null,               -- 업체코드 (A00123456 형식)
  access_key text not null,
  secret_key_enc text not null,          -- AES-256-GCM
  status text not null default 'active'  -- active | invalid (인증 실패) | expired
    check (status in ('active', 'invalid', 'expired')),
  key_issued_at date,                    -- 발급일 — 6개월 만료 사전 알림에 사용
  expiry_notified_at date,               -- 만료 임박 알림을 보낸 날 (중복 발송 방지)
  last_verified_at timestamptz,
  last_sync_at timestamptz,
  last_sync_error text,
  -- 첫 전체 수집(백필)이 끝났는지. 시간 예산에 걸려 중간에 끊긴 회차와
  -- 정상적으로 끝난 회차를 구분해야, 큰 판매자가 매 시간 처음부터 다시
  -- 시작하며 다른 사용자의 수집을 굶기는 일을 막을 수 있다.
  backfill_done boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 이미 13번 절을 한 번 실행한 프로젝트를 위해 나중에 추가된 칼럼을 따로 보강한다
alter table coupang_accounts add column if not exists backfill_done boolean not null default false;
-- 키 거부·만료를 이메일로 알린 시각. 같은 사고로 매일 보내지 않기 위해 기록한다.
alter table coupang_accounts add column if not exists status_notified_at timestamptz;
-- 크론 분산 슬롯은 쓰지 않는다. 수집은 마지막 수집 시각 기준으로 오래된 계정부터 돈다.
alter table coupang_accounts drop column if exists sync_shard;

alter table coupang_accounts enable row level security;

-- 상품(옵션) 마스터 — 원가 입력과 재고 예측의 단위
create table if not exists coupang_items (
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,          -- 옵션ID (가격·재고 변경의 키)
  seller_product_id text,                -- 등록상품ID
  product_id text,                       -- 노출상품ID (순위 추적과 연결)
  product_name text,
  option_name text,
  sale_price int,
  stock int,
  status text,                           -- 판매중 / 판매중지 등 원문
  synced_at timestamptz default now(),
  primary key (user_id, vendor_item_id)
);

create index if not exists idx_cpi_user on coupang_items(user_id);
create index if not exists idx_cpi_pid on coupang_items(user_id, product_id);
alter table coupang_items enable row level security;

-- 원가 — 사용자가 직접 입력한다. 순이익 계산의 유일한 수동 입력값이다.
create table if not exists coupang_costs (
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,
  unit_cost int not null default 0,            -- 매입원가 (개당)
  packaging_cost int not null default 0,       -- 부자재·포장비 (개당)
  shipping_cost int not null default 0,        -- 출고 택배비 (개당)
  return_shipping_cost int not null default 0, -- 반품 1건당 왕복 배송비
  memo text,
  updated_at timestamptz default now(),
  primary key (user_id, vendor_item_id)
);

alter table coupang_costs enable row level security;

-- 일별·옵션별 매출 집계 (매출내역 API)
create table if not exists coupang_sales_daily (
  user_id uuid not null references users(id) on delete cascade,
  sale_date date not null,               -- 매출인식일
  vendor_item_id text not null,
  product_name text,
  quantity int not null default 0,
  sales_amount bigint not null default 0,     -- 고객 결제금액 합
  commission bigint not null default 0,       -- 쿠팡 판매수수료
  settlement_amount bigint not null default 0,-- 정산예정액 (수수료 차감 후)
  updated_at timestamptz default now(),
  primary key (user_id, sale_date, vendor_item_id)
);

create index if not exists idx_cpsd_user_date on coupang_sales_daily(user_id, sale_date desc);
alter table coupang_sales_daily enable row level security;

-- 지급(정산) 내역 — 캐시플로 캘린더
create table if not exists coupang_settlements (
  user_id uuid not null references users(id) on delete cascade,
  settlement_key text not null,          -- 지급일+유형+인식월 해시 (중복 방지)
  settlement_date date not null,         -- 지급 예정일 / 지급일
  settlement_type text,                  -- 주정산 / 월정산 / 추가지급
  recognition_month text,                -- 매출인식월 (YYYY-MM)
  amount bigint not null default 0,
  status text,                           -- 예정 / 확정 / 지급완료 (원문)
  raw jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, settlement_key)
);

create index if not exists idx_cpst_user_date on coupang_settlements(user_id, settlement_date);
alter table coupang_settlements enable row level security;

-- 반품·교환 요청
create table if not exists coupang_returns (
  user_id uuid not null references users(id) on delete cascade,
  receipt_id text not null,              -- 접수번호
  kind text not null default 'return'    -- return | exchange
    check (kind in ('return', 'exchange')),
  vendor_item_id text,
  product_name text,
  quantity int not null default 1,
  reason text,                           -- 사유 원문
  fault text,                            -- 귀책 (COMPANY=판매자 / CUSTOMER=고객)
  status text,
  requested_at timestamptz,
  raw jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, receipt_id)
);

create index if not exists idx_cpr_user_at on coupang_returns(user_id, requested_at desc);
create index if not exists idx_cpr_item on coupang_returns(user_id, vendor_item_id);
alter table coupang_returns enable row level security;

-- 고객문의 + AI 답변 초안
create table if not exists coupang_inquiries (
  user_id uuid not null references users(id) on delete cascade,
  inquiry_id text not null,
  source text not null default 'product' -- product(상품문의) | cs(고객센터)
    check (source in ('product', 'cs')),
  vendor_item_id text,
  product_name text,
  content text,
  customer_name text,
  inquired_at timestamptz,
  answered boolean not null default false,
  draft text,                            -- AI 초안 (사용자 승인 전)
  draft_at timestamptz,
  replied_at timestamptz,
  raw jsonb,
  updated_at timestamptz default now(),
  primary key (user_id, inquiry_id)
);

create index if not exists idx_cpq_user on coupang_inquiries(user_id, answered, inquired_at desc);
alter table coupang_inquiries enable row level security;

-- 가격 규칙 — 마진 하한을 지키는 선에서만 조정을 제안/적용한다
create table if not exists coupang_price_rules (
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,
  enabled boolean not null default true,
  auto_apply boolean not null default false,  -- false = 제안만, true = 크론이 실제 반영
  min_margin_rate numeric not null default 10,-- 순이익률 하한 (%)
  min_price int,                              -- 절대 하한가 (선택)
  max_price int,                              -- 절대 상한가 (선택)
  target_keyword text,                        -- 경쟁가 비교에 쓸 키워드
  last_applied_at timestamptz,
  updated_at timestamptz default now(),
  primary key (user_id, vendor_item_id)
);

alter table coupang_price_rules enable row level security;

-- 가격 변경 제안·적용 로그 (되돌리기와 감사 추적용)
create table if not exists coupang_price_logs (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,
  old_price int,
  new_price int,
  reason text,
  applied boolean not null default false,     -- false = 제안만 남김
  error text,
  created_at timestamptz default now()
);

create index if not exists idx_cppl_user on coupang_price_logs(user_id, created_at desc);
alter table coupang_price_logs enable row level security;

-- 주간 성과 리포트 발송 이력 (중복 발송 방지 + 지난주 대비 비교)
create table if not exists coupang_reports (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  summary jsonb not null,
  sent_at timestamptz default now()
);

create unique index if not exists idx_cprep_uniq on coupang_reports(user_id, period_start, period_end);
alter table coupang_reports enable row level security;

-- 일별 주문 집계 (발주서 API) — 매출인식일은 배송완료 이후라 최대 열흘 늦다.
-- 재고 소진 예측과 순위·판매 상관에는 '주문일' 기준의 신선한 수치가 필요해
-- 매출 집계와 별도로 둔다.
create table if not exists coupang_orders_daily (
  user_id uuid not null references users(id) on delete cascade,
  order_date date not null,
  vendor_item_id text not null,
  product_id text,                       -- 노출상품ID (순위 추적과 연결)
  product_name text,
  quantity int not null default 0,
  order_amount bigint not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, order_date, vendor_item_id)
);

create index if not exists idx_cpod_user_date on coupang_orders_daily(user_id, order_date desc);
create index if not exists idx_cpod_pid on coupang_orders_daily(user_id, product_id, order_date);
alter table coupang_orders_daily enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 27. 접근 차단 — RLS 전면 활성화 + anon/authenticated 권한 회수
-- ─────────────────────────────────────────────────────────────
-- 이 앱은 브라우저에서 Supabase에 직접 접속하지 않는다. 모든 DB 접근은
-- 서버리스 함수(api/*)가 SUPABASE_SERVICE_KEY로 수행하고, service_role은
-- RLS를 우회한다. 따라서 '정책 없는 RLS'를 켜면 서버 동작은 그대로면서
-- anon 키로는 아무것도 읽거나 쓸 수 없게 된다.
--
-- RLS를 끄면 anon 키 하나만으로 users.password_hash, subscriptions.billing_key_enc,
-- payments 전건, email_verifications 인증코드(계정 탈취)까지 읽고 쓸 수 있다.
-- anon 키는 Supabase 설계상 '공개돼도 되는 키'라 언젠가는 새는 것을 전제해야 한다.
--
-- 위 26번까지의 테이블별 enable 문이 누락을 만들 수 있어, 여기서 public
-- 스키마 전체를 한 번 더 훑는다. (과거 프로젝트 잔재 테이블까지 포함)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 이중 방어 — RLS가 실수로 꺼지더라도 anon 키로는 접근 불가
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- 앞으로 만들어질 테이블에도 같은 정책 적용
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 확인용 — 전체테이블 = RLS켜진테이블, anon권한수 = 0 이어야 한다
-- select
--   (select count(*) from pg_tables where schemaname='public') as 전체테이블,
--   (select count(*) from pg_tables where schemaname='public' and rowsecurity) as RLS켜진테이블,
--   (select count(*) from information_schema.role_table_grants
--      where table_schema='public' and grantee in ('anon','authenticated')) as anon권한수;

-- ─────────────────────────────────────────────────────────────
-- 28. 쿠팡 키 만료 관리 — 발급일이 아니라 만료일을 받는다
-- ─────────────────────────────────────────────────────────────
-- 윙 화면은 발급일을 보여주지 않는다. '유효 기간'에 만료 시각만 나온다.
-- 발급일을 받아 180일을 더해 추정하면 며칠씩 어긋나므로 만료일을 그대로 받는다.
alter table coupang_accounts add column if not exists key_expires_at date;
alter table coupang_accounts drop column if exists key_issued_at;

-- ─────────────────────────────────────────────────────────────
-- 29. 광고비 일자별 저장 — 순이익에서 광고비를 자동으로 빼기 위한 것
-- ─────────────────────────────────────────────────────────────
-- 쿠팡 Open API에는 광고 엔드포인트가 없다. 광고 데이터는 광고센터라는
-- 별도 시스템에만 있고 판매자용 공개 API가 없어, 광고 보고서 파일을
-- 올려받는 수밖에 없다. 대신 한 번 올린 값을 '일자별'로 쪼개 두면
-- 이후 어떤 기간을 조회하든 그 기간에 맞는 광고비가 자동으로 잡힌다.
--
-- source
--   'report' — 보고서에 일자 컬럼이 있어 그날 값을 그대로 넣은 것 (정확)
--   'spread' — 기간 총액만 있어 일수로 나눈 것 (추정, 화면에 그렇게 표시한다)
--   'manual' — 사용자가 직접 입력한 것
create table if not exists coupang_ad_costs (
  user_id uuid not null,
  ad_date date not null,
  cost numeric not null default 0,
  source text not null default 'report',
  -- 어느 업로드에서 온 값인지. 같은 기간을 다시 올리면 통째로 갈아끼운다.
  batch_id text,
  updated_at timestamptz default now(),
  primary key (user_id, ad_date)
);

create index if not exists idx_cac_user_date on coupang_ad_costs(user_id, ad_date);

alter table coupang_ad_costs enable row level security;
revoke all on table coupang_ad_costs from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 30. 키워드 경쟁 분석 — 검색 결과를 이미 수집하면서 버리던 정보를 남긴다
-- ─────────────────────────────────────────────────────────────
-- 순위 추적은 "내가 몇 위인지"만 답한다. 그런데 순위를 올리려면 다음 질문에
-- 답해야 한다 — "내 위에 있는 상품들은 얼마에 팔고, 리뷰가 몇 개이고,
-- 로켓배송인가?" 검색 결과 60개를 이미 파싱하고 있으므로 추가 수집 비용은 없다.
--
-- snapshot_at은 한 번의 수집 전체에 같은 값을 넣는다. 행마다 now()를 쓰면
-- 마이크로초가 어긋나 "이번 수집분"을 한 덩어리로 골라낼 수 없다.
alter table sourcing_product_obs add column if not exists product_name text;
alter table sourcing_product_obs add column if not exists rank int;
alter table sourcing_product_obs add column if not exists is_ad boolean;
alter table sourcing_product_obs add column if not exists rating numeric;
alter table sourcing_product_obs add column if not exists delivery_type text;
alter table sourcing_product_obs add column if not exists snapshot_at timestamptz;

create index if not exists idx_spo_kw_snap on sourcing_product_obs(keyword, snapshot_at desc);

-- ─────────────────────────────────────────────────────────────
-- 31. 로켓그로스 매출 — 윙(마켓플레이스) 매출과 섞이지 않게 채널을 나눈다
-- ─────────────────────────────────────────────────────────────
-- 로켓그로스는 rg_open_api라는 별도 창구로만 조회된다. 마켓플레이스 매출내역
-- (revenue-history)에는 한 건도 들어오지 않아, 그로스 매출이 통째로 빠져 있었다.
--
-- 두 채널은 회계 기준이 다르다.
--   마켓플레이스 — 매출인식일 기준, 정산예정액(수수료 차감 후)이 확정값으로 온다
--   로켓그로스   — 주문만 조회되므로 결제일 기준이고 정산예정액은 추정값이다
-- 한 통에 부으면 성격이 다른 숫자가 소리 없이 섞인다. channel로 갈라 두고
-- 화면에서도 따로 보여준다.
--
-- 기본키에 channel이 들어가야 한다. 빠지면 같은 상품·같은 날 두 채널이
-- 서로를 덮어써 한쪽 매출이 사라진다.
alter table coupang_sales_daily add column if not exists channel text not null default 'marketplace';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'coupang_sales_daily_pkey'
      and array_length(conkey, 1) = 3
  ) then
    alter table coupang_sales_daily drop constraint coupang_sales_daily_pkey;
    alter table coupang_sales_daily add primary key (user_id, sale_date, vendor_item_id, channel);
  end if;
end $$;

create index if not exists idx_cpsd_channel on coupang_sales_daily(user_id, channel, sale_date desc);

-- ─────────────────────────────────────────────────────────────
-- 32. 로켓그로스 입출고비 + 상품의 판매방식
-- ─────────────────────────────────────────────────────────────
-- 로켓그로스는 판매수수료 외에 입출고비(쿠팡 물류센터 입고·출고·포장)가
-- 개당 따로 나간다. 윙(판매자배송)에는 없는 비용이라 기존 원가 항목으로는
-- 담기지 않고, 안 담으면 그로스 상품의 순이익이 실제보다 높게 나온다.
alter table coupang_costs add column if not exists fulfillment_cost int not null default 0;

-- 어느 상품이 그로스인지 알아야 원가 입력에서 입출고비 칸을 그 상품에만
-- 띄울 수 있다. 모든 상품에 띄우면 판매자배송 상품에 0을 넣게 만들고,
-- 아무 상품에도 안 띄우면 그로스 원가를 넣을 방법이 없다.
alter table coupang_items add column if not exists business_type text not null default 'marketplace';

-- ─────────────────────────────────────────────────────────────
-- 33. 로켓그로스 창고 재고
-- ─────────────────────────────────────────────────────────────
-- 재고 예측은 쿠팡 물류센터에 실제로 있는 수량으로 해야 한다. 판매자 창고
-- 재고(등록상품의 재고 수치)는 그로스에선 의미가 없다 — 팔리는 건 로켓창고
-- 재고다. rg/inventory/summaries가 옵션별 판매가능수량과 쿠팡 자체 집계
-- 30일 판매수를 준다.
create table if not exists coupang_growth_inventory (
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,
  product_name text,
  external_sku text,
  orderable_qty int not null default 0,   -- totalOrderableQuantity (판매가능 재고)
  sales_30d int,                          -- SALES_COUNT_LAST_THIRTY_DAYS (쿠팡 집계)
  synced_at timestamptz default now(),
  primary key (user_id, vendor_item_id)
);
alter table coupang_growth_inventory enable row level security;
revoke all on coupang_growth_inventory from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 34. 주문의 쿠폰 할인 — 판매가와 실제 판매가는 다르다
-- ─────────────────────────────────────────────────────────────
-- 판매가 39,800원에 즉시할인쿠폰 10,000원이면 실제로 받는 돈은 29,800원이다.
-- 발주서는 주문 건마다 이 할인을 나눠 준다:
--   discountPrice(총) = instantCouponDiscount(즉시할인) + downloadableCouponDiscount(다운로드쿠폰)
--                     + coupangDiscount(쿠팡 지원)
-- 앞 둘은 판매자 부담이라 매출에서 빠지고, 마지막은 쿠팡이 메워 주므로 안 빠진다.
-- order_amount는 할인 전 주문금액 그대로 두고, 판매자 부담분을 따로 둔다.
-- 실매출 = order_amount − seller_discount.
alter table coupang_orders_daily add column if not exists seller_discount bigint not null default 0;
alter table coupang_orders_daily add column if not exists coupang_discount bigint not null default 0;

-- ─────────────────────────────────────────────────────────────
-- 35. 옵션별 광고비 — 상품별 순이익에서 광고비를 빼려면 옵션 단위가 필요하다
-- ─────────────────────────────────────────────────────────────
-- 광고 보고서에는 행마다 '광고집행 옵션ID'가 있다. 일자별 합계(coupang_ad_costs)만
-- 두면 순이익 합계에서만 광고비가 빠지고 상품별 표에는 못 붙인다. 옵션별로도
-- 쌓아 두고, 합계와의 차이(옵션에 못 붙는 광고비)는 화면에서 밝힌다.
create table if not exists coupang_ad_costs_items (
  user_id uuid not null,
  ad_date date not null,
  vendor_item_id text not null,
  cost numeric not null default 0,
  batch_id text,
  updated_at timestamptz default now(),
  primary key (user_id, ad_date, vendor_item_id)
);
create index if not exists idx_caci_user_date on coupang_ad_costs_items(user_id, ad_date);
alter table coupang_ad_costs_items enable row level security;
revoke all on coupang_ad_costs_items from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 36. 마지막 광고 보고서의 모양 — 값은 없고 열 이름만
-- ─────────────────────────────────────────────────────────────
-- 광고비가 일자별로 안 붙고 '추정'으로 떨어질 때, 어떤 열이 왔는지 알아야 고칠 수
-- 있다. 사용자에게 화면을 찍어 보내 달라고 하는 대신 열 이름과 보고서 단위를
-- 여기 남긴다. 광고비 값 자체는 남기지 않는다.
alter table coupang_accounts add column if not exists last_ad_report_note text;

-- ─────────────────────────────────────────────────────────────
-- 37. 주문별 쿠폰 — 로켓그로스 주문에는 할인 항목이 없다
-- ─────────────────────────────────────────────────────────────
-- 윙 발주서는 주문 건마다 쿠폰 할인을 나눠 주지만, 로켓그로스 주문 API는
-- vendorItemId·수량·단가만 준다(실측). 대신 쿠팡에 "이 주문에 적용된 쿠폰"을
-- 주문번호로 묻는 API(fms .../{orderId}/coupons)가 있어, 그로스 주문마다 물어
-- 여기에 쌓는다. 한 번 물은 주문은 다시 묻지 않는다. 한 주문에 옵션이 여럿이면
-- 옵션 금액 비율로 나눠 붙인다 — 상품별 표에 쿠폰을 붙이려면 옵션 단위여야 한다.
create table if not exists coupang_order_coupons (
  user_id uuid not null references users(id) on delete cascade,
  order_id text not null,
  vendor_item_id text not null,
  channel text not null default 'growth',
  sale_date date not null,
  discount bigint not null default 0,
  coupon_types text,                     -- 쿠팡이 준 쿠폰 종류들 (진단용)
  fetched_at timestamptz default now(),
  primary key (user_id, order_id, vendor_item_id)
);
create index if not exists idx_coc_user_date on coupang_order_coupons(user_id, sale_date);
alter table coupang_order_coupons enable row level security;
revoke all on coupang_order_coupons from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 38. 쿠폰 설정 — 판매자가 쿠폰 관리에 등록한 "옵션당 얼마" 그 자체
-- ─────────────────────────────────────────────────────────────
-- 순이익의 쿠폰은 판매자가 아는 숫자와 맞아야 한다(1건당 11,500원이면 2건에
-- 23,000원). 주문에서 역산하면 다운로드쿠폰이 섞이거나 쿠폰을 바꾼 날이 끼어
-- 개당 값이 흔들린다. 쿠폰 관리(fms .../coupons?status=APPLIED)와 그 쿠폰이 붙은
-- 옵션 목록(.../coupons/{id}/items)을 그대로 받아 둔다. 윙·그로스 모두 옵션ID로
-- 발행하므로 채널 구분이 없다. 회차마다 전부 받아 통째로 갈아 끼운다.
create table if not exists coupang_coupon_items (
  user_id uuid not null references users(id) on delete cascade,
  coupon_id text not null,
  vendor_item_id text not null,
  coupon_name text,
  coupon_type text,                      -- 정액(PRICE 등)·정률(RATE) — 쿠팡이 준 값 그대로
  discount numeric not null default 0,   -- 정액이면 원, 정률이면 %
  max_discount numeric,                  -- 정률의 최대 할인액
  status text,
  start_at timestamptz,
  end_at timestamptz,
  fetched_at timestamptz default now(),
  primary key (user_id, coupon_id, vendor_item_id)
);
create index if not exists idx_cci_user_item on coupang_coupon_items(user_id, vendor_item_id);
alter table coupang_coupon_items enable row level security;
revoke all on coupang_coupon_items from anon, authenticated;

-- 주문별 쿠폰에 그 주문의 수량을 함께 둔다. 회차 상한으로 일부 주문만 물었을 때
-- 전체 주문수량으로 나누면 개당 쿠폰이 실제보다 작아진다.
alter table coupang_order_coupons add column if not exists quantity integer;

-- ─────────────────────────────────────────────────────────────
-- 39. 쿠폰 목록 — 옵션이 안 붙어도 "내 쿠폰이 무엇인지"는 보여야 한다
-- ─────────────────────────────────────────────────────────────
-- 쿠폰 목록 조회(fms v2)는 잘 오는데, 각 쿠폰의 옵션 목록(v1 .../items)이 비어
-- 오는 경우가 있다. 계약 단위로 걸린 쿠폰은 특정 옵션에 붙지 않기 때문으로 보인다.
-- 그럴 때 옵션 매핑만 저장하면 화면에는 아무것도 안 남아 "쿠폰이 없다"와 똑같이
-- 보인다. 목록 자체를 남겨 판매자가 자기 쿠폰과 화면 숫자를 대조할 수 있게 한다.
-- item_count가 0이면 그 쿠폰에는 옵션이 안 붙어 있다는 뜻이다.
create table if not exists coupang_coupons (
  user_id uuid not null references users(id) on delete cascade,
  coupon_id text not null,
  promotion_name text,
  coupon_type text,
  status text,
  discount numeric,
  max_discount numeric,
  wow_exclusive boolean,
  contract_id text,
  start_at timestamptz,
  end_at timestamptz,
  item_count integer not null default 0,
  fetched_at timestamptz default now(),
  primary key (user_id, coupon_id)
);
create index if not exists idx_cc_user on coupang_coupons(user_id);
alter table coupang_coupons enable row level security;
revoke all on coupang_coupons from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 40. 부가세 분리 + 사업자 정보
-- ─────────────────────────────────────────────────────────────
-- 요금표의 가격은 공급가액이고 실제 청구액은 세액을 더한 값이다. 카드 매출전표가
-- 매입세액 공제의 적격증빙이 되려면 공급가액과 세액이 나뉘어 있어야 한다.
alter table payments add column if not exists supply_amount int;
alter table payments add column if not exists vat_amount int;

-- 영수증·거래명세서에 표기할 사업자 정보
alter table users add column if not exists business_number text;
alter table users add column if not exists business_name text;

-- ─────────────────────────────────────────────────────────────
-- 41. 서버 오류 기록 — 관리자가 화면에서 바로 본다
-- ─────────────────────────────────────────────────────────────
-- 중계 서버가 90분 죽어 있었는데 아무도 몰랐다. 로그는 Vercel에만 남고, 운영자는
-- 그걸 열어 볼 이유가 없기 때문이다. 오류를 여기에 쌓아 관리자 화면에 띄운다.
-- 같은 오류가 반복되면 행을 늘리지 않고 count만 올린다 — 100줄짜리 같은 오류는
-- 목록을 못 쓰게 만든다. resolved_at을 찍으면 목록에서 내려간다.
create table if not exists system_errors (
  id uuid default gen_random_uuid() primary key,
  area text not null,                       -- 어디서 났나 (coupang-cron, billing-charge 등)
  message text not null,
  detail text,
  user_id uuid references users(id) on delete set null,
  severity text not null default 'error',   -- error | warn
  count int not null default 1,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  resolved_at timestamptz
);
create index if not exists idx_sys_err_open on system_errors(resolved_at, last_seen_at desc);
create index if not exists idx_sys_err_dedupe on system_errors(area, message) where resolved_at is null;
alter table system_errors enable row level security;
revoke all on system_errors from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 42. 아침 브리핑 — 매일 아침 한 통으로 어제를 정리한다
-- ─────────────────────────────────────────────────────────────
-- 기능이 많아도 판매자가 매일 앱을 열 이유는 따로 필요하다. 어제 순이익,
-- 발주해야 할 재고, 새 문의를 아침에 한 번 보내면 그게 여는 이유가 된다.
--
-- 주간 리포트(coupang_reports)와 같은 방식으로 보낸 날을 남겨 중복 발송을
-- 막는다. 크론이 재시도되거나 두 번 돌아도 같은 날 두 통이 가지 않는다.
create table if not exists coupang_daily_briefs (
  user_id uuid not null references users(id) on delete cascade,
  brief_date date not null,
  summary jsonb not null,
  sent_at timestamptz default now(),
  primary key (user_id, brief_date)
);
create index if not exists idx_cdb_user_date on coupang_daily_briefs(user_id, brief_date desc);
alter table coupang_daily_briefs enable row level security;
revoke all on coupang_daily_briefs from anon, authenticated;

-- 수신 거부. 매일 오는 메일은 끌 수 있어야 한다.
alter table coupang_accounts add column if not exists brief_enabled boolean not null default true;

-- 발주 리드타임 — 재고 알림의 기준이다. 판매자마다 다르다(국내 3일, 중국 30일).
-- 이 값이 틀리면 알림이 늘 이르거나 늘 늦어 아무도 안 본다.
alter table coupang_accounts add column if not exists lead_time_days int not null default 14;

-- ─────────────────────────────────────────────────────────────
-- 43. 발주 알림에서 시즌 지난 상품 빼기
-- ─────────────────────────────────────────────────────────────
-- 여름 나시티가 9월에 품절이면 그건 채울 일이 아니라 시즌이 끝난 것이다.
-- 그런데 발주 알림은 '남은 일수'만 봐서, 한 달에 한두 개 팔리는 상품도
-- 재고가 0이면 매일 올라온다. 매일 같은 목록이 오면 그 메일은 안 읽히고,
-- 안 읽히는 메일에는 진짜 급한 품절도 함께 묻힌다.
--
-- 판단은 '최근에 아직 팔리는가'로 한다. 시즌이 끝나면 판매가 먼저 끊긴다.
-- 다만 자동 판단은 '이제 곧 시즌이 시작될 상품'을 알 수 없다 — 겨울 상품은
-- 9월에 안 팔리지만 10월 발주는 해야 한다. 그래서 손으로 고정하는 길을 둔다.
create table if not exists coupang_reorder_rules (
  user_id uuid not null references users(id) on delete cascade,
  vendor_item_id text not null,
  mode text not null check (mode in ('exclude', 'always')),
  -- exclude: 판매가 있어도 발주 알림에서 뺀다 (단종·시즌 종료)
  -- always:  판매가 없어도 발주 알림에 넣는다 (곧 시즌이 오는 상품)
  note text,
  updated_at timestamptz default now(),
  primary key (user_id, vendor_item_id)
);
create index if not exists idx_crr_user on coupang_reorder_rules(user_id);
alter table coupang_reorder_rules enable row level security;
revoke all on coupang_reorder_rules from anon, authenticated;

-- 자동 판단 기준: 최근 14일에 이만큼도 안 팔렸으면 발주 대상이 아니다.
-- 0으로 두면 자동 판단을 끄고 전부 알린다.
alter table coupang_accounts add column if not exists reorder_min_sales14 int not null default 3;

-- ─────────────────────────────────────────────────────────────
-- 44. 분석한 키워드는 자동으로 추적한다
-- ─────────────────────────────────────────────────────────────
-- ★(관심 키워드)를 눌러야만 매일 자동 수집이 돌았는데, 실제로는 아무도 누르지
-- 않았다. 같은 키워드를 열흘에 네 번 다시 분석하면서도 저장은 안 하니 시장
-- 변화·리뷰 증가 속도가 통째로 죽어 있었다.
--
-- 사람에게 한 동작을 더 시켜서 될 일이 아니다. 분석했다는 것 자체가 곧
-- 관심의 표시이므로 그때 자동으로 등록한다.
--
-- auto로 들어온 것은 최근 N개만 남긴다. 무한정 쌓이면 크론이 도는 키워드가
-- 늘어 수집 비용이 함께 늘고, 오래전에 한 번 본 키워드까지 매일 돌게 된다.
alter table sourcing_favorites add column if not exists auto boolean not null default false;
alter table sourcing_favorites add column if not exists last_seen_at timestamptz default now();
create index if not exists idx_sfav_user_seen on sourcing_favorites(user_id, last_seen_at desc);
