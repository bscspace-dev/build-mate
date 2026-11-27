import 'server-only';
import crypto from 'node:crypto';
import { generateLoginId, generatePassword, hashPassword, isReservedLoginId, normalizeLoginId, validLoginId, validPassword, verifyPassword } from './accounts';
import { getAttendanceCycles, getCategoryTrades, getMember, getMembers, getTeams, insertMember, patchMember, removeMember } from './db';
import { monthOfDate, periodOf, shiftYm } from './attendance-cycle';
import { toPublic, type Actor, type Credentials } from './member-utils';
import { can, canSurvey, FIELD_ROLES, GRANTABLE_MENUS, isStaffAdmin, MENU_ACTIONS, MENUS, memberRoles, roleMenus, teamGroup, type GrantedActions, type MenuKey, type RoleKey, type RoleSpec, type Team } from './roles';
import type { Member, MemberPatch, PublicMember } from './types';

// 회원 규칙. 저장 방식(파일/Supabase)과 상관없이 같은 규칙을 쓰도록 db.ts 의 기본 동작 위에 얹는다.
//
//  · 회원 생성: 최고 관리자·개발팀만. 아이디와 임시 비밀번호가 만들어지고, 첫 로그인 때 새 비밀번호를 정해야 한다.
//  · 수정: 최고 관리자·개발팀 + 본인만. 직급은 최고 관리자·개발팀만 바꿀 수 있고 본인 직급은 스스로 못 바꾼다.
//  · 아이디: 본인은 처음 1회만 바꿀 수 있고, 이후에는 최고 관리자·개발팀만 바꿀 수 있다.
//  · 메뉴 부여: 직급 기본 메뉴 외에 '소모품'·'설문 참여'를 최고 관리자·개발팀만 줄 수 있다 ('회원 관리'는 부여 불가).
//  · 동작 권한: 부여한 메뉴마다 등록/수정/삭제를 따로 줄 수 있다(최고 관리자·개발팀만). 메뉴를 회수하면 그 메뉴의 권한도 사라진다.
//  · 공정(1~3개): 설문에 참여하는 회원(현장작업자·현장관리자, 또는 설문 참여를 부여받은 회원)만 갖는다. 나머지는 항상 빈 값.

export type Err = { error: string };

const NAME_TAKEN = '이미 등록된 이름이에요. 같은 이름은 등록할 수 없어요.';
const HANGUL_NAME = /^[가-힣]{2,20}$/;
const HANGUL_NAME_MSG = '이름은 한글로만 적어 주세요 (2~20자, 공백·영문·숫자 없이).';
const LOGIN_TAKEN = '이미 쓰는 아이디예요.';
const conflictMessage = (c: 'name' | 'loginId') => (c === 'name' ? NAME_TAKEN : LOGIN_TAKEN);
const normName = (s: string) => s.trim().replace(/\s+/g, ' ');
/** 취급품목·연락처·주소: 문자열이 아니면 빈 값, 공백 정리, 길이 제한 */
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const clipHandles = (v: unknown) => clip(v, 100);
const clipPhone = (v: unknown) => clip(v, 30);
const validPhone = (p: string) => p.replace(/[^0-9]/g, '').length >= 9; // 숫자가 9자리 이상
const clipAddress = (v: unknown) => clip(v, 200);
const clipAddressDetail = (v: unknown) => clip(v, 100);
const clipPosition = (v: unknown) => clip(v, 20);
const clipBank = (v: unknown) => clip(v, 20);
const clipAccountNo = (v: unknown) => (typeof v === 'string' ? v.replace(/[^0-9-]/g, '').slice(0, 30) : '');
const clipHolder = (v: unknown) => clip(v, 20);
const clipLicense = (v: unknown) => clip(v, 60);
/** 급여(원): 0 이상의 정수만, 아니면 0 (미설정) */
const clipPay = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 1_000_000_000) : 0;
};
/** 입사일: YYYY-MM-DD 형식의 실제 날짜만, 아니면 빈 값 */
const clipDate = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : '';
};
/** 현장 역할(PM·사수·부사수): 목록에 있는 것만, 중복 없이, 정해진 순서로 */
const clipFieldRoles = (v: unknown): RoleKey[] => {
  const list = Array.isArray(v) ? FIELD_ROLES.map(r => r.key as RoleKey).filter(k => v.includes(k)) : [];
  return list.includes('worker') ? list.filter(k => k !== 'worker_sub') : list; // 사수와 부사수는 함께 가질 수 없다 (사수 우선)
};
/** 금액을 바꿨을 때 적용이 시작되는 날: 다음 급여 기간(출근 조회 기준)의 시작일 */
export async function nextPayStart(): Promise<string> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const cycles = await getAttendanceCycles();
  return periodOf(cycles, shiftYm(monthOfDate(cycles, today), 1)).from;
}
/** 이번 급여 기간의 시작일 (금액을 '이번 급여 기간부터' 바로 적용할 때의 시작일) */
export async function currentPayStart(): Promise<string> {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const cycles = await getAttendanceCycles();
  return periodOf(cycles, monthOfDate(cycles, today)).from;
}
const checkOfficeStatus = (v: unknown): '' | 'probation' | 'regular' => (v === 'probation' || v === 'regular' ? v : '');

