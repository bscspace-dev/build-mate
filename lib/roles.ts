// 팀·메뉴 정의 (서버·브라우저 공용).
//
//  구조: 구분(사내 / 협력) → 부서(사무실 / 현장 / 외주) → 팀명(= 직급)
//   · 사내 = 사무실 + 현장,  협력 = 외주
//   · 구분과 부서는 고정이라 수정할 수 없다. 팀명만 최고 관리자·개발팀이 추가·삭제한다(이름 변경은 없음).
//   · 팀명은 저장되는 데이터다(DEFAULT_TEAMS 가 처음 한 번 채워진다). 회원의 직급(role)은 팀의 key 다.
//   · 기본 동작이 걸린 팀(locked)은 삭제할 수 없다: 최고 관리자·개발팀(관리 권한), 현장작업자(정·부)·현장관리자(PM)(설문).
//
//  메뉴: 팀마다 기본 메뉴가 있고(TEAM_MENUS), 최고 관리자·개발팀이 회원에게 메뉴를 더 부여할 수 있다.
//   · '회원 관리' 는 다른 사람의 계정을 만들고 고치는 강한 권한이라 부여할 수 없고, 최고 관리자·개발팀만 갖는다.
//   · 설문 참여 권한이 있는 회원은 공정(1~3개)을 갖는다.

/** 팀의 key. 처음 만들어지는 팀은 'worker' 처럼 정해진 값, 새로 만든 팀은 't_xxxxxxxx' */
export type RoleKey = string;

// 사내 / 협력
export const SIDES = [
  { key: 'inhouse', label: '사내' },
  { key: 'coop', label: '거래처' },
] as const;
export type SideKey = (typeof SIDES)[number]['key'];

// 부서 — 고정. 사무실·현장은 사내, 외주는 협력.
export const GROUPS = [
  { key: 'office', label: '사무실', side: 'inhouse' },
  { key: 'field', label: '현장', side: 'inhouse' },
  { key: 'outsource', label: '거래처', side: 'coop' },
] as const;
export type GroupKey = (typeof GROUPS)[number]['key'];

export const isGroup = (v: unknown): v is GroupKey => GROUPS.some(g => g.key === v);
export const groupLabel = (g: GroupKey): string => GROUPS.find(x => x.key === g)?.label ?? g;
export const sideLabel = (s: SideKey): string => SIDES.find(x => x.key === s)?.label ?? s;
export const sideOf = (g: GroupKey): SideKey => GROUPS.find(x => x.key === g)?.side ?? 'inhouse';
export const groupsIn = (s: SideKey) => GROUPS.filter(g => g.side === s);

/** 팀명 (= 직급) */
export type Team = { key: string; label: string; group: GroupKey; locked: boolean; trades?: string[] }; // trades: 현장 팀이 관여하는 공정

// 처음 한 번 저장되는 팀들 (이후에는 최고 관리자·개발팀이 추가·삭제). 표시 순서는 이 순서.
export const DEFAULT_TEAMS: Team[] = [
  { key: 'design', label: '디자인팀', group: 'office', locked: false },
  { key: 'marketing', label: '마케팅팀', group: 'office', locked: false },
  { key: 'super', label: '최고 관리자', group: 'office', locked: true },
  { key: 'dev', label: '개발팀', group: 'office', locked: true },
  { key: 'sales', label: '영업팀', group: 'office', locked: false },
  { key: 'accounting', label: '경리팀', group: 'office', locked: false },
  { key: 'worker', label: '현장작업자(정)', group: 'field', locked: false },
  { key: 'worker_sub', label: '현장작업자(부)', group: 'field', locked: false },
  { key: 'pm', label: '현장관리자(PM)', group: 'field', locked: false },
  { key: 'partner', label: '거래처', group: 'outsource', locked: false },
];

/** 지울 수 없는 팀은 관리 권한이 걸린 최고 관리자·개발팀뿐이다 (저장된 locked 값이 예전 것이어도 이 규칙을 따른다). */
export const applyTeamLocks = (list: readonly Team[]): Team[] => list.map(t => ({ ...t, locked: t.key === 'super' || t.key === 'dev' }));

/**
 * 예전에 저장된 팀 목록에 '현장작업자(부)'가 없으면 만들고, 이름이 그대로 '현장작업자'인 기존 팀은 '현장작업자(정)'으로 바꾼다.
 * 바뀐 목록을 돌려주고, 바꿀 것이 없으면 null.
 */
