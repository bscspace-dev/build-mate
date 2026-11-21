-- 현장작업자를 (정) / (부) 로 분리. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
-- 기존 '현장작업자' 팀과 그 회원은 그대로 '현장작업자(정)'이 됩니다. (실행하지 않아도 사이트가 처음 열릴 때 자동으로 만들어요)
update public.teams set label = '현장작업자(정)' where key = 'worker' and label = '현장작업자';
update public.teams set sort = 8 where key = 'pm';
insert into public.teams (key, label, grp, locked, sort) values ('worker_sub', '현장작업자(부)', 'field', true, 7) on conflict (key) do nothing;
notify pgrst, 'reload schema';
