// 팀·메뉴 정의 (서버·브라우저 공용).
//
//  구조: 구분(사내 / 협력) → 부서(사무실 / 현장 / 외주) → 팀명(= 직급)
//   · 사내 = 사무실 + 현장,  협력 = 외주
//   · 구분과 부서는 고정이라 수정할 수 없다. 팀명만 최고 관리자·개발팀이 추가·삭제한다(이름 변경은 없음).
//   · 팀명은 저장되는 데이터다(DEFAULT_TEAMS 가 처음 한 번 채워진다). 회원의 직급(role)은 팀의 key 다.
//   · 기본 동작이 걸린 팀(locked)은 삭제할 수 없다: 최고 관리자·개발팀(관리 권한), 현장작업자·현장관리자(PM)(설문).
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
export type Team = { key: string; label: string; group: GroupKey; locked: boolean };

// 처음 한 번 저장되는 팀들 (이후에는 최고 관리자·개발팀이 추가·삭제). 표시 순서는 이 순서.
export const DEFAULT_TEAMS: Team[] = [
  { key: 'design', label: '디자인팀', group: 'office', locked: false },
  { key: 'marketing', label: '마케팅팀', group: 'office', locked: false },
  { key: 'super', label: '최고 관리자', group: 'office', locked: true },
  { key: 'dev', label: '개발팀', group: 'office', locked: true },
  { key: 'sales', label: '영업팀', group: 'office', locked: false },
  { key: 'worker', label: '현장작업자', group: 'field', locked: true },
  { key: 'pm', label: '현장관리자(PM)', group: 'field', locked: true },
  { key: 'partner', label: '거래처', group: 'outsource', locked: false },
];

export const teamLabel = (teams: readonly Team[], key: RoleKey): string => teams.find(t => t.key === key)?.label ?? key;
export const teamGroup = (teams: readonly Team[], key: RoleKey): GroupKey | null => teams.find(t => t.key === key)?.group ?? null;
export const teamsIn = (teams: readonly Team[], g: GroupKey): Team[] => teams.filter(t => t.group === g);

export const MENUS = [
  { key: 'catalog', label: '소모품', href: '/admin', grantable: true, desc: '소모품을 보고, 필요 없는 소모품을 삭제·복원해요' },
  { key: 'requests', label: '현장요청', href: '/admin/requests', grantable: true, desc: '현장에서 들어온 자재 요청(품목과 수량)을 확인해요' },
  { key: 'members', label: '회원 관리', href: '/admin/members', grantable: false, desc: '회원을 만들고 팀·메뉴를 부여하고 비밀번호를 다시 발급해요' },
  { key: 'survey', label: '자재 요청', href: '/survey', grantable: true, desc: '내 공정의 자재를 골라 수량과 함께 요청해요' },
] as const;

export type MenuKey = (typeof MENUS)[number]['key'];

export const isMenu = (v: unknown): v is MenuKey => MENUS.some(m => m.key === v);
export const menuLabel = (k: MenuKey): string => MENUS.find(m => m.key === k)?.label ?? k;
export const menuHref = (k: MenuKey): string => MENUS.find(m => m.key === k)?.href ?? '/';
export const menuDesc = (k: MenuKey): string => MENUS.find(m => m.key === k)?.desc ?? '';
/** 부여할 수 있는 메뉴 (회원 관리는 제외) */
export const GRANTABLE_MENUS: MenuKey[] = MENUS.filter(m => m.grantable).map(m => m.key);

// 팀 기본 메뉴. 여기 없는 팀(새로 만든 팀 포함)은 기본 메뉴가 없다 — 내 정보만 쓴다.
const TEAM_MENUS: Record<string, MenuKey[]> = {
  worker: ['survey'],
  pm: ['survey'],
  super: ['catalog', 'requests', 'members'],
  dev: ['catalog', 'requests', 'members'],
};

export const roleMenus = (role: RoleKey): MenuKey[] => TEAM_MENUS[role] ?? [];

/** 실제로 쓸 수 있는 메뉴 = 팀 기본 메뉴 + 부여받은 메뉴 (메뉴 정의 순서대로) */
export function effectiveMenus(role: RoleKey, granted: readonly MenuKey[] = [], actions?: GrantedActions): MenuKey[] {
  return MENUS.map(m => m.key).filter(k => roleMenus(role).includes(k) || (granted.includes(k) && viewable(k, actions)));
}

/** 부여받은 메뉴를 볼 수 있는가: '보기'를 골랐거나, 동작을 따로 정하지 않은 예전 부여(= 보기만)일 때 */
function viewable(menu: MenuKey, actions?: GrantedActions): boolean {
  if (!actions || MENU_ACTIONS[menu].length === 0) return true;
  const list = actions[menu];
  return list === undefined || list.includes('view');
}

export const hasMenu = (role: RoleKey, granted: readonly MenuKey[], key: MenuKey, actions?: GrantedActions): boolean => effectiveMenus(role, granted, actions).includes(key);

/** 설문에 참여하는가 — 현장작업자·현장관리자(PM)이거나, 설문 참여를 부여받은 회원. 이 회원은 공정(1~3개)을 갖는다. */
export const canSurvey = (role: RoleKey, granted: readonly MenuKey[]): boolean => hasMenu(role, granted, 'survey');

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

/** 그 메뉴에서 권한을 따로 줄 수 있는 동작. 설문 참여에는 등록/수정/삭제 개념이 없다. */
export const MENU_ACTIONS: Record<MenuKey, ActionKey[]> = {
  catalog: ['view', 'register', 'edit', 'delete'],
  requests: ['view', 'edit'], // 수정 = 요청을 '준비 완료'로 처리하고, 새 요청 알림을 받는 권한
  members: ['view', 'register', 'edit', 'delete'],
  survey: [],
};

/** 부여받은 동작: 메뉴별로 어떤 동작을 더 허용하는지 (팀 기본 권한과 별개) */
export type GrantedActions = Partial<Record<MenuKey, ActionKey[]>>;

/**
 * 이 메뉴에서 이 동작을 해도 되는가.
 *  · 팀 기본 메뉴(최고 관리자·개발팀의 소모품·회원 관리)는 모든 동작 가능
 *  · 부여받은 메뉴는 함께 부여받은 동작만 가능
 */
export function can(role: RoleKey, granted: readonly MenuKey[], actions: GrantedActions, menu: MenuKey, action: ActionKey): boolean {
  if (!hasMenu(role, granted, menu, actions)) return false;
  if (roleMenus(role).includes(menu)) return MENU_ACTIONS[menu].includes(action);
  if (action === 'view') return true; // 위에서 보기 권한을 이미 확인했다
  return (actions[menu] ?? []).includes(action);
}

/** 이 메뉴에서 할 수 있는 동작 목록 */
export const effectiveActions = (role: RoleKey, granted: readonly MenuKey[], actions: GrantedActions, menu: MenuKey): ActionKey[] =>
  MENU_ACTIONS[menu].filter(a => can(role, granted, actions, menu, a));

/** 회원을 만들고·고치고·메뉴를 부여할 수 있는 팀(최고 관리자·개발팀) = '회원 관리' 메뉴를 가진 팀 */
export const isStaffAdmin = (role: RoleKey): boolean => roleMenus(role).includes('members');