export function withFieldWorkerTeams(list: readonly Team[]): Team[] | null {
  const hasSub = list.some(t => t.key === 'worker_sub');
  const old = list.find(t => t.key === 'worker' && t.label === '현장작업자');
  if (hasSub && !old) return null;
  let next = list.map(t => (t === old ? { ...t, label: '현장작업자(정)' } : t));
  if (!hasSub) {
    const sub: Team = { key: 'worker_sub', label: '현장작업자(부)', group: 'field', locked: true };
    const i = next.findIndex(t => t.key === 'worker');
    next = i >= 0 ? [...next.slice(0, i + 1), sub, ...next.slice(i + 1)] : [...next, sub];
  }
  return next;
}

/**
 * 경리팀: 영수증·세금계산서를 보고 엑셀로 정리하는 사무실 직급. 아직 없으면 만든다 (같은 이름의 팀을 이미 만들어 두었으면 그대로 둔다).
 * 바뀐 목록을 돌려주고, 바꿀 것이 없으면 null.
 */
export function withAccountingTeam(list: readonly Team[]): Team[] | null {
  if (list.some(t => t.key === 'accounting' || t.label === '경리팀')) return null;
  return [...list, { key: 'accounting', label: '경리팀', group: 'office', locked: true }];
}

/** 현장 팀 셋(사수·부사수·PM)은 화면에서 '현장작업자' 하나로 보이고, 역할만 옆에 붙는다. (내부 팀 key 와 기본 메뉴는 그대로) */
export const FIELD_ROLES = [{ key: 'pm', label: 'PM' }, { key: 'worker', label: '사수' }, { key: 'worker_sub', label: '부사수' }] as const;
export const isFieldRole = (key: string) => FIELD_ROLES.some(r => r.key === key);
export const fieldRoleLabel = (key: string): string => FIELD_ROLES.find(r => r.key === key)?.label ?? '';
export const teamLabel = (teams: readonly Team[], key: RoleKey): string => (isFieldRole(key) ? '현장팀 · ' + fieldRoleLabel(key) : teams.find(t => t.key === key)?.label ?? key);
/**
 * 회원이 자재 요청에서 쓸 수 있는 공정 = 속한 팀들이 관여하는 공정(팀 관리에서 정함)의 합.
 * 아무 팀에도 공정을 정해 두지 않았다면 모든 공정을 쓸 수 있다. 공정을 고르면 그 아래 카테고리는 모두 보인다.
 */
export function memberTrades(teams: readonly Team[], m: { role: RoleKey; extraRole?: RoleKey | ''; fieldRoles?: readonly RoleKey[] }, allTrades: readonly string[]): string[] {
  const own = new Set(memberRoles(m).flatMap(r => teams.find(t => t.key === r)?.trades ?? []));
  const picked = allTrades.filter(t => own.has(t));
  return picked.length > 0 ? picked : [...allTrades];
}
export const teamGroup = (teams: readonly Team[], key: RoleKey): GroupKey | null => teams.find(t => t.key === key)?.group ?? null;
export const teamsIn = (teams: readonly Team[], g: GroupKey): Team[] => teams.filter(t => t.group === g);

