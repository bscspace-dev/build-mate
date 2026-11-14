-- 거래처 정보(취급품목·연락처·주소) 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
alter table public.members add column if not exists handles text not null default '';
alter table public.members add column if not exists phone   text not null default '';
alter table public.members add column if not exists address text not null default '';
