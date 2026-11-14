-- 현장 자재 요청 저장용 테이블 + '현장요청' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요.
create table if not exists public.requests (
  id        bigint generated always as identity primary key,
  worker_id text,                                  -- 요청한 회원의 id (members.id). 회원이 지워져도 요청은 남긴다
  name      text not null,                         -- 요청 당시 이름
  trade     text not null,                         -- 공정
  site      text not null default '',              -- 요청한 현장
  at        timestamptz not null default now(),
  items     jsonb not null default '[]'            -- [{ k: 자재번호, n: 이름, i: 이미지, q: 수량 }]
);
alter table public.requests add column if not exists site text not null default '';   -- 요청한 현장 이름
create index if not exists requests_at on public.requests (at desc);
alter table public.requests enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests']);
notify pgrst, 'reload schema';