export const MENUS = [
  { key: 'catalog', label: '창고현황', parent: '운영관리', href: '/admin', grantable: true, desc: '연장·상비품·자재를 보고, 필요 없는 품목을 삭제·복원해요' },
  { key: 'suppliers', label: '거래처관리', parent: '현장관리', href: '/admin/suppliers', grantable: true, desc: '거래처 목록(취급품목·연락처·주소)을 보고, 거래처를 등록·수정·삭제해요' },
  { key: 'sites', label: '현장정보', parent: '현장관리', href: '/admin/sites', grantable: true, desc: '자재 요청에서 고를 현장을 등록·수정·삭제해요' },
  { key: 'placements', label: '현장배치', parent: '현장관리', href: '/admin/placements', grantable: true, desc: '날짜별로 현장작업자를 현장에 배치해요 (작업자는 "내 배치"에서 다음날 현장을 확인)' },
  { key: 'inventory', label: '장비조사', parent: '운영관리', href: '/admin/inventory', grantable: true, desc: '팀이 맡은 카테고리의 창고장비를 목록으로 조사해 수량을 등록·삭제해요 (부여하면 내 팀 카테고리만 보여요)' },
  { key: 'vehicles', label: '차량정보', parent: '운영관리', href: '/admin/vehicles', grantable: true, desc: '차량마다 배치된 연장과 나간 상비품 수량을 보고 관리해요' },
  { key: 'history', label: '변경이력', parent: '인사관리', href: '/admin/history', grantable: true, desc: '모든 메뉴의 추가·수정·삭제를 누가 언제 했는지 모아서 확인해요' },
  { key: 'expenses', label: '경비관리', parent: '인사관리', href: '/admin/expenses', grantable: true, desc: '영수증·세금계산서를 올리거나 구매가 필요한 비품을 요청하면, 담당자가 구매하고 경리가 엑셀로 정리해요' },
  { key: 'requests', label: '자재요청 현황', parent: '현장관리', href: '/admin/requests', grantable: true, desc: '현장에서 들어온 자재 요청(품목과 수량)을 확인해요' },
  { key: 'attendance', label: '출근관리', parent: '인사관리', href: '/admin/attendance', grantable: true, desc: '현장배치를 바탕으로 출근 일수를 표로 조회해요 (보기만 부여하면 본인 출근만, 전체 인원 조회를 주면 모두)' },
  { key: 'leave', label: '연차·휴가관리', parent: '인사관리', href: '/admin/leave', grantable: true, desc: '연차(휴가)를 사유와 함께 신청하고, 관리자가 승인하면 연차로 처리돼요' },
  { key: 'members', label: '회원등록 및 수정', parent: '인사관리', href: '/admin/members', grantable: true, desc: '회원을 만들고 팀·메뉴를 부여하고 비밀번호를 다시 발급해요. 생성일과 부여한 권한도 확인해요' },
  { key: 'staff', label: '회원정보 확인', parent: '인사관리', href: '/admin/staff', grantable: true, desc: '회원 목록에서 급여 기준·연차·직급·연락처 같은 회원 정보를 관리해요' },
  { key: 'payroll', label: '월급관리', parent: '인사관리', href: '/admin/payroll', grantable: true, desc: '그 달 급여를 계산해요 (사무직 월급−4대보험, 일수제 일당×출근) · 계좌와 엑셀 내려받기' },
  { key: 'survey', label: '자재 요청', href: '/survey', grantable: true, desc: '내 공정의 자재를 골라 수량과 함께 요청해요' },
] as const;

export type MenuKey = (typeof MENUS)[number]['key'];

/** 저장된 메뉴 순서(order)를 적용한 전체 메뉴 키. 순서에 없는 메뉴(새로 생긴 메뉴)는 기본 순서대로 뒤에 붙는다. */
export function orderedMenuKeys(order: readonly unknown[] = []): MenuKey[] {
  const list: MenuKey[] = [];
  for (const k of order) if (isMenu(k) && !list.includes(k)) list.push(k);
  // 저장된 순서에 없는 메뉴(새로 생긴 메뉴)는 맨 뒤가 아니라, 기본 순서에서 바로 앞에 있던 메뉴 뒤에 붙인다 (예: 회원관리는 회원등록 바로 밑)
  MENUS.forEach((m, i) => {
    if (list.includes(m.key)) return;
    const prev = MENUS.slice(0, i).map(x => x.key).reverse().find(k => list.includes(k));
    list.splice(prev ? list.indexOf(prev) + 1 : list.length, 0, m.key);
  });
  return list;
}
/** 메뉴 목록을 저장된 순서대로 정렬 */
export const sortMenus = <T extends MenuKey>(keys: readonly T[], order: readonly unknown[] = []): T[] => {
  const rank = new Map(orderedMenuKeys(order).map((k, i) => [k, i]));
  return [...keys].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
};

export const isMenu = (v: unknown): v is MenuKey => MENUS.some(m => m.key === v);
/** 상단 메뉴에서 이 메뉴가 들어가는 상위 메뉴 이름 (없으면 null) — 예: 현장정보 → 현장관리 */
export const menuParent = (k: MenuKey): string | null => {
  const m = MENUS.find(x => x.key === k);
  return m && 'parent' in m ? (m as { parent: string }).parent : null;
};
export const menuLabel = (k: MenuKey): string => MENUS.find(m => m.key === k)?.label ?? k;
export const menuHref = (k: MenuKey): string => MENUS.find(m => m.key === k)?.href ?? '/';
export const menuDesc = (k: MenuKey): string => MENUS.find(m => m.key === k)?.desc ?? '';
/** 부여할 수 있는 메뉴 (회원 관리는 제외) */
export const GRANTABLE_MENUS: MenuKey[] = MENUS.filter(m => m.grantable).map(m => m.key);

