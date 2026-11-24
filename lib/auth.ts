import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getSessionMember } from './member-session';
import { can, hasMenu, memberRoles, type ActionKey, type MenuKey } from './roles';
import type { Actor } from './member-utils';

const COOKIE = 'bm_admin';
const TTL_SEC = 60 * 60 * 12; // 12시간

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 이 설정되지 않았습니다. .env.local 을 확인하세요.');
  return s;
}
function sign(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

export function checkPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return false;
  // 길이와 상관없이 같은 시간에 비교하기 위해 해시끼리 비교
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(pw).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 관리자 로그인 아이디 (.env.local 의 ADMIN_ID, 없으면 admin). 대소문자는 구분하지 않는다. */
// ADMIN_PASSWORD 가 없으면 내장 계정은 꺼진 것이다(빈 문자열) — 'admin' 같은 아이디를 일반 회원이 쓸 수 있다.
export const adminLoginId = () => (process.env.ADMIN_PASSWORD ? (process.env.ADMIN_ID || 'admin').trim().toLowerCase() : '');

/** 관리자 아이디 + 비밀번호 확인. 아이디가 틀려도 비밀번호 비교까지 항상 수행한다. */
export function checkAdminLogin(id: string, password: string): boolean {
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  const idOk = crypto.timingSafeEqual(h(id.trim().toLowerCase()), h(adminLoginId()));
  const pwOk = checkPassword(password);
  return idOk && pwOk;
}

export async function createSession(): Promise<void> {
  const exp = String(Math.floor(Date.now() / 1000) + TTL_SEC);
  (await cookies()).set(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: TTL_SEC,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** .env.local 의 관리자 계정(내장 최고 관리자)으로 로그인한 세션인가. */
export async function hasRootSession(): Promise<boolean> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig) return false;
  if (!(Number(exp) > Date.now() / 1000)) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 이 사람이 이 메뉴에서 이 동작(등록/수정/삭제)을 해도 되는가. 내장 최고 관리자는 모두 가능. */
export function actorCan(actor: Actor, menu: MenuKey, action: ActionKey): boolean {
  return actor.kind === 'root' ? menu !== 'survey' : can(memberRoles(actor.member), actor.member.menus, actor.member.actions, menu, action);
}

/** 그 메뉴의 모든 권한(보기·등록·수정·삭제)을 가졌는가. 아니면(일부 권한) 보기만 하는 메뉴에 쓴다. */
export const menuFull = (actor: Actor, menu: MenuKey): boolean => (['view', 'register', 'edit', 'delete'] as const).every(a => actorCan(actor, menu, a));
/** 차량정보: 모든 권한이 있어야 등록·수정·삭제를 할 수 있다. 그렇지 않으면 차량 정보를 보기만 한다. */
export const vehiclesFull = (actor: Actor): boolean => menuFull(actor, 'vehicles');
/** 현장배치: 모든 권한이 있어야 배치·복사·삭제를 할 수 있다. 일부 권한은 열람만 한다. */
export const placementsFull = (actor: Actor): boolean => menuFull(actor, 'placements');

/**
 * 이 메뉴를 쓸 수 있는 사람. 없으면 null.
 *  · 내장 최고 관리자: 소모품·회원 관리 (설문은 회원 계정이 없어 불가)
 *  · 회원: 직급 기본 메뉴 + 부여받은 메뉴 중에 있고
 */
export async function getActor(menu: MenuKey): Promise<Actor | null> {
  if (await hasRootSession()) return menu === 'survey' ? null : { kind: 'root' };
  const member = await getSessionMember();
  if (member && hasMenu(memberRoles(member), member.menus, menu, member.actions)) return { kind: 'member', member };
  return null;
}
