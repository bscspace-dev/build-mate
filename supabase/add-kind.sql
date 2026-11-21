-- 장비운용 분류(연장/상비품/자재) 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
alter table public.products add column if not exists kind text not null default '상비품';
alter table public.products drop constraint if exists products_kind_check;
update public.products set kind = '상비품' where kind = '소모품';
alter table public.products alter column kind set default '상비품';
alter table public.products add constraint products_kind_check check (kind in ('연장','상비품','자재'));
notify pgrst, 'reload schema';
