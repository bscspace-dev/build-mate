-- 현장요청 '준비 완료' 처리 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
-- 이미 들어와 있던 요청은 완료된 것으로 두고(default true), 앞으로 들어오는 요청은 '준비 중'(default false)으로 시작합니다.
alter table public.requests add column if not exists done boolean not null default true;
alter table public.requests alter column done set default false;
alter table public.requests add column if not exists done_at timestamptz;
alter table public.requests add column if not exists done_by text;
create index if not exists requests_pending on public.requests (at desc) where done = false;
notify pgrst, 'reload schema';
