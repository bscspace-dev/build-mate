-- 거래처(팀 키: outsource)는 같은 이름을 여러 곳 등록할 수 있게 한다.
-- 사내 회원의 이름 중복 금지는 그대로 둔다. Supabase SQL Editor에서 한 번 실행한다.
drop index if exists public.members_name_unique;
create unique index if not exists members_name_unique on public.members (lower(name)) where role <> 'outsource';