/** 회원을 만들고 고칠 수 있는 사람: 내장 최고 관리자 · 회원등록 '수정' 권한이 있는 회원(최고 관리자·개발팀, 또는 그 권한을 부여받은 회원) */
const isStaff = (a: Actor) => a.kind === 'root' || can(memberRoles(a.member), a.member.menus, a.member.actions, 'members', 'edit');
/** 팀 자체가 관리 팀(최고 관리자·개발팀)인 사람 — 회원등록·회원정보 메뉴를 다른 사람에게 부여할 수 있고, 내 권한도 바꿀 수 있다 */
const isTeamStaff = (a: Actor) => a.kind === 'root' || isStaffAdmin(memberRoles(a.member));
/** 호출한 쪽(API)이 회원 생성에 쓸 권한 범위: 메뉴를 부여할 수 있는지, 회원등록·회원정보 메뉴까지 부여할 수 있는지 */
export const actorPowers = (a: Actor) => ({ canGrant: isStaff(a), grantAdmin: isTeamStaff(a) });
const ADMIN_MENUS: MenuKey[] = ['members', 'staff'];
/** 팀 소속이 아닌 위임받은 관리자는 회원등록·회원정보 메뉴 부여 여부를 바꿀 수 없다 (원래 상태를 그대로 둔다) */
const lockAdmin = (next: MenuKey[], before: readonly MenuKey[], a: Actor): MenuKey[] => (isTeamStaff(a) ? next : [...next.filter(k => !ADMIN_MENUS.includes(k)), ...before.filter(k => ADMIN_MENUS.includes(k))]);

/** 겸직 팀: 사무실 팀과 현장 팀을 함께 가질 때만 — 주 팀이 사무실이면 현장 팀, 현장이면 사무실 팀. 없으면 빈 문자열. */
function checkExtraRole(teams: Team[], role: RoleKey, raw: unknown): RoleKey | Err {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') return { error: '겸직 팀을 확인해 주세요.' };
  const a = teamGroup(teams, role);
  const b = teamGroup(teams, raw);
  if (b === null) return { error: '없는 팀이에요.' };
  return (a === 'office' && b === 'field') || (a === 'field' && b === 'office') ? raw : { error: '겸직은 사무실 팀과 현장 팀을 함께 가질 때만 가능해요.' };
}
/** 급여 기준: '' 자동 · daily 일수제 · office 4대보험 사무직 기준 */
function checkPayType(raw: unknown): '' | 'daily' | 'office' | Err {
  if (raw === undefined || raw === null || raw === '') return '';
  return raw === 'daily' || raw === 'office' ? raw : { error: '급여 기준을 확인해 주세요.' };
}
const isSelf = (a: Actor, id: string) => a.kind === 'member' && a.member.id === id;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x));

function checkName(raw: string): string | Err {
  const name = normName(raw);
  return !name || name.length > 40 ? { error: '이름은 1~40자로 적어 주세요.' } : name;
}

