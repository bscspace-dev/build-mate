-- 차량 관리 정보(차종·연식·차대번호·소유 형태·주행거리·엔진오일 관리·검사일). Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
alter table public.vehicles add column if not exists model text not null default '';            -- 차종 (포터, 봉고, K3)
alter table public.vehicles add column if not exists year text not null default '';             -- 연식
alter table public.vehicles add column if not exists vin text not null default '';              -- 차대번호
alter table public.vehicles add column if not exists ownership text not null default '';       -- 소유 형태: owned 소유 / lease 리스 / rent 장기렌트
alter table public.vehicles add column if not exists mileage integer not null default 0;       -- 현재 주행거리(km)
alter table public.vehicles add column if not exists oil_date date;                            -- 엔진오일 마지막 교환일
alter table public.vehicles add column if not exists oil_km integer not null default 0;        -- 마지막 교환 때 주행거리(km)
alter table public.vehicles add column if not exists inspection_date date;                     -- 차량 검사 만료·예정일
alter table public.vehicles add column if not exists photos jsonb not null default '[]'::jsonb;   -- 현황 사진 [{url, at, by, byId, note}] (새 사진이 앞)
alter table public.vehicles add column if not exists insurer text not null default '';            -- 보험사
alter table public.vehicles add column if not exists policy_no text not null default '';           -- 증권번호
alter table public.vehicles add column if not exists insurance_expiry date;                        -- 보험 만기일
alter table public.vehicles add column if not exists premium integer not null default 0;           -- 연 보험료(원)
alter table public.vehicles add column if not exists insurance_phone text not null default '';     -- 보험 연락처
alter table public.vehicles add column if not exists insurance_note text not null default '';      -- 보험 특이사항
notify pgrst, 'reload schema';
