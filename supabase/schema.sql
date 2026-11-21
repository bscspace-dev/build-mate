-- 빌드메이트 · Supabase 테이블
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체를 붙여넣고 Run.
-- 여러 번 실행해도 안전합니다 (이미 있으면 건너뜀).

-- ───────── 자재 (출처 사이트 구분 없이 하나로 통합) ─────────
-- deleted_at 이 null 이면 사용 중, 값이 있으면 휴지통. 영구 삭제는 행을 지운다.
create table if not exists public.products (
  key            text primary key,            -- 예: p0001 (이미지 파일 이름과 같다: /catalog/p0001.webp)
  seq            integer not null,            -- 목록 순서
  category       text not null,
  sub            text not null default '',
  name           text not null,
  brand          text not null default '',
  price          integer,
  price_incl_vat integer,
  vat_basis      text,
  soldout        boolean not null default false,
  stock          integer not null default 0 check (stock >= 0),   -- 회사 재고 수량
  kind           text not null default '상비품' check (kind in ('연장','상비품','자재')),   -- 장비운용 분류
  image          text not null default '',
  trades         text[] not null default '{}',
  deleted_at     timestamptz
);
create index if not exists products_active_seq on public.products (seq) where deleted_at is null;
create index if not exists products_trash on public.products (deleted_at) where deleted_at is not null;

-- ───────── 소모품 카테고리 ─────────
-- 비어 있는 카테고리도 남길 수 있도록 이름 목록을 따로 둔다. (자재에만 있고 여기에 없는 카테고리는 앱이 보여 준다)
create table if not exists public.categories (
  name       text primary key,
  sort       integer not null default 1000,
  trade      text not null default '',     -- 묶어 보여 줄 공정 (빈 값 = 미지정)
  created_at timestamptz not null default now()
);
alter table public.categories add column if not exists trade text not null default '';
create unique index if not exists categories_name_unique on public.categories (lower(name));

-- ───────── 팀 ─────────
-- 구조: 구분(사내/협력) → 부서(사무실/현장/외주) → 팀명.  사무실·현장은 사내, 외주는 협력 (앱에 고정).
-- 구분·부서는 고정이고 팀명만 최고 관리자·개발팀이 추가·삭제한다. locked 팀(최고 관리자·개발팀·현장작업자·현장관리자(PM))은 지울 수 없다.
create table if not exists public.teams (
  key        text primary key,
  label      text not null,
  grp        text not null check (grp in ('office','field','outsource')),   -- 사무실 / 현장 / 외주
  locked     boolean not null default false,
  sort       integer not null default 1000,
  created_at timestamptz not null default now()
);
create unique index if not exists teams_label_unique on public.teams (lower(label));

insert into public.teams (key, label, grp, locked, sort) values
  ('design',    '디자인팀',       'office',    false, 1),
  ('marketing', '마케팅팀',       'office',    false, 2),
  ('super',     '최고 관리자',    'office',    true,  3),
  ('dev',       '개발팀',         'office',    true,  4),
  ('sales',     '영업팀',         'office',    false, 5),
  ('worker',    '현장작업자(정)', 'field',     true,  6),
  ('worker_sub','현장작업자(부)', 'field',     true,  7),
  ('pm',        '현장관리자(PM)', 'field',     true,  8),
  ('partner',   '협력업체',       'outsource', false, 9)
on conflict (key) do nothing;

