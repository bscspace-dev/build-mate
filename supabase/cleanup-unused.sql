-- 안 쓰는 테이블·컬럼·설정 정리. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
-- ⚠ 장비정보(equipment)·구매관리(purchases) 테이블의 예전 데이터가 지워집니다. 필요하면 먼저 내려받아 두세요.
--   (구매관리 데이터는 경비관리로 옮겨져 있어서 더 이상 쓰이지 않습니다.)

-- 1) 쓰지 않는 메뉴 부여를 먼저 정리한 뒤, 허용 목록에서 'equipment', 'purchases' 를 뺀다
update public.members set menus = array_remove(array_remove(menus, 'equipment'), 'purchases') where menus && array['equipment','purchases'];
alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','expenses','inventory','pricing','history','members','staff','payroll']);

-- 2) 쓰지 않는 테이블
drop table if exists public.equipment;
drop table if exists public.purchases;

-- 3) 장비조사·가격조사의 쓰지 않는 컬럼·기록 종류
alter table public.inventory_entries drop column if exists old_price;
delete from public.inventory_entries where action = 'price';
alter table public.inventory_entries drop constraint if exists inventory_entries_action_check;
alter table public.inventory_entries add constraint inventory_entries_action_check check (action in ('add','delete','buy'));

-- 4) 쓰지 않는 설정값 (구매 예정 수량은 화면에서만 들고 있고, 팀별 공정은 팀의 '관여 공정'을 쓴다)
delete from public.app_settings where key in ('pricing_qty', 'team_categories');

notify pgrst, 'reload schema';
