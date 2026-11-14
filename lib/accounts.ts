import 'server-only';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// 헷갈리는 글자(0 O 1 l I)를 뺀 문자로 만든다 — 폰으로 보고 입력하기 쉽도록.
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomString(len: number): string {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}

export function generateLoginId(taken: Set<string>): string {
  for (;;) {
    const id = 'w' + randomString(5);
    if (!taken.has(id)) return id;
  }
}
/** 관리자 아이디는 현장관리자가 쓸 수 없다. */
export const isReservedLoginId = (id: string) => !!process.env.ADMIN_PASSWORD && id === (process.env.ADMIN_ID || 'admin').trim().toLowerCase();

export const generatePassword = () => randomString(8);

export const normalizeLoginId = (s: string) => s.trim().toLowerCase();
export const validLoginId = (s: string) => /^[a-z0-9_-]{3,20}$/.test(s);
export const validPassword = (s: string) => s.length >= 6 && s.length <= 64;

/** 비밀번호는 원문을 저장하지 않고 scrypt 해시로만 저장한다. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 32);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [v, s, h] = stored.split('$');
  if (v !== 's1' || !s || !h) return false;
  const hash = await scrypt(pw, Buffer.from(s, 'base64'), 32);
  const expected = Buffer.from(h, 'base64');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

// 없는 아이디로 시도해도 해시 비교와 같은 시간이 걸리게 해서, 아이디 존재 여부를 알아내지 못하게 한다.
let dummy: Promise<string> | null = null;
export const getDummyHash = () => (dummy ??= hashPassword('not-a-real-password'));
