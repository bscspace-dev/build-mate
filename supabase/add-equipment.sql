-- 장비정보(연장 정보와 최저가) + '장비정보' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.equipment (
  id         bigint generated always as identity primary key,
  name       text not null,                          -- 장비명
  brand      text not null default '',               -- 브랜드
  model      text not null default '',               -- 모델명
  category   text not null default '',               -- 용도·분류
  spec       text not null default '',               -- 스펙·메모
  query      text not null default '',               -- 네이버 검색어 (비우면 브랜드 + 모델명)
  offers     jsonb not null default '[]'::jsonb,     -- 직접 등록한 판매처 가격 [{id, mall, price, url, at}]
  naver      jsonb,                                  -- 네이버 쇼핑 최저가 {price, mall, url, title, at}
  history    jsonb not null default '[]'::jsonb,     -- 최저가 변동 기록 [{at, price, mall}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.equipment enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases','expenses','equipment']);
notify pgrst, 'reload schema';
