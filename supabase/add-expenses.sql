-- 경비관리(식대·자재구매 영수증, 세금계산서를 올리면 경리가 엑셀로 정리) + '경리팀' 직급 + '경비관리' 메뉴 부여 허용. Supabase SQL Editor 에서 한 번 실행하세요. (여러 번 실행해도 안전)
create table if not exists public.expenses (
  id          bigint generated always as identity primary key,
  spent_on    date not null,                          -- 쓴 날짜
  site        text not null default '',               -- 현장 이름
  category    text not null default 'meal' check (category in ('meal','drink','materials','fuel','parking','supplies','other')),   -- 식사 / 음료 / 유류비 / 주차·통행 / 공구·소모품 / 기타
  amount      integer not null default 0 check (amount >= 0),   -- 금액(원)
  memo        text not null default '',               -- 무엇을 먹었는지·샀는지
  photos      text[] not null default '{}',           -- 영수증 사진 주소들
  member_id   text not null default '',               -- 올린 회원
  member_name text not null default '',
  created_at  timestamptz not null default now()
);
alter table public.expenses add column if not exists doc_type text not null default 'receipt';   -- 영수증 / 세금계산서
alter table public.expenses add column if not exists vendor text not null default '';                      -- 상호·거래처
alter table public.expenses add column if not exists pay_method text not null default 'card';              -- 카드 / 현금 / 계좌이체
alter table public.expenses add column if not exists booked boolean not null default false;                -- 경리가 정리했는가
alter table public.expenses add column if not exists booked_by text not null default '';
alter table public.expenses add column if not exists booked_at timestamptz;
alter table public.expenses add column if not exists purchase_id text not null default '';   -- 구매관리에서 완료된 요청이 만든 경비면 그 요청 번호
alter table public.expenses add column if not exists status text not null default 'done';   -- 구매요청의 진행: requested 대기 / done 완료 (영수증·세금계산서는 done)
alter table public.expenses add column if not exists link text not null default '';              -- 구매요청의 구매 링크
alter table public.expenses add column if not exists account text not null default '';           -- 세금계산서의 입금할 계좌번호

-- 예전 '구매관리' 메뉴를 경비관리의 「구매요청」으로 합친다. 대기 중인 구매 요청은 구매요청(대기)로 옮기고, 이미 완료되어 넘어온 건은 구매요청(완료)로 바꾼다. (여러 번 실행해도 중복되지 않는다. purchases 에 없는 칸은 기본값으로 채운다)
do $$
declare
  cat_expr text;
  photo_expr text;
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'purchases') then
    cat_expr := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchases' and column_name = 'category') then 'coalesce(p.category, ''supplies'')' else '''supplies''' end;
    photo_expr := case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchases' and column_name = 'photos') then 'coalesce(p.photos, ''{}'')' else '''{}''::text[]' end;
    execute format($f$
      insert into public.expenses (spent_on, site, category, amount, memo, doc_type, vendor, pay_method, photos, member_id, member_name, status, link, purchase_id, created_at)
      select (coalesce(p.requested_at, p.created_at) at time zone 'Asia/Seoul')::date, coalesce(p.site, ''), %s,
             least(99999999::bigint, p.price::bigint * p.qty + case when p.shipping = 'separate' then coalesce(p.shipping_fee, 0) else 0 end)::integer,
             left(p.name || case when coalesce(p.memo, '') <> '' then ' — ' || p.memo else '' end, 200), 'request',
             coalesce(substring(p.url from '^(?:https?://)?(?:www\.|m\.)?([^/?#]+)'), ''), 'card', %s, '', p.created_by, 'requested', p.url, p.id::text, coalesce(p.requested_at, p.created_at)
      from public.purchases p
      where p.status in ('requested', 'want', 'ordered') and not exists (select 1 from public.expenses e where e.purchase_id = p.id::text)
    $f$, cat_expr, photo_expr);
    update public.expenses e
       set doc_type = 'request', status = 'done', link = p.url,
           vendor = coalesce(substring(p.url from '^(?:https?://)?(?:www\.|m\.)?([^/?#]+)'), ''),
           memo = left(p.name || case when coalesce(p.memo, '') <> '' then ' — ' || p.memo else '' end, 200)
      from public.purchases p
     where e.purchase_id = p.id::text and e.purchase_id <> '';
  end if;
end $$;
alter table public.expenses drop constraint if exists expenses_category_check;   -- 이미 만들었다면 분류(유류비·주차·공구 등)를 넓힌다
alter table public.expenses add constraint expenses_category_check check (category in ('meal','drink','materials','fuel','parking','supplies','other'));
create index if not exists expenses_spent_on on public.expenses (spent_on);
create index if not exists expenses_member on public.expenses (member_id);
alter table public.expenses enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

insert into public.teams (key, label, grp, locked, sort) values ('accounting', '경리팀', 'office', true, 10) on conflict (key) do nothing;   -- 경리 직급(경비 서류를 보고 엑셀로 정리)

alter table public.members drop constraint if exists members_menus_check;
alter table public.members add constraint members_menus_check check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases','expenses']);
notify pgrst, 'reload schema';