/** 부여할 메뉴 정리: 부여 가능한 메뉴만, 중복 없이, 직급 기본 메뉴와 겹치는 것은 뺀다. */
function checkMenus(role: RoleSpec, raw: unknown): MenuKey[] {
  const list = Array.isArray(raw) ? raw : [];
  return GRANTABLE_MENUS.filter(k => list.includes(k) && (k === 'sites' || !roleMenus(role).includes(k))); // 현장정보는 팀 기본(보기)이어도 전체 권한을 더 줄 수 있다
}

/** 부여할 동작 권한 정리: 부여한 메뉴에 대해서만, 그 메뉴에서 줄 수 있는 동작만, 순서·중복 없이. */
function checkActions(menus: readonly MenuKey[], raw: unknown): GrantedActions {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: GrantedActions = {};
  for (const m of MENUS.map(x => x.key)) {
    if (!menus.includes(m)) continue;
    if (!Array.isArray(src[m])) continue; // 동작을 정하지 않은 부여 = 보기만(예전 방식)
    const list = src[m] as unknown[];
    const wants = (a: string) => list.includes(a);
    const acts = MENU_ACTIONS[m].filter(a => wants(a) || (a === 'view' && ['register', 'edit', 'delete'].some(wants))); // 등록·수정·삭제를 주면 보기도 같이
    if (MENU_ACTIONS[m].length) out[m] = acts; // 비어 있으면 '볼 수 없음'
  }
  return out;
}
const actionsKey = (a: GrantedActions) => JSON.stringify(MENUS.map(m => [m.key, a[m.key] ?? []]));

/** 공정 목록. 설문에 참여하지 않는 회원은 빈 배열, 참여하는 회원은 1~3개(목록에 있는 것만). */
function checkTrades(survey: boolean, raw: unknown, allowed: string[]): string[] | Err {
  if (!survey) return [];
  const trades = Array.isArray(raw) ? [...new Set(raw.filter((t): t is string => typeof t === 'string'))] : [];
  if (trades.length < 1 || trades.length > 3) return { error: '자재 요청을 하는 회원은 공정을 1~3개 골라 주세요.' };
  if (!trades.every(t => allowed.includes(t))) return { error: '목록에 없는 공정이에요.' };
  return trades;
}

/**
 * 설문에서 맡을 카테고리(공정 아래 카테고리): 공정마다 최대 3개. 고른 공정에 속한 카테고리만 가능하다.
 * strict=false 면 공정을 바꿔 맞지 않게 된 카테고리를 조용히 뺀다.
 */
async function checkCategories(raw: unknown, trades: string[], strict: boolean): Promise<string[] | Err> {
  const list = Array.isArray(raw) ? [...new Set(raw.filter((c): c is string => typeof c === 'string'))] : [];
  if (!list.length) return [];
  const map = await getCategoryTrades();
  const ok = (c: string) => c in map && trades.includes(map[c]);
  const valid = list.filter(ok);
  if (strict && valid.length !== list.length) return { error: '고른 공정에 속하지 않는 카테고리예요.' };
  const used = new Map<string, number>();
  const out: string[] = [];
  for (const c of valid) {
    const n = used.get(map[c]) ?? 0;
    if (n >= 3) {
      if (strict) return { error: `“${map[c]}” 공정의 카테고리는 최대 3개까지 고를 수 있어요.` };
      continue;
    }
    used.set(map[c], n + 1);
    out.push(c);
  }
  return out;
}

function checkLoginId(raw: string): string | Err {
  const id = normalizeLoginId(raw);
  if (!validLoginId(id)) return { error: '아이디는 영문 소문자와 숫자를 섞어서 3~20자로 적어 주세요 (예: hong1234).' };
  if (isReservedLoginId(id)) return { error: LOGIN_TAKEN };
  return id;
}

