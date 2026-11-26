-- 장비조사(상비품 추가·삭제 내역) + '장비조사' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.inventory_entries (
  id          bigint generated always as identity primary key,
  action      text not null default 'add' check (action in ('add','delete')),  -- add = 상비품 추가, delete = 상비품 삭제(휴지통으로)
  category    text not null,                          -- 창고장비현황 카테고리
  product_key text not null default '',               -- 자재 번호 (예: p0001)
  name        text not null,                          -- 품목 이름 (등록 때 값)
  brand       text not null default '',
  qty         integer not null default 0 check (qty >= 0),   -- 추가할 때 정한 재고
  memo        text not null default '',
  by_id       text,                                   -- 등록한 회원 id
  by_name     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists inventory_entries_category_idx on public.inventory_entries (category);
alter table public.inventory_entries add column if not exists action text not null default 'add' check (action in ('add','delete'));
alter table public.inventory_entries add column if not exists price integer not null default 0;   -- 가격조사: 구매 때 금액(단가)
alter table public.inventory_entries add column if not exists shipping integer not null default 0;   -- 가격조사: 구매 때 배송비
alter table public.inventory_entries add column if not exists vendor text not null default '';   -- 가격조사: 구매처
alter table public.inventory_entries add column if not exists unit text not null default '';   -- 가격조사: 판매단위
alter table public.inventory_entries drop constraint if exists inventory_entries_action_check;
alter table public.inventory_entries add constraint inventory_entries_action_check check (action in ('add','delete','buy'));   -- buy = 가격조사에서 구매완료
alter table public.inventory_entries enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','expenses','inventory','pricing','history','members','staff','payroll']);
notify pgrst, 'reload schema';
