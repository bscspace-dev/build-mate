-- '출근관리' 메뉴(현장배치 기반 출근 일수 조회)를 회원에게 부여할 수 있게 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
-- 최고 관리자·개발팀은 부여 없이 기본으로 쓸 수 있어요. 새 테이블은 필요 없어요 (현장배치 데이터를 그대로 써요).
alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases']);
notify pgrst, 'reload schema';
