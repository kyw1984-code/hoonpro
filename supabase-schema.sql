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
