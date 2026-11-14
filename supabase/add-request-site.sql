-- 요청에 '현장' 칸 추가. add-requests.sql 을 이미 실행했다면 이 파일만 한 번 더 실행하세요 (SQL Editor).
alter table public.requests add column if not exists site text not null default '';
notify pgrst, 'reload schema';