// 팀 기본 메뉴는 최고 관리자·개발팀만 갖는다. 그 밖의 팀(새로 만든 팀 포함)은 기본 메뉴가 없어서,
// 최고 관리자·개발팀이 회원별로 부여한 메뉴만 보인다 (부여가 없으면 내 정보만 쓴다).
const TEAM_MENUS: Record<string, MenuKey[]> = {
  super: ['catalog', 'vehicles', 'inventory', 'history', 'suppliers', 'sites', 'placements', 'expenses', 'attendance', 'leave', 'requests', 'members', 'staff', 'payroll'],
  dev: ['catalog', 'vehicles', 'inventory', 'history', 'suppliers', 'sites', 'placements', 'expenses', 'attendance', 'leave', 'requests', 'members', 'staff', 'payroll'],
};

/** 팀 기본 메뉴라도 동작을 줄여야 하는 팀: 여기 없으면 그 메뉴의 모든 동작이 허용된다. (현장 팀은 거래처를 보고 등록만 한다) */
const TEAM_ACTIONS: Record<string, Partial<Record<MenuKey, ActionKey[]>>> = {
  design: { leave: ['view', 'register'], sites: ['view'] },
  marketing: { leave: ['view', 'register'], sites: ['view'] },
  sales: { leave: ['view', 'register'], sites: ['view'] },
  accounting: { leave: ['view', 'register'], sites: ['view'] }, // 경비관리는 모든 동작 가능
  worker: { suppliers: ['view', 'register'], placements: ['view'], leave: ['view', 'register'], expenses: ['view', 'register'], sites: ['view'] }, // 현장정보는 보기와 일지 올리기(코드에서 따로 허용) · 현장배치는 보기만, 휴가는 본인 신청까지, 현장경비는 내 영수증 등록까지
  worker_sub: { suppliers: ['view', 'register'], placements: ['view'], leave: ['view', 'register'], expenses: ['view', 'register'], sites: ['view'] },
  pm: { suppliers: ['view', 'register'], placements: ['view'], leave: ['view', 'register'], expenses: ['view', 'register'], sites: ['view'] },
};

/** 한 팀 또는 여러 팀(겸직). 여러 팀이면 기본 메뉴를 모두 합친다. */
export type RoleSpec = RoleKey | readonly RoleKey[];
const rolesOf = (r: RoleSpec): RoleKey[] => (typeof r === 'string' ? [r] : [...r]);
export const roleMenus = (role: RoleSpec): MenuKey[] => [...new Set(rolesOf(role).flatMap(r => TEAM_MENUS[r] ?? []))];

/** 회원이 가진 팀들: 주 팀 + 겸직 팀 */
export const memberRoles = (m: { role: RoleKey; extraRole?: RoleKey | ''; fieldRoles?: readonly RoleKey[] }): RoleKey[] => [...new Set([m.role, ...(m.extraRole ? [m.extraRole] : []), ...(m.fieldRoles ?? [])])];
export const memberHasRole = (m: { role: RoleKey; extraRole?: RoleKey | ''; fieldRoles?: readonly RoleKey[] }, key: RoleKey) => memberRoles(m).includes(key);
/** 이 부서(사무실/현장/거래처)의 팀을 하나라도 가졌는가 */
export const memberHasGroup = (teams: readonly Team[], m: { role: RoleKey; extraRole?: RoleKey | ''; fieldRoles?: readonly RoleKey[] }, g: GroupKey) => memberRoles(m).some(r => teamGroup(teams, r) === g);
/** 화면에 보일 팀 이름 (겸직이면 "디자인팀 · 현장작업자(정)") */
export const teamsLabel = (teams: readonly Team[], m: { role: RoleKey; extraRole?: RoleKey | ''; fieldRoles?: readonly RoleKey[] }) => {
  const rs = memberRoles(m);
  const parts = rs.filter(r => !isFieldRole(r)).map(r => teamLabel(teams, r));
  const f = rs.filter(isFieldRole);
  if (f.length) {
    const roleText = FIELD_ROLES.filter(x => f.includes(x.key)).map(x => x.label).join('·'); // 여러 역할이면 사수·PM 처럼 한 번에
    const fi = rs.findIndex(r => !isFieldRole(r) && teamGroup(teams, r) === 'field');
    if (fi >= 0) parts[parts.findIndex((_, i) => rs.filter(r => !isFieldRole(r))[i] === rs[fi])] += ' ' + roleText; // 직접 만든 현장 팀이면 그 팀 이름 뒤에 (구조조팀 사수)
    else parts.push('현장팀 · ' + roleText);
  }
  return parts.join(' · ');
};
export const OFFICE_STATUS = [{ v: 'probation', label: '수습' }, { v: 'regular', label: '정규' }] as const;
export const officeStatusLabel = (v: string): string => OFFICE_STATUS.find(x => x.v === v)?.label ?? '';

