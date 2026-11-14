-- 소모품 재고 수량 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
alter table public.products add column if not exists stock integer not null default 0 check (stock >= 0);
notify pgrst, 'reload schema';
