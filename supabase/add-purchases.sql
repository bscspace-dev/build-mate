-- 구매관리(구매하려는 품목의 링크·가격 정리) + '구매관리' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.purchases (
  id         bigint generated always as identity primary key,
  name       text not null,                          -- 품목명
  brand      text not null default '',               -- 브랜드
  url        text not null default '',               -- 구매 링크
  price      integer not null default 0 check (price >= 0),   -- 개당 가격(원)
  qty        integer not null default 1 check (qty >= 1),     -- 수량
  memo       text not null default '',
  tags       text[] not null default '{}',           -- 묶어 보기용 태그
  status     text not null default 'want' check (status in ('want','ordered','done')),   -- 구매 예정 / 주문함 / 구매 완료
  created_by text not null default '',               -- 등록한 사람 이름
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.purchases add column if not exists brand text not null default '';   -- 이미 테이블을 만들었다면 이 줄이 브랜드 칸을 추가한다
alter table public.purchases add column if not exists tags text[] not null default '{}';   -- 이미 테이블을 만들었다면 이 줄이 태그 칸을 추가한다
create index if not exists purchases_status on public.purchases (status);
alter table public.purchases enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases']);
notify pgrst, 'reload schema';