/** 급여 기준 */
export const PAY_TYPES = [{ v: 'daily', label: '일수제 (일당)' }, { v: 'office', label: '4대보험 사무직 기준' }] as const;
export const payTypeLabel = (p: 'daily' | 'office') => PAY_TYPES.find(x => x.v === p)?.label ?? p;
/** 실제 적용되는 급여 기준: 직접 정했으면 그것, 아니면 주 팀이 사무실이면 사무직 기준, 그 밖(현장 등)은 일수제 */
export const effectivePay = (teams: readonly Team[], m: { role: RoleKey; payType?: '' | 'daily' | 'office' }): 'daily' | 'office' => m.payType || (teamGroup(teams, m.role) === 'office' ? 'office' : 'daily');
/** 4대보험 사무직 기준 = 휴가를 연차에서 차감하는 대상 (일수제는 휴가 일수만 출근에서 제외) */
export const isOfficePay = (teams: readonly Team[], m: { role: RoleKey; payType?: '' | 'daily' | 'office' }) => effectivePay(teams, m) === 'office';

/** 실제로 쓸 수 있는 메뉴 = 팀 기본 메뉴 + 부여받은 메뉴 (메뉴 정의 순서대로) */
export function effectiveMenus(role: RoleSpec, granted: readonly MenuKey[] = [], actions?: GrantedActions): MenuKey[] {
  return MENUS.map(m => m.key).filter(k => roleMenus(role).includes(k) || (granted.includes(k) && viewable(k, actions)));
}

/** 부여받은 메뉴를 볼 수 있는가: '보기'를 골랐거나, 동작을 따로 정하지 않은 예전 부여(= 보기만)일 때 */
function viewable(menu: MenuKey, actions?: GrantedActions): boolean {
  if (!actions || MENU_ACTIONS[menu].length === 0) return true;
  const list = actions[menu];
  return list === undefined || list.includes('view');
}

export const hasMenu = (role: RoleSpec, granted: readonly MenuKey[], key: MenuKey, actions?: GrantedActions): boolean => effectiveMenus(role, granted, actions).includes(key);

/** 설문에 참여하는가 — 현장작업자·현장관리자(PM)이거나, 설문 참여를 부여받은 회원. 이 회원은 공정(1~3개)을 갖는다. */
export const canSurvey = (role: RoleSpec, granted: readonly MenuKey[]): boolean => hasMenu(role, granted, 'survey');

// 메뉴마다 보기/등록/수정/삭제 권한을 따로 부여할 수 있다.
export const ACTIONS = [
  { key: 'view', label: '보기' },
  { key: 'register', label: '등록' },
  { key: 'edit', label: '수정' },
  { key: 'delete', label: '삭제' },
] as const;

export type ActionKey = (typeof ACTIONS)[number]['key'];

export const isAction = (v: unknown): v is ActionKey => ACTIONS.some(a => a.key === v);
export const actionLabel = (k: ActionKey): string => ACTIONS.find(a => a.key === k)?.label ?? k;
/** 메뉴마다 동작 이름이 다르게 보여야 할 때 (예: 출근관리의 '수정' 칸은 '전체 조회') */
const ACTION_LABELS: Partial<Record<MenuKey, Partial<Record<ActionKey, string>>>> = { attendance: { view: '본인 출근만 보기', register: '조회 기준 등록·수정', edit: '전체 인원 조회' }, leave: { view: '내 신청 보기', register: '휴가 신청', edit: '승인·반려 (전체 신청 조회)' }, expenses: { view: '내 서류 보기', register: '서류·구매요청 올리기 (내 것 수정·삭제)', edit: '전체 조회·구매 완료 처리·엑셀 (담당자·경리)', delete: '전체 삭제' }, inventory: { view: '조사 목록 사용 (보기·추가·수정·삭제)', edit: '조사 제외 설정 · 모든 공정' } };
export const menuActionLabel = (menu: MenuKey, k: ActionKey): string => ACTION_LABELS[menu]?.[k] ?? actionLabel(k);

