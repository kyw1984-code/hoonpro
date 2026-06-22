-- 광고 성과 분석기 전용 사용자 테이블
-- 기존 hoonpro Supabase 프로젝트에 추가로 생성 (users 테이블과 별도)
create table if not exists sourcing_users (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  phone text not null,
  email text unique not null,
  trial_started_at timestamptz not null default now(),
  created_at timestamptz default now()
);

-- 관리자 승인 시스템 (기존 회원은 이미 사용 중이므로 'approved' 기본값으로 백필)
alter table sourcing_users
  add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));

alter table sourcing_users
  add column if not exists approved_at timestamptz;

-- 만료 여부 빠른 조회용 인덱스
create index if not exists idx_sourcing_users_email on sourcing_users(email);
create index if not exists idx_sourcing_users_trial_started_at on sourcing_users(trial_started_at);
create index if not exists idx_sourcing_users_status on sourcing_users(status);

-- 서비스 키로만 접근 (RLS 비활성화)
alter table sourcing_users disable row level security;