-- ───────── 회원 ─────────
-- role   : 소속 팀(teams.key). 소속 회원이 있는 팀은 지울 수 없다.
-- menus  : 팀 기본 메뉴 외에 최고 관리자·개발팀이 추가로 부여한 메뉴 ('catalog' 소모품, 'survey' 설문 참여)
-- actions: 부여받은 메뉴별 허용 동작 예: {"catalog":["delete"]}  (등록 register / 수정 edit / 삭제 delete)
-- trades : 설문에 참여하는 회원만 1~3개 (이 규칙은 앱이 확인한다)
create table if not exists public.members (
  id                   text primary key,
  name                 text not null,
  role                 text not null references public.teams(key) on delete restrict,
  extra_role           text references public.teams(key) on delete restrict,   -- 겸직 팀 (사무실 팀 + 현장 팀을 함께 가질 때)
  pay_type             text check (pay_type in ('daily','office')),            -- 급여 기준: daily 일수제 / office 4대보험 사무직 기준 (비우면 주 팀 기준 자동)
  trades               text[] not null default '{}' check (cardinality(trades) <= 3),
  categories           text[] not null default '{}' check (cardinality(categories) <= 9),  -- 설문에서 맡는 카테고리 (공정 아래, 공정마다 최대 3개 → 최대 9개)
  handles              text   not null default '',   -- 거래처 취급품목
  phone                text   not null default '',   -- 연락처
  address              text   not null default '',   -- 주소
  menus                text[] not null default '{}' check (menus <@ array['catalog','survey','requests','vehicles','suppliers','sites','placements','attendance','leave','purchases']),
  actions              jsonb  not null default '{}',
  login_id             text,
  pass_hash            text,                  -- 비밀번호 원문은 저장하지 않는다 (scrypt 해시)
  must_change_password boolean not null default true,   -- 임시 비밀번호 상태: 첫 로그인 때 새 비밀번호를 정해야 한다
  id_changed           boolean not null default false,  -- 본인이 아이디를 이미 한 번 바꿨는가 (이후엔 최고 관리자·개발팀만 변경)
  created_at           timestamptz not null default now()
);
create unique index if not exists members_name_unique  on public.members (lower(name));
create unique index if not exists members_login_unique on public.members (login_id) where login_id is not null;

-- ───────── 설문 응답 ─────────
create table if not exists public.responses (
  id           bigint generated always as identity primary key,
  worker_id    text,                          -- 응답한 회원의 id (members.id). 회원이 지워져도 응답은 남긴다
  name         text not null,
  trade        text not null,
  at           timestamptz not null default now(),
  items        text[] not null default '{}',
  custom       jsonb not null default '[]',
  legacy_file  text unique                    -- 파일 방식에서 옮겨온 응답의 원래 파일명 (중복 이관 방지)
);
create index if not exists responses_worker_trade on public.responses (worker_id, trade);

-- ───────── 현장 자재 요청 ─────────
create table if not exists public.requests (
  id        bigint generated always as identity primary key,
  worker_id text,
  name      text not null,
  trade     text not null,
  site      text not null default '',              -- 요청한 현장
  at        timestamptz not null default now(),
  items     jsonb not null default '[]',           -- [{ k: 자재번호, n: 이름, i: 이미지, q: 수량 }]
  done      boolean not null default false,        -- 준비 완료 처리됐는가
  done_at   timestamptz,
  done_by   text
);
create index if not exists requests_at on public.requests (at desc);
create index if not exists requests_pending on public.requests (at desc) where done = false;
alter table public.requests enable row level security;

-- ───────── 설정(공정 목록 등) ─────────
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);

-- ───────── 보안 ─────────
-- RLS(행 수준 보안)를 켜고 정책은 만들지 않는다.
-- → 브라우저에서 공개 키(anon / publishable)로는 아무것도 읽거나 쓸 수 없고,
--   서버가 쓰는 비밀 키(service_role / secret)만 접근한다. 비밀번호 해시가 들어 있으므로 중요합니다.
alter table public.products     enable row level security;
alter table public.teams        enable row level security;
alter table public.categories   enable row level security;
alter table public.members      enable row level security;
alter table public.responses    enable row level security;
alter table public.app_settings enable row level security;

