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

-- 6. HUNPRO AI SOURCING V1 데이터 모델
create table if not exists keywords (
  id uuid default gen_random_uuid() primary key,
  keyword text not null,
  category text not null,
  search_volume integer default 0,
  growth_7d numeric default 0,
  growth_30d numeric default 0,
  growth_90d numeric default 0,
  competition_score numeric default 0,
  seasonality_score numeric default 0,
  ai_score numeric default 0,
  grade text check (grade in ('S', 'A', 'B', 'C', 'D')),
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  keyword_id uuid references keywords(id) on delete set null,
  product_name text not null,
  category text not null,
  price integer default 0,
  review_count integer default 0,
  rating numeric default 0,
  seller text,
  delivery_type text,
  product_url text,
  image_url text,
  estimated_sales integer default 0,
  estimated_revenue integer default 0,
  created_at timestamptz default now()
);

create table if not exists product_metrics (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade,
  search_volume integer default 0,
  growth_30d numeric default 0,
  avg_review integer default 0,
  rocket_ratio numeric default 0,
  ad_ratio numeric default 0,
  brand_ratio numeric default 0,
  top_concentration numeric default 0,
  created_at timestamptz default now()
);

create table if not exists competitors (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade,
  rank integer not null,
  product_name text not null,
  price integer default 0,
  review_count integer default 0,
  estimated_sales integer default 0,
  delivery_type text,
  created_at timestamptz default now()
);

create table if not exists suppliers (
  id uuid default gen_random_uuid() primary key,
  product_name text not null,
  supplier text not null,
  cost integer default 0,
  shipping_cost integer default 0,
  moq integer default 0,
  url text,
  image_url text,
  created_at timestamptz default now()
);

create table if not exists sourcing_products (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  text_similarity numeric default 0,
  image_similarity numeric default 0,
  total_similarity numeric default 0,
  status text default '발견',
  created_at timestamptz default now()
);

create table if not exists analysis (
  id uuid default gen_random_uuid() primary key,
  product_id uuid references products(id) on delete cascade,
  demand_score integer default 0,
  competition_score integer default 0,
  review_score integer default 0,
  growth_score integer default 0,
  margin_score integer default 0,
  price_stability_score integer default 0,
  season_score integer default 0,
  supplier_score integer default 0,
  total_score integer default 0,
  grade text check (grade in ('S', 'A', 'B', 'C', 'D')),
  ai_summary text,
  ai_strategy jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists favorites (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  status text default '발견',
  memo text,
  created_at timestamptz default now(),
  unique(user_id, product_id)
);

create table if not exists projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now()
);

create index if not exists idx_keywords_grade on keywords(grade);
create index if not exists idx_keywords_category on keywords(category);
create index if not exists idx_products_category on products(category);
create index if not exists idx_products_keyword_id on products(keyword_id);
create index if not exists idx_analysis_product_id on analysis(product_id);
create index if not exists idx_favorites_user_id on favorites(user_id);

alter table keywords disable row level security;
alter table products disable row level security;
alter table product_metrics disable row level security;
alter table competitors disable row level security;
alter table suppliers disable row level security;
alter table sourcing_products disable row level security;
alter table analysis disable row level security;
alter table favorites disable row level security;
alter table projects disable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 소싱 수집 이력 — 리뷰 증가분으로 판매 속도를 재기 위한 시계열 저장소
--
-- 한 번의 수집으로는 "지금 잘 팔리는지"를 알 수 없습니다. 같은 상품을
-- 여러 번 수집해두면 리뷰 증가분이 곧 판매 속도의 대리지표가 됩니다.
-- 그래서 실행(run)마다 상품 관측치(observation)를 그대로 쌓습니다.
-- ═══════════════════════════════════════════════════════════════════════════

-- 수집 실행 단위. 그때의 시장 지표를 함께 남깁니다.
create table if not exists sourcing_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete set null,
  snapshot_id text,
  categories text[] default '{}',
  sample_size integer default 0,
  competition_level integer default 0,
  median_reviews integer default 0,
  rocket_ratio integer default 0,
  brand_concentration integer default 0,
  top_concentration integer default 0,
  confidence_label text,
  collected_at timestamptz default now()
);

create index if not exists idx_sourcing_runs_collected on sourcing_runs(collected_at desc);

-- 실행별 상품 관측치. 같은 coupang_product_id가 여러 run에 반복 등장하며,
-- 그 사이 review_count 차이가 해당 기간의 판매 속도 추정치가 됩니다.
create table if not exists sourcing_observations (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references sourcing_runs(id) on delete cascade,
  coupang_product_id text not null,
  product_name text not null,
  product_url text,
  image_url text,
  brand text,
  seller text,
  app_category text,
  source_category text,
  price integer default 0,
  review_count integer default 0,
  rating numeric default 0,
  delivery_type text,
  opportunity_score integer default 0,
  competition_level integer default 0,
  ai_score integer default 0,
  grade text,
  difficulty text,
  observed_at timestamptz default now()
);

-- 상품별 시계열 조회용 (리뷰 증가분 계산의 핵심 경로)
create index if not exists idx_sourcing_obs_product on sourcing_observations(coupang_product_id, observed_at desc);
create index if not exists idx_sourcing_obs_run on sourcing_observations(run_id);
create index if not exists idx_sourcing_obs_observed on sourcing_observations(observed_at desc);

alter table sourcing_runs disable row level security;
alter table sourcing_observations disable row level security;

-- ═══════════════════════════════════════════════════════════════════════════
-- 소싱 카테고리 설정 — 서버 공유 저장소
--
-- 이전에는 브라우저 localStorage에만 있어서 기기·브라우저마다 설정이
-- 따로 놀았고, 서버가 값을 볼 수 없어 자동 수집도 붙일 수 없었습니다.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists sourcing_category_config (
  id uuid default gen_random_uuid() primary key,
  category text unique not null,
  urls text[] not null default '{}',
  enabled boolean default true,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz default now()
);

create index if not exists idx_sourcing_category_enabled on sourcing_category_config(enabled);

alter table sourcing_category_config disable row level security;
