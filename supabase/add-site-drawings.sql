-- 현장 도면(이미지·PDF) 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
alter table public.sites add column if not exists drawings text[] not null default '{}';
