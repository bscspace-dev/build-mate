import 'server-only';
import crypto from 'node:crypto';
import { generateLoginId, generatePassword, hashPassword, isReservedLoginId, normalizeLoginId, validLoginId, validPassword, verifyPassword } from './accounts';
import { getCategoryTrades, getMember, getMembers, getTeams, insertMember, patchMember, removeMember } from './db';
import { toPublic, type Actor, type Credentials } from './member-utils';
import { canSurvey, GRANTABLE_MENUS, isStaffAdmin, MENU_ACTIONS, MENUS, roleMenus, type GrantedActions, type MenuKey, type RoleKey } from './roles';
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

const NAME_TAKEN = '이미 등록된 이름이에요. 구분되게 적어 주세요 (예: 김철수A).';
const LOGIN_TAKEN = '이미 쓰는 아이디예요.';
const conflictMessage = (c: 'name' | 'loginId') => (c === 'name' ? NAME_TAKEN : LOGIN_TAKEN);
const normName = (s: string) => s.trim().replace(/\s+/g, ' ');
/** 취급품목·연락처·주소: 문자열이 아니면 빈 값, 공백 정리, 길이 제한 */
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const clipHandles = (v: unknown) => clip(v, 100);
const clipPhone = (v: unknown) => clip(v, 30);
const clipAddress = (v: unknown) => clip(v, 200);

const isStaff = (a: Actor) => a.kind === 'root' || isStaffAdmin(a.member.role);
const isSelf = (a: Actor, id: string) => a.kind === 'member' && a.member.id === id;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x));

function checkName(raw: string): string | Err {
  const name = normName(raw);
  return !name || name.length > 40 ? { error: '이름은 1~40자로 적어 주세요.' } : name;
}

/** 부여할 메뉴 정리: 부여 가능한 메뉴만, 중복 없이, 직급 기본 메뉴와 겹치는 것은 뺀다. */
function checkMenus(role: RoleKey, raw: unknown): MenuKey[] {
  const list = Array.isArray(raw) ? raw : [];
  return GRANTABLE_MENUS.filter(k => list.includes(k) && !roleMenus(role).includes(k));
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
  if (!validLoginId(id)) return { error: '아이디는 영문 소문자·숫자·_- 로 3~20자예요.' };
  if (isReservedLoginId(id)) return { error: LOGIN_TAKEN };
  return id;
}

