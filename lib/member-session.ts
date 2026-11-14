import 'server-only';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getMember } from './db';
import type { Member } from './types';

// 회원 로그인 세션. 내장 최고 관리자 세션(bm_admin)과는 쿠키 이름도 서명 용도도 다르다.
const COOKIE = 'bm_session';
const TTL_SEC = 60 * 60 * 24 * 14; // 14일

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET 이 설정되지 않았습니다. .env.local 을 확인하세요.');
  return s;
}
const sign = (v: string) => crypto.createHmac('sha256', secret()).update('member:' + v).digest('hex');
// 비밀번호를 재설정하면 이 값이 바뀌어서 이전에 로그인해 둔 기기는 자동으로 로그아웃된다.
const pwVersion = (w: Member) => crypto.createHash('sha256').update(w.passHash ?? '').digest('hex').slice(0, 12);

export async function createMemberSession(w: Member): Promise<void> {
  const exp = String(Math.floor(Date.now() / 1000) + TTL_SEC);
  const v = `${w.id}.${exp}.${pwVersion(w)}`;
  (await cookies()).set(COOKIE, `${v}.${sign(v)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: TTL_SEC,
  });
}

export async function destroyMemberSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** 로그인한 회원. 세션이 없거나 만료·변조됐거나, 계정이 삭제·비밀번호가 바뀌었으면 null. */
export async function getSessionMember(): Promise<Member | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const v = raw.slice(0, i);
  const a = Buffer.from(raw.slice(i + 1));
  const b = Buffer.from(sign(v));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [id, exp, sv] = v.split('.');
  if (!id || !exp || !sv || !(Number(exp) > Date.now() / 1000)) return null;
  const w = await getMember(id);
  if (!w || !w.passHash || pwVersion(w) !== sv) return null;
  return w;
}
