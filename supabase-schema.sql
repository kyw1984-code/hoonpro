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
