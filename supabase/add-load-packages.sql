-- 적재 패키지(자주 싣는 연장·상비품 묶음을 차량에 한 번에 적재). Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.load_packages (
  id         bigint generated always as identity primary key,
  name       text not null unique,                      -- 패키지 이름 (예: 기본 용접 세트)
  items      jsonb not null default '[]'::jsonb,        -- [{key, qty}] 담긴 연장·상비품과 수량
  created_at timestamptz not null default now()
);
alter table public.load_packages enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근
notify pgrst, 'reload schema';
