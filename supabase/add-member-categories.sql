-- 회원에 '맡는 카테고리'(공정마다 최대 3개, 공정은 최대 3개 → 최대 9개) 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
-- 예전 버전(최대 3개)을 이미 실행했어도 다시 실행하면 9개로 바뀝니다.
alter table public.members add column if not exists categories text[] not null default '{}';
alter table public.members drop constraint if exists members_categories_check;
alter table public.members add constraint members_categories_check check (cardinality(categories) <= 9);
