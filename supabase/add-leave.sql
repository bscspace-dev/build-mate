-- 휴가신청(사유 작성 → 관리자 승인 시 휴가 처리) + '휴가신청' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.leave_requests (
  id            bigint generated always as identity primary key,
  member_id     text not null,                          -- 신청한 회원 (members.id)
  start_date    date not null,                          -- 휴가 시작일
  end_date      date not null,                          -- 휴가 종료일
  kind          text not null default 'full' check (kind in ('full','am','pm')),   -- 종일 / 오전 반차 / 오후 반차
  reason        text not null,                          -- 사유
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),   -- 승인 대기 / 승인 / 반려
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,                            -- 승인·반려한 시각
  decided_by    text,                                   -- 승인·반려한 사람 이름
  decision_note text                                    -- 승인·반려 메모 (반려 사유 등)
);
create index if not exists leave_requests_member on public.leave_requests (member_id);
create index if not exists leave_requests_status on public.leave_requests (status);
alter table public.leave_requests enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases']);
notify pgrst, 'reload schema';