-- ───────── 차량운용 ─────────
create table if not exists public.vehicles (
  id         bigint generated always as identity primary key,
  name       text not null unique,                 -- 차량 번호
  nickname   text not null default '',             -- 별칭 (예: 1호차)
  icon       text not null default '🚚',            -- 차량 아이콘
  driver_id  text,                                  -- 배차된 회원 (members.id)
  memo       text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists vehicles_nickname on public.vehicles (nickname) where nickname <> '';
create table if not exists public.vehicle_items (
  id          bigint generated always as identity primary key,
  vehicle_id  bigint not null references public.vehicles(id),
  product_key text not null,
  qty         integer not null check (qty > 0),
  note        text not null default '',
  at          timestamptz not null default now()
);
create index if not exists vehicle_items_vehicle on public.vehicle_items (vehicle_id);
alter table public.vehicles      enable row level security;
alter table public.vehicle_items enable row level security;

-- ───────── 현장 (자재 요청에서 고르는 등록된 현장) ─────────
create table if not exists public.sites (
  id         bigint generated always as identity primary key,
  name       text not null unique,                 -- 현장명
  address    text not null default '',             -- 현장 주소
  pm_id      text,                                 -- 담당 PM (members.id)
  start_date date,                                 -- 공사 시작일
  end_date   date,                                 -- 공사 종료일
  memo       text not null default '',             -- 특이사항
  photo      text not null default '',             -- (예전) 현장 사진 한 장
  photos     text[] not null default '{}',         -- 현장 사진 주소들 (여러 장)
  extensions jsonb not null default '[]',          -- 마감일 변경(연장·단축) 이력
  created_at timestamptz not null default now()
);
alter table public.sites enable row level security;

-- ───────── 현장 배치 (날짜별로 누가 어느 현장에 가는지) ─────────
create table if not exists public.placements (
  id         bigint generated always as identity primary key,
  date       date not null,                        -- 배치 날짜
  slot       text not null default 'am' check (slot in ('am','pm','ot','nt')),   -- 오전 / 오후 / 야간 / 심야 (종일 = 두 행)
  site_id    text not null,                        -- sites.id
  member_id  text not null,                        -- members.id
  created_at timestamptz not null default now(),
  unique (date, slot, member_id)                   -- 한 사람은 같은 날 같은 시간대에 한 현장만
);
create index if not exists placements_date on public.placements (date);
alter table public.placements enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

create table if not exists public.placement_notes (
  id         bigint generated always as identity primary key,
  date       date not null,                        -- 날짜
  site_id    text not null,                        -- sites.id
  note       text not null,                        -- 그날 이 현장의 작업 내용 (예: 방통 주방 방수)
  unique (date, site_id)
);
alter table public.placement_notes enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

-- ───────── 휴가 신청 ─────────
create table if not exists public.leave_requests (
  id            bigint generated always as identity primary key,
  member_id     text not null,                          -- 신청한 회원 (members.id)
  start_date    date not null,                          -- 휴가 시작일
  end_date      date not null,                          -- 휴가 종료일
  kind          text not null default 'full' check (kind in ('full','am','pm')),   -- 종일 / 오전 반차 / 오후 반차
  reason        text not null,                          -- 사유
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),   -- 승인 대기 / 승인 / 반려
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,                            -- 승인·반려한 시각
  decided_by    text,                                   -- 승인·반려한 사람 이름
  decision_note text                                    -- 승인·반려 메모 (반려 사유 등)
);
create index if not exists leave_requests_member on public.leave_requests (member_id);
create index if not exists leave_requests_status on public.leave_requests (status);
alter table public.leave_requests enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근

-- ───────── 구매관리 ─────────
create table if not exists public.purchases (
  id         bigint generated always as identity primary key,
  name       text not null,                          -- 품목명
  url        text not null default '',               -- 구매 링크
  price      integer not null default 0 check (price >= 0),   -- 개당 가격(원)
  qty        integer not null default 1 check (qty >= 1),     -- 수량
  memo       text not null default '',
  status     text not null default 'want' check (status in ('want','ordered','done')),   -- 구매 예정 / 주문함 / 구매 완료
  created_by text not null default '',               -- 등록한 사람 이름
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_status on public.purchases (status);
alter table public.purchases enable row level security;   -- 정책을 만들지 않는다: 서버의 비밀 키로만 접근
