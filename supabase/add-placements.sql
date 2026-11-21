-- 현장배치(날짜·시간대(오전/오후)별 현장 배치) + '현장배치' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.placements (
  id         bigint generated always as identity primary key,
  date       date not null,                        -- 배치 날짜
  slot       text not null default 'am' check (slot in ('am','pm','ot','nt')),   -- 오전 / 오후 / 야간(0.5일) / 심야(1일) (종일 = 오전·오후 두 행)
  site_id    text not null,                        -- sites.id
  member_id  text not null,                        -- members.id
  created_at timestamptz not null default now(),
  unique (date, slot, member_id)                   -- 한 사람은 같은 날 같은 시간대에 한 현장만
);
create index if not exists placements_date on public.placements (date);
alter table public.placements enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

-- 예전(오전/오후 구분 없이 하루 한 현장) 테이블을 쓰고 있었다면 한 번만 바꿔 준다: 기존 배치는 종일(오전+오후)로 옮긴다.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'placements' and column_name = 'slot') then
    alter table public.placements add column slot text not null default 'am' check (slot in ('am','pm'));
    alter table public.placements drop constraint if exists placements_date_member_id_key;   -- 예전 규칙(하루 한 현장)을 먼저 없애야 오후 복사본을 넣을 수 있다
    insert into public.placements (date, slot, site_id, member_id) select date, 'pm', site_id, member_id from public.placements;
    alter table public.placements add constraint placements_date_slot_member_key unique (date, slot, member_id);
  end if;
end $$;

-- 야간·심야를 쓸 수 있게 slot 값 범위를 넓힌다 (이미 넓혀져 있어도 안전).
alter table public.placements drop constraint if exists placements_slot_check;
alter table public.placements add constraint placements_slot_check check (slot in ('am','pm','ot','nt'));


create table if not exists public.placement_notes (
  id         bigint generated always as identity primary key,
  date       date not null,                        -- 날짜
  site_id    text not null,                        -- sites.id
  note       text not null,                        -- 그날 이 현장의 작업 내용 (예: 방통 주방 방수)
  unique (date, site_id)
);
alter table public.placement_notes enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases']);
notify pgrst, 'reload schema';
