-- 변경이력(모든 메뉴의 추가·수정·삭제 기록) + '변경이력' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  menu     text not null,                 -- 메뉴 key (예: catalog, pricing)
  action   text not null,                 -- 추가 / 수정 / 삭제 / 구매완료 …
  target   text not null default '',      -- 대상 (품목 이름 등)
  detail   text not null default '',      -- 바뀐 내용 요약
  by_id    text,                          -- 한 사람 id (내장 최고 관리자는 비움)
  by_name  text not null default ''
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','expenses','inventory','pricing','history','members','staff','payroll']);
notify pgrst, 'reload schema';