/** 그 메뉴에서 권한을 따로 줄 수 있는 동작. 설문 참여에는 등록/수정/삭제 개념이 없다. */
export const MENU_ACTIONS: Record<MenuKey, ActionKey[]> = {
  catalog: ['view', 'register', 'edit', 'delete'],
  vehicles: ['view', 'register', 'edit', 'delete'], // 등록 = 차량 등록, 수정 = 연장·상비품 배치/회수, 삭제 = 차량 삭제
  leave: ['view', 'register', 'edit'], // 보기 = 내 신청 내역 · 등록 = 휴가 신청 · 수정 = 승인·반려(전체 신청 조회)
  attendance: ['view', 'register', 'edit'], // 보기 = 본인 출근만 · 등록 = 월 조회 기준(며칠부터 며칠) 등록·수정 · 전체 조회(edit) = 모든 인원의 출근
  placements: ['view', 'register', 'edit', 'delete'], // 등록 = 배치·복사, 삭제 = 배치 빼기
  sites: ['view', 'register', 'edit', 'delete'],
  suppliers: ['view', 'register', 'edit', 'delete'], // 거래처 정보 관리. 로그인 아이디 발급은 회원 관리의 '거래처 계정'(최고 관리자·개발팀)
  expenses: ['view', 'register', 'edit', 'delete'], // 보기 = 내 영수증 · 등록 = 영수증 올리기(내 것 수정·삭제 포함) · 수정 = 모든 사람의 영수증 조회·수정(관리자) · 삭제 = 모두의 영수증 삭제
  requests: ['view', 'edit'], // 수정 = 요청을 '준비 완료'로 처리하고, 새 요청 알림을 받는 권한
  members: ['view', 'register', 'edit', 'delete'],
  staff: ['view'], // 회원정보는 보기만 — 부여 / 부여 안 함으로 나눈다
  payroll: ['view'], // 월급관리도 보기만 — 부여 / 부여 안 함
  inventory: ['view', 'edit'], // 장비조사: 부여 안 함 / 일부(view = 내 공정 목록 사용: 보기·추가·수정·삭제 모두) / 모든(+ edit = 조사 제외 설정·모든 공정)
  history: ['view'], // 변경이력은 보기만 — 부여 / 부여 안 함
  survey: [],
};

/** 부여받은 동작: 메뉴별로 어떤 동작을 더 허용하는지 (팀 기본 권한과 별개) */
export type GrantedActions = Partial<Record<MenuKey, ActionKey[]>>;

/**
 * 이 메뉴에서 이 동작을 해도 되는가.
 *  · 팀 기본 메뉴(최고 관리자·개발팀의 소모품·회원 관리)는 모든 동작 가능
 *  · 부여받은 메뉴는 함께 부여받은 동작만 가능
 */
export function can(role: RoleSpec, granted: readonly MenuKey[], actions: GrantedActions, menu: MenuKey, action: ActionKey): boolean {
  if (!hasMenu(role, granted, menu, actions)) return false;
  const base = rolesOf(role).filter(r => (TEAM_MENUS[r] ?? []).includes(menu)); // 겸직이면 두 팀 중 하나라도 기본으로 가진 메뉴
  if (base.some(r => (TEAM_ACTIONS[r]?.[menu] ?? MENU_ACTIONS[menu]).includes(action))) return true;
  if (!base.length && action === 'view') return true; // 위에서 보기 권한을 이미 확인했다
  return granted.includes(menu) && (actions[menu] ?? []).includes(action); // 부여받은 동작 (팀 기본에 더해진다)
}

/** 이 메뉴에서 할 수 있는 동작 목록 */
export const effectiveActions = (role: RoleSpec, granted: readonly MenuKey[], actions: GrantedActions, menu: MenuKey): ActionKey[] =>
  MENU_ACTIONS[menu].filter(a => can(role, granted, actions, menu, a));

/** 회원을 만들고·고치고·메뉴를 부여할 수 있는 팀(최고 관리자·개발팀) = '회원 관리' 메뉴를 가진 팀 */
export const isStaffAdmin = (role: RoleSpec): boolean => roleMenus(role).includes('members');
