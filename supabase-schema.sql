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

-- 4. Row Level Security 비활성화 (서비스 키로만 접근)
alter table users disable row level security;
alter table api_usage disable row level security;

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

alter table api_calls disable row level security;

-- 6. 앱 전역 설정 (관리자 제어, 서비스 키로만 접근)
create table if not exists app_config (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table app_config disable row level security;

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

alter table sourcing_cache disable row level security;

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

alter table sourcing_product_obs disable row level security;

-- 9. 소싱 파인더 관심 키워드 (크론 자동 추적 대상)
create table if not exists sourcing_favorites (
  user_id uuid not null,
  keyword text not null,
  stat jsonb,
  created_at timestamptz default now(),
  primary key (user_id, keyword)
);

alter table sourcing_favorites disable row level security;

-- 10. 내 상품 순위 추적 — 등록 상품이 키워드 검색 결과 몇 위인지 수집 시마다 기록
create table if not exists sourcing_rank_watch (
  user_id uuid not null,
  keyword text not null,
  product_id text not null,
  product_name text,
  created_at timestamptz default now(),
  primary key (user_id, keyword, product_id)
);

alter table sourcing_rank_watch disable row level security;

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

alter table sourcing_rank_obs disable row level security;

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

alter table subscriptions disable row level security;

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

alter table payments disable row level security;

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

alter table coupons disable row level security;

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

alter table coupon_redemptions disable row level security;

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

alter table email_verifications disable row level security;
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

alter table knowledge_docs disable row level security;

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

alter table knowledge_chunks disable row level security;

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

alter table qa_logs disable row level security;

-- 11. 광고 보고서 추이 — 분석 요약본을 저장해 지난 보고서 대비 변화를 비교
create table if not exists ad_reports (
  id bigserial primary key,
  user_id uuid not null,
  summary jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_adr_user on ad_reports(user_id, created_at desc);

alter table ad_reports disable row level security;

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

alter table saved_works disable row level security;

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

alter table feature_usage disable row level security;

create index if not exists idx_feature_usage_date on feature_usage(date);

-- 원자적 증가 — 동시 요청에서도 한도를 넘지 않는다
create or replace function increment_feature_usage(
  p_user_id uuid, p_date date, p_feature text, p_limit int
)
returns json
language plpgsql
as $$
declare
  v_count int;
begin
  -- 한도 0 이하는 무제한으로 취급 (코칭AI 등)
  if p_limit <= 0 then
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

-- 기능별 한도 기본값 (관리자 화면에서 조정. 0 = 무제한)
insert into app_config (key, value) values
  ('feature_limits', '{"image":40,"qa":100,"sourcing":60,"reviews":20,"rank":40,"analyze":40,"inquiry":60,"general":200}')
on conflict (key) do nothing;

-- ═════════════════════════════════════════════════════════════
-- 13. 쿠팡 윙 Open API 연동 — 판매·정산·재고·반품·문의 자동 수집
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

alter table coupang_accounts disable row level security;

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
alter table coupang_items disable row level security;

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

alter table coupang_costs disable row level security;

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
alter table coupang_sales_daily disable row level security;

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
alter table coupang_settlements disable row level security;

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
alter table coupang_returns disable row level security;

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
alter table coupang_inquiries disable row level security;

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

alter table coupang_price_rules disable row level security;

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
alter table coupang_price_logs disable row level security;

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
alter table coupang_reports disable row level security;

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
alter table coupang_orders_daily disable row level security;
