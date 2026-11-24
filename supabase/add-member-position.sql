-- 회원 직급(사원·대리·과장 등) 칸 추가. Supabase SQL Editor 에서 한 번 실행하세요.
alter table public.members add column if not exists position text not null default '';

-- 현장 역할 여러 개(PM·사수·부사수)와 사무실 구분(수습/정규)
alter table public.members add column if not exists field_roles text[] not null default '{}';
alter table public.members add column if not exists office_status text not null default '' check (office_status in ('','probation','regular'));

-- 입사일
alter table public.members add column if not exists hire_date date;

-- 퇴사일
alter table public.members add column if not exists resign_date date;

-- 급여(일당 또는 월급, 원)
alter table public.members add column if not exists pay_amount integer not null default 0;

-- 급여 계좌, 안전교육 이수일, 면허 정보
alter table public.members add column if not exists bank text not null default '';
alter table public.members add column if not exists account_no text not null default '';
alter table public.members add column if not exists account_holder text not null default '';
alter table public.members add column if not exists safety_date date;
alter table public.members add column if not exists license text not null default '';

-- 퇴사·복직 이력 (복직할 때 지난 재직 기간을 남긴다)
alter table public.members add column if not exists employment_history jsonb not null default '[]';

-- 프로필 사진
alter table public.members add column if not exists photo text not null default '';

-- 급여 통장 사본
alter table public.members add column if not exists bankbook text not null default '';

-- 세부 주소
alter table public.members add column if not exists address_detail text not null default '';

-- 회원등록·회원정보 메뉴도 회원에게 부여할 수 있게 허용 목록에 추가
alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases','expenses','equipment','members','staff']);

-- 월급관리 메뉴를 회원에게 부여할 수 있게 허용 목록에 추가
alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases','expenses','equipment','members','staff','payroll']);

-- 급여 금액 이력 (금액을 바꾸면 다음 급여 기간부터 적용)
alter table public.members add column if not exists pay_history jsonb not null default '[]';