/** 회원 생성(관리 권한 필요 — 호출하는 쪽에서 확인). 임시 비밀번호는 이 반환값으로 한 번만 알려준다. */
export async function addMember(
  input: { name: string; role: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; menus?: unknown; actions?: unknown; loginId?: string; account?: boolean },
  allowedTrades: string[],
): Promise<{ member: PublicMember; credentials: Credentials | null } | Err> {
  const name = checkName(input.name);
  if (typeof name !== 'string') return name;
  const role = input.role;
  if (typeof role !== 'string' || !(await getTeams()).some(t => t.key === role)) return { error: '팀을 골라 주세요.' };
  const menus = checkMenus(role, input.menus);
  const actions = checkActions(menus, input.actions);
  const trades = checkTrades(canSurvey(role, menus), input.trades, allowedTrades);
  if (!Array.isArray(trades)) return trades;
  const categories = canSurvey(role, menus) ? await checkCategories(input.categories, trades, true) : [];
  if (!Array.isArray(categories)) return categories;

  // account=false: 아이디·비밀번호 없이 정보만 등록한다(거래처). 필요할 때 목록에서 '아이디 생성'으로 만든다.
  if (input.account === false) {
    const bare: Member = {
      id: crypto.randomBytes(9).toString('base64url'), name, role, trades, categories, handles: clipHandles(input.handles), phone: clipPhone(input.phone), address: clipAddress(input.address), menus, actions, createdAt: new Date().toISOString(),
      mustChangePassword: false, idChanged: false,
    };
    const r0 = await insertMember(bare);
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

  const password = generatePassword();
  const member: Member = {
    id: crypto.randomBytes(9).toString('base64url'), name, role, trades, categories, handles: clipHandles(input.handles), phone: clipPhone(input.phone), address: clipAddress(input.address), menus, actions, createdAt: new Date().toISOString(),
    loginId, passHash: await hashPassword(password), mustChangePassword: true, idChanged: false,
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
  patch: { name?: string; role?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; categories?: unknown; handles?: unknown; phone?: unknown; address?: unknown; loginId?: string },
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
    if (n !== target.name) next.name = n;
  }

  if (patch.handles !== undefined && clipHandles(patch.handles) !== target.handles) next.handles = clipHandles(patch.handles);
  if (patch.phone !== undefined && clipPhone(patch.phone) !== target.phone) next.phone = clipPhone(patch.phone);
  if (patch.address !== undefined && clipAddress(patch.address) !== target.address) next.address = clipAddress(patch.address);

  let role = target.role;
  if (patch.role !== undefined && patch.role !== target.role) {
    if (!staff) return { error: '직급은 최고 관리자·개발팀만 바꿀 수 있어요.' };
    if (self) return { error: '내 직급은 직접 바꿀 수 없어요.' };
    const wanted = patch.role;
    if (typeof wanted !== 'string' || !(await getTeams()).some(t => t.key === wanted)) return { error: '팀을 골라 주세요.' };
    role = wanted;
    next.role = role;
  }

  // 메뉴 부여: 관리 권한자만. 직급이 바뀌면 새 직급의 기본 메뉴와 겹치는 부여는 정리한다.
  let menus = target.menus;
  if (patch.menus !== undefined) {
    const m = checkMenus(role, patch.menus);
    if (!sameSet(m, target.menus)) {
      if (!staff) return { error: '메뉴는 최고 관리자·개발팀만 부여할 수 있어요.' };
      menus = m;
      next.menus = m;
    }
  } else if (role !== target.role) {
    const m = checkMenus(role, target.menus);
    if (!sameSet(m, target.menus)) {
      menus = m;
      next.menus = m;
    }
  }

  // 동작 권한(등록/수정/삭제): 관리 권한자만. 메뉴를 회수하거나 직급이 바뀌어 기본 메뉴와 겹치면 그 메뉴의 권한은 정리된다.
  if (patch.actions !== undefined || next.menus !== undefined || next.role !== undefined) {
    const a = checkActions(menus, patch.actions !== undefined ? patch.actions : target.actions);
    if (actionsKey(a) !== actionsKey(target.actions)) {
      if (!staff) return { error: '권한은 최고 관리자·개발팀만 부여할 수 있어요.' };
      next.actions = a;
    }
  }

  // 공정: 설문에 참여하는 회원만 1~3개. 새로 설문에 참여하게 되면 공정을 반드시 같이 정한다.
  const survey = canSurvey(role, menus);
  if (survey) {
    if (patch.trades !== undefined || !canSurvey(target.role, target.menus)) {
      const t = checkTrades(true, patch.trades, allowedTrades);
      if (!Array.isArray(t)) return t;
      next.trades = t;
    }
  } else if (target.trades.length) next.trades = [];

  // 카테고리: 설문에 참여하는 회원만, 고른 공정에 속한 것 최대 3개. 공정이 바뀌면 안 맞는 것은 빠진다.
  if (!survey) {
    if (target.categories.length) next.categories = [];
  } else if (patch.categories !== undefined || next.trades !== undefined) {
    const c = await checkCategories(patch.categories !== undefined ? patch.categories : target.categories, next.trades ?? target.trades, patch.categories !== undefined);
    if (!Array.isArray(c)) return c;
    if (!sameSet(c, target.categories)) next.categories = c;
  }

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

/** 회원 삭제(관리 권한 필요). 내 계정은 지울 수 없다. */
export async function deleteMember(actor: Actor, id: string): Promise<{ ok: true } | Err> {
  if (isSelf(actor, id)) return { error: '내 계정은 지울 수 없어요.' };
  return (await removeMember(id)) ? { ok: true } : { error: '회원을 찾을 수 없어요.' };
}
