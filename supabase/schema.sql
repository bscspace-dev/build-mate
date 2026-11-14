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
  ('worker',    '현장작업자',     'field',     true,  6),
  ('pm',        '현장관리자(PM)', 'field',     true,  7),
  ('partner',   '협력업체',       'outsource', false, 8)
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
  trades               text[] not null default '{}' check (cardinality(trades) <= 3),
  categories           text[] not null default '{}' check (cardinality(categories) <= 9),  -- 설문에서 맡는 카테고리 (공정 아래, 공정마다 최대 3개 → 최대 9개)
  menus                text[] not null default '{}' check (menus <@ array['catalog','survey']),
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