/** 회원 생성(관리 권한 필요 — 호출하는 쪽에서 확인). 임시 비밀번호는 이 반환값으로 한 번만 알려준다. */
export async function addMember(
  input: { name: string; role: unknown; extraRole?: unknown; payType?: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; addressDetail?: unknown; position?: unknown; hireDate?: unknown; resignDate?: unknown; payAmount?: unknown; bank?: unknown; accountNo?: unknown; accountHolder?: unknown; safetyDate?: unknown; license?: unknown; fieldRoles?: unknown; officeStatus?: unknown; menus?: unknown; actions?: unknown; loginId?: string; password?: unknown; account?: boolean },
  allowedTrades: string[],
  opts: { canGrant: boolean; grantAdmin: boolean } = { canGrant: true, grantAdmin: true },
): Promise<{ member: PublicMember; credentials: Credentials | null } | Err> {
  const name = checkName(input.name);
  if (typeof name !== 'string') return name;
  if (input.account !== false && !HANGUL_NAME.test(name)) return { error: HANGUL_NAME_MSG };
  if (input.account !== false && !validPhone(clipPhone(input.phone))) return { error: '연락처를 적어 주세요 (예: 010-1234-5678).' }; // 사내 회원은 연락처 필수
  const role = input.role;
  const teamList = await getTeams();
  if (typeof role !== 'string' || !teamList.some(t => t.key === role)) return { error: '팀을 골라 주세요.' };
  const extra = checkExtraRole(teamList, role, input.extraRole);
  if (typeof extra !== 'string') return extra;
  const pay = checkPayType(input.payType);
  if (typeof pay === 'object') return pay;
  const roles = [...new Set([role, ...(extra ? [extra] : []), ...clipFieldRoles(input.fieldRoles)])];
  // 메뉴 부여는 수정 권한이 있는 사람만, 회원등록·회원정보 메뉴 부여는 관리 팀만
  const menus = opts.canGrant ? checkMenus(roles, input.menus).filter(k => opts.grantAdmin || !ADMIN_MENUS.includes(k)) : [];
  const actions = checkActions(menus, input.actions);
  const trades: string[] = []; // 공정은 회원마다 정하지 않고, 팀 관리의 '관여 공정'을 따른다
  const categories: string[] = []; // 공정을 고르면 그 아래 카테고리는 모두 보인다

  // account=false: 아이디·비밀번호 없이 정보만 등록한다(거래처). 필요할 때 목록에서 '아이디 생성'으로 만든다.
  if (input.account === false) {
    const bare: Member = {
      id: crypto.randomBytes(9).toString('base64url'), name, role, trades, categories, handles: clipHandles(input.handles), phone: clipPhone(input.phone), address: clipAddress(input.address), addressDetail: clipAddressDetail(input.addressDetail), position: clipPosition(input.position), hireDate: clipDate(input.hireDate), resignDate: clipDate(input.resignDate), history: [], photo: '', bankbook: '', payAmount: clipPay(input.payAmount), payHistory: clipPay(input.payAmount) > 0 ? [{ from: '', amount: clipPay(input.payAmount), at: new Date().toISOString() }] : [], bank: clipBank(input.bank), accountNo: clipAccountNo(input.accountNo), accountHolder: clipHolder(input.accountHolder), safetyDate: clipDate(input.safetyDate), license: clipLicense(input.license), fieldRoles: clipFieldRoles(input.fieldRoles), officeStatus: checkOfficeStatus(input.officeStatus), menus, actions, extraRole: extra, payType: pay, createdAt: new Date().toISOString(),
      mustChangePassword: false, idChanged: false,
    };
    const r0 = await insertMember(bare, true); // 거래처는 같은 이름이 여러 곳일 수 있다
    if ('conflict' in r0) return { error: conflictMessage(r0.conflict) };
    return { member: toPublic(r0.member), credentials: null };
  }

  const taken = new Set((await getMembers()).map(m => m.loginId).filter((x): x is string => !!x));
  let loginId: string;
  if (input.loginId?.trim()) {
    const r = checkLoginId(input.loginId);
    if (typeof r !== 'string') return r;
    if (taken.has(r)) return { error: LOGIN_TAKEN };
    loginId = r;
  } else loginId = generateLoginId(taken);

  // 비밀번호를 직접 적었으면 그대로 쓰고(바로 로그인 가능), 비웠으면 임시 비밀번호를 만든다 (첫 로그인 때 변경)
  const given = typeof input.password === 'string' ? input.password : '';
  if (given && !validPassword(given)) return { error: '비밀번호는 6자 이상 64자 이하로 적어 주세요.' };
  const password = given || generatePassword();
  const member: Member = {
    id: crypto.randomBytes(9).toString('base64url'), name, role, trades, categories, handles: clipHandles(input.handles), phone: clipPhone(input.phone), address: clipAddress(input.address), addressDetail: clipAddressDetail(input.addressDetail), position: clipPosition(input.position), hireDate: clipDate(input.hireDate), resignDate: clipDate(input.resignDate), history: [], photo: '', bankbook: '', payAmount: clipPay(input.payAmount), payHistory: clipPay(input.payAmount) > 0 ? [{ from: '', amount: clipPay(input.payAmount), at: new Date().toISOString() }] : [], bank: clipBank(input.bank), accountNo: clipAccountNo(input.accountNo), accountHolder: clipHolder(input.accountHolder), safetyDate: clipDate(input.safetyDate), license: clipLicense(input.license), fieldRoles: clipFieldRoles(input.fieldRoles), officeStatus: checkOfficeStatus(input.officeStatus), menus, actions, extraRole: extra, payType: pay, createdAt: new Date().toISOString(),
    loginId, passHash: await hashPassword(password), mustChangePassword: !given, idChanged: false,
  };
  const r = await insertMember(member);
  if ('conflict' in r) return { error: conflictMessage(r.conflict) };
  return { member: toPublic(r.member), credentials: { loginId, password } };
}

