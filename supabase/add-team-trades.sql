-- 현장 팀이 관여하는 공정 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
alter table public.teams add column if not exists trades text[] not null default '{}';
