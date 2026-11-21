-- '거래처' 메뉴(거래처 목록 보기)를 회원에게 부여할 수 있게 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
-- 현장작업자(정/부)·현장관리자(PM)·최고 관리자·개발팀은 부여 없이 기본으로 쓸 수 있어요.
alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers']);
notify pgrst, 'reload schema';