/**
 * 회원 정보 수정. 관리 권한이 있는 사람은 누구든, 일반 회원은 본인 것만 수정할 수 있다.
 * 아이디: 일반 회원은 1회만(이후엔 관리 권한자만), 관리 권한자가 바꿀 때는 횟수에 영향을 주지 않는다.
 * 직급·메뉴 부여는 관리 권한자만.
 */
export async function updateMember(
  actor: Actor,
  id: string,
  patch: { name?: string; role?: unknown; extraRole?: unknown; payType?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; addressDetail?: unknown; position?: unknown; hireDate?: unknown; resignDate?: unknown; payAmount?: unknown; bank?: unknown; accountNo?: unknown; accountHolder?: unknown; safetyDate?: unknown; license?: unknown; fieldRoles?: unknown; officeStatus?: unknown; payEffective?: unknown; loginId?: string },
  allowedTrades: string[],
): Promise<PublicMember | Err> {
  const target = await getMember(id);
  if (!target) return { error: '회원을 찾을 수 없어요.' };
  const staff = isStaff(actor);
  const self = isSelf(actor, id);
  if (!staff && !self) return { error: '수정 권한이 없어요.' };

  const next: MemberPatch = {};

  if (patch.name !== undefined) {
    const n = checkName(patch.name);
    if (typeof n !== 'string') return n;
    if (n !== target.name) {
      if (!HANGUL_NAME.test(n) && teamGroup(await getTeams(), target.role) !== 'outsource') return { error: HANGUL_NAME_MSG };
      next.name = n;
    }
  }

  if (patch.handles !== undefined && clipHandles(patch.handles) !== target.handles) next.handles = clipHandles(patch.handles);
  if (patch.phone !== undefined && clipPhone(patch.phone) !== target.phone) {
    if (!validPhone(clipPhone(patch.phone)) && teamGroup(await getTeams(), target.role) !== 'outsource') return { error: '연락처를 적어 주세요 (예: 010-1234-5678).' }; // 사내 회원은 연락처 필수
    next.phone = clipPhone(patch.phone);
  }
  if (patch.address !== undefined && clipAddress(patch.address) !== target.address) next.address = clipAddress(patch.address);
  if (patch.addressDetail !== undefined && clipAddressDetail(patch.addressDetail) !== (target.addressDetail ?? '')) next.addressDetail = clipAddressDetail(patch.addressDetail);

  if (patch.position !== undefined && clipPosition(patch.position) !== target.position) {
    if (!staff) return { error: '직급은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    next.position = clipPosition(patch.position);
  }

  if (patch.hireDate !== undefined && clipDate(patch.hireDate) !== (target.hireDate ?? '')) {
    if (!staff) return { error: '입사일은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    next.hireDate = clipDate(patch.hireDate);
  }

  if (patch.resignDate !== undefined && clipDate(patch.resignDate) !== (target.resignDate ?? '')) {
    if (!staff) return { error: '퇴사일은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    if (self && clipDate(patch.resignDate)) return { error: '내 계정은 퇴사 처리할 수 없어요.' };
    next.resignDate = clipDate(patch.resignDate);
  }
  // 복직(퇴사일을 지움): 지난 재직 기간을 이력에 남기고, 입사일은 오늘로 새로 정한다
  if (target.resignDate && next.resignDate === '') {
    next.history = [...(target.history ?? []), { hire: target.hireDate ?? '', resign: target.resignDate }];
    next.hireDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  }

  if (patch.payAmount !== undefined && clipPay(patch.payAmount) !== (target.payAmount ?? 0)) {
    if (!staff) return { error: '급여는 최고 관리자·개발팀만 바꿀 수 있어요.' };
    const amount = clipPay(patch.payAmount);
    const prev = target.payAmount ?? 0;
    const nowIso = new Date().toISOString();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    next.payAmount = amount;
    if (prev === 0) {
      next.payHistory = amount > 0 ? [{ from: '', amount, at: nowIso }] : []; // 처음 정하는 금액은 바로 적용
    } else {
      // 이미 있던 금액을 바꾸면 다음 급여 기간부터 적용하고, 지난 금액은 그 전까지 그대로 남긴다 (이력)
      let hist = [...(target.payHistory ?? [])];
      if (hist.length === 0) hist = [{ from: '', amount: prev, at: '' }];
      const useNow = patch.payEffective === 'now'; // 이번 급여 기간부터 바로 적용 / 기본은 다음 급여 기간부터
      const start = useNow ? await currentPayStart() : await nextPayStart();
      hist = useNow ? hist.filter(e => e.from < start) : hist.filter(e => e.from <= today); // 이번 기간에 시작되거나 아직 시작 전인 변경은 새 값으로 갈아 끼운다
      const current = hist.length ? hist[hist.length - 1].amount : 0;
      if (amount !== current) hist.push({ from: start, amount, at: nowIso });
      next.payHistory = hist;
    }
  }

  // 급여 계좌·안전교육·면허: 관리 권한자만
  const staffOnly: [keyof MemberPatch, unknown, string][] = [
    ['bank', patch.bank === undefined ? undefined : clipBank(patch.bank), target.bank ?? ''],
    ['accountNo', patch.accountNo === undefined ? undefined : clipAccountNo(patch.accountNo), target.accountNo ?? ''],
    ['accountHolder', patch.accountHolder === undefined ? undefined : clipHolder(patch.accountHolder), target.accountHolder ?? ''],
    ['safetyDate', patch.safetyDate === undefined ? undefined : clipDate(patch.safetyDate), target.safetyDate ?? ''],
    ['license', patch.license === undefined ? undefined : clipLicense(patch.license), target.license ?? ''],
  ];
  for (const [k, v, cur] of staffOnly) {
    if (v === undefined || v === cur) continue;
    if (!staff) return { error: '이 정보는 최고 관리자·개발팀만 바꿀 수 있어요.' };
    (next as Record<string, unknown>)[k] = v;
  }

  let role = target.role;
  if (patch.role !== undefined && patch.role !== target.role) {
    if (!staff) return { error: '직급은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    if (self) return { error: '내 직급은 직접 바꿀 수 없어요.' };
    const wanted = patch.role;
    if (typeof wanted !== 'string' || !(await getTeams()).some(t => t.key === wanted)) return { error: '팀을 골라 주세요.' };
    role = wanted;
    next.role = role;
  }

  // 겸직 팀: 관리 권한자만. 주 팀이 바뀌어 짝이 안 맞게 되면(같은 부서) 겸직 팀은 빠진다.
  let extra = target.extraRole;
  const teamList = await getTeams();
  if (patch.extraRole !== undefined) {
    const e = checkExtraRole(teamList, role, patch.extraRole);
    if (typeof e !== 'string') return e;
    if (e !== target.extraRole && !staff) return { error: '겸직 팀은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    extra = e;
  } else if (next.role !== undefined) {
    const e = checkExtraRole(teamList, role, extra);
    extra = typeof e === 'string' ? e : '';
  }
  if (extra !== target.extraRole) next.extraRole = extra;
  // 급여 기준: 관리 권한자만
  if (patch.payType !== undefined) {
    const p = checkPayType(patch.payType);
    if (typeof p === 'object') return p;
    if (p !== target.payType) {
      if (!staff) return { error: '급여 기준은 최고 관리자·개발팀만 바꿀 수 있어요.' };
      next.payType = p;
    }
  }
  // 현장 역할 여러 개·사무실 구분(수습/정규): 관리 권한자만
  const fr = patch.fieldRoles !== undefined ? clipFieldRoles(patch.fieldRoles) : target.fieldRoles ?? [];
  if (patch.fieldRoles !== undefined && !sameSet(fr, target.fieldRoles ?? [])) {
    if (!staff) return { error: '현장 역할은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    next.fieldRoles = fr;
  }
  if (patch.officeStatus !== undefined) {
    const os = checkOfficeStatus(patch.officeStatus);
    if (os !== (target.officeStatus ?? '')) {
      if (!staff) return { error: '사무실 구분은 최고 관리자·개발팀만 바꿀 수 있어요.' };
      next.officeStatus = os;
    }
  }
  const roles = [...new Set([role, ...(extra ? [extra] : []), ...fr])];

  // 메뉴 부여: 관리 권한자만. 직급이 바뀌면 새 직급의 기본 메뉴와 겹치는 부여는 정리한다.
  let menus = target.menus;
  if (patch.menus !== undefined) {
    const m = lockAdmin(checkMenus(roles, patch.menus), target.menus, actor);
    if (!sameSet(m, target.menus)) {
      if (!staff) return { error: '메뉴는 최고 관리자·개발팀만 부여할 수 있어요.' };
      if (self && !isTeamStaff(actor)) return { error: '내 메뉴 권한은 직접 바꿀 수 없어요.' };
      menus = m;
      next.menus = m;
    }
  } else if (role !== target.role || extra !== target.extraRole) {
    const m = checkMenus(roles, target.menus);
    if (!sameSet(m, target.menus)) {
      menus = m;
      next.menus = m;
    }
  }

  // 동작 권한(등록/수정/삭제): 관리 권한자만. 메뉴를 회수하거나 직급이 바뀌어 기본 메뉴와 겹치면 그 메뉴의 권한은 정리된다.
  if (patch.actions !== undefined || next.menus !== undefined || next.role !== undefined || next.extraRole !== undefined) {
    const a = checkActions(menus, patch.actions !== undefined ? patch.actions : target.actions);
    if (actionsKey(a) !== actionsKey(target.actions)) {
      if (!staff) return { error: '권한은 최고 관리자·개발팀만 부여할 수 있어요.' };
      if (self && !isTeamStaff(actor)) return { error: '내 메뉴 권한은 직접 바꿀 수 없어요.' };
      next.actions = a;
    }
  }

  // 공정·카테고리: 회원마다 정하지 않는다 (팀 관리의 '관여 공정'을 따른다). 예전에 저장된 값은 비운다.
  if (target.trades.length) next.trades = [];
  if (target.categories.length) next.categories = [];

  if (patch.loginId !== undefined) {
    const r = checkLoginId(patch.loginId);
    if (typeof r !== 'string') return r;
    if (r !== target.loginId) {
      if (!staff) {
        if (target.idChanged) return { error: '아이디는 한 번만 바꿀 수 있어요. 더 바꾸려면 최고 관리자나 개발팀에 요청해 주세요.' };
        next.idChanged = true;
      }
      next.loginId = r;
    }
  }

  if (!Object.keys(next).length) return toPublic(target);
  const res = await patchMember(id, next);
  if ('conflict' in res) return { error: conflictMessage(res.conflict) };
  if ('notFound' in res) return { error: '회원을 찾을 수 없어요.' };
  return toPublic(res.member);
}

/** 본인 비밀번호 변경. 현재 비밀번호를 확인하고, 성공하면 임시 비밀번호 상태가 풀린다. 새 비밀번호가 적용된 회원을 돌려준다(세션 재발급용). */
export async function changeOwnPassword(member: Member, current: string, next: string): Promise<{ member: Member } | Err> {
  // 임시 비밀번호 상태(처음 로그인)에서는 임시 비밀번호를 몰라도 바로 새 비밀번호를 정할 수 있다
  if (!member.mustChangePassword && (!member.passHash || !(await verifyPassword(current, member.passHash)))) return { error: '현재 비밀번호가 맞지 않아요.' };
  if (!validPassword(next)) return { error: '새 비밀번호는 6자 이상으로 적어 주세요.' };
  if (!member.mustChangePassword && next === current) return { error: '현재 비밀번호와 다른 비밀번호로 정해 주세요.' };
  const res = await patchMember(member.id, { passHash: await hashPassword(next), mustChangePassword: false });
  return 'member' in res ? { member: res.member } : { error: '회원을 찾을 수 없어요.' };
}

/** 임시 비밀번호 재발급(관리 권한 필요). 다시 첫 로그인 상태가 되고, 이전에 로그인해 둔 기기는 로그아웃된다. */
export async function resetMember(actor: Actor, id: string): Promise<{ member: PublicMember; credentials: Credentials } | Err> {
  if (isSelf(actor, id)) return { error: '내 비밀번호는 화면 우측 상단의 ‘비밀번호 변경’에서 바꿔 주세요.' };
  const members = await getMembers();
  const target = members.find(m => m.id === id);
  if (!target) return { error: '회원을 찾을 수 없어요.' };
  const password = generatePassword();
  const loginId = target.loginId ?? generateLoginId(new Set(members.map(m => m.loginId).filter((x): x is string => !!x)));
  const res = await patchMember(id, { loginId, passHash: await hashPassword(password), mustChangePassword: true });
  if ('conflict' in res) return { error: conflictMessage(res.conflict) };
  if ('notFound' in res) return { error: '회원을 찾을 수 없어요.' };
  return { member: toPublic(res.member), credentials: { loginId, password } };
}

/** 퇴사 처리(관리 권한 필요): 퇴사일을 오늘로 찍는다. 기록은 남고, 로그인은 막힌다. 내 계정은 불가. */
export async function resignMember(actor: Actor, id: string): Promise<{ member: PublicMember } | Err> {
  if (isSelf(actor, id)) return { error: '내 계정은 퇴사 처리할 수 없어요.' };
  const target = await getMember(id);
  if (!target) return { error: '회원을 찾을 수 없어요.' };
  if (target.resignDate) return { error: '이미 퇴사 처리된 회원이에요.' };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD (한국 날짜)
  const r = await patchMember(id, { resignDate: today });
  return 'member' in r ? { member: toPublic(r.member) } : { error: '회원을 찾을 수 없어요.' };
}

/** 회원 삭제(관리 권한 필요). 내 계정은 지울 수 없다. */
export async function deleteMember(actor: Actor, id: string): Promise<{ ok: true } | Err> {
  if (isSelf(actor, id)) return { error: '내 계정은 지울 수 없어요.' };
  const target = await getMember(id);
  // 사내 회원은 먼저 퇴사 처리한 뒤에만 완전히 지울 수 있다 (실수로 재직자를 지우지 않도록)
  if (target && !target.resignDate && teamGroup(await getTeams(), target.role) !== 'outsource') return { error: '재직 중인 회원은 먼저 퇴사 처리해 주세요.' };
  return (await removeMember(id)) ? { ok: true } : { error: '회원을 찾을 수 없어요.' };
}
