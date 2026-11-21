-- 현장 등록(자재 요청에서 고르는 현장) + '현장 관리' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.sites (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  memo       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.sites add column if not exists address    text not null default '';   -- 현장 주소
alter table public.sites add column if not exists pm_id      text;                       -- 담당 PM (members.id)
alter table public.sites add column if not exists start_date date;                       -- 공사 시작일
alter table public.sites add column if not exists end_date   date;                       -- 공사 종료일
alter table public.sites add column if not exists photo      text not null default '';   -- (예전) 현장 사진 한 장
alter table public.sites add column if not exists photos     text[] not null default '{}'; -- 현장 사진 주소들 (여러 장)
update public.sites set photos = array[photo] where photo <> '' and cardinality(photos) = 0;   -- 한 장으로 올린 사진을 여러 장 칸으로 옮긴다
alter table public.sites add column if not exists extensions jsonb not null default '[]';   -- 마감일 변경(연장·단축) 이력
-- memo 칸은 '특이사항'으로 쓴다
alter table public.sites enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites']);
notify pgrst, 'reload schema';
