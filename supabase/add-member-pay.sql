-- 회원이 사무실·현장 팀을 함께 가질 수 있게(겸직 팀) + 급여 기준(일수제 / 4대보험 사무직 기준) 칸 추가.
-- Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
alter table public.members add column if not exists extra_role text references public.teams(key) on delete restrict;   -- 겸직 팀 (없으면 비움)
alter table public.members add column if not exists pay_type   text check (pay_type in ('daily','office'));            -- 급여 기준: daily 일수제 / office 4대보험 사무직 기준 (비우면 주 팀 기준 자동)
notify pgrst, 'reload schema';
