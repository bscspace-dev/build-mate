-- 차량운용: 차량 · 차량에 배치된 품목(연장/상비품) + '차량운용' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요.
create table if not exists public.vehicles (
  id         bigint generated always as identity primary key,
  name       text not null unique,                 -- 차량 번호
  nickname   text not null default '',             -- 별칭 (예: 1호차)
  icon       text not null default '🚚',            -- 차량 아이콘
  memo       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.vehicles add column if not exists nickname text not null default '';   -- 이미 만들었다면 이 줄이 별칭 칸을 추가한다
alter table public.vehicles add column if not exists driver_id text;                           -- 배차된 회원 (members.id)
alter table public.vehicles add column if not exists icon text not null default '🚚';          -- 이미 만들었다면 이 줄이 아이콘 칸을 추가한다
create unique index if not exists vehicles_nickname on public.vehicles (nickname) where nickname <> '';
create table if not exists public.vehicle_items (
  id          bigint generated always as identity primary key,
  vehicle_id  bigint not null references public.vehicles(id),
  product_key text not null,                       -- products.key (품목이 영구 삭제돼도 기록은 남긴다)
  qty         integer not null check (qty > 0),    -- 연장은 1, 상비품은 나간 수량
  note        text not null default '',            -- 연장 개체 구분용 일련번호·메모
  at          timestamptz not null default now()
);
create index if not exists vehicle_items_vehicle on public.vehicle_items (vehicle_id);
alter table public.vehicles      enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근
alter table public.vehicle_items enable row level security;

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles']);
notify pgrst, 'reload schema';
