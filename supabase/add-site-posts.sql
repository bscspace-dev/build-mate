-- 현장 일지(변경사항·발주·작업일지·사진 공유). Supabase SQL Editor 에서 한 번 실행하세요.
create table if not exists public.site_posts (
  id          bigint generated always as identity primary key,
  site_id     text not null,                         -- sites.id
  post_date   date not null,                         -- 해당 날짜
  kind        text not null default 'log' check (kind in ('log','change','order','etc')),   -- 작업일지 / 변경사항 / 발주 / 기타
  body        text not null default '',
  photos      text[] not null default '{}',
  author_id   text,
  author_name text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists site_posts_site on public.site_posts (site_id, post_date desc);
alter table public.site_posts enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근
