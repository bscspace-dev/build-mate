import 'server-only';
import { getActiveMembers, getPushState, updatePushState } from '@/lib/db';
import { memberRoles, hasMenu } from '@/lib/roles';
import type { PushItem } from '@/lib/types';

// 웹 푸시 알림 (표준 Web Push + VAPID, 외부 서비스 없이 무료).
//  · 알림 자체에는 내용을 싣지 않는다. 기기가 "알림이 왔다"는 신호를 받으면 서비스 워커(public/sw.js)가
//    /api/push/latest 에서 그 사람에게 온 내용을 받아 보여 준다 (그래서 권한이 없는 내용은 새지 않는다).
//  · VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 가 서버에 있어야 한다 (node scripts/vapid-keys.mjs 로 만든다).
const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export const pushReady = () => !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? '';

let keyCache: { d: string; key: CryptoKey } | null = null;
async function signingKey(): Promise<CryptoKey> {
  const d = process.env.VAPID_PRIVATE_KEY!;
  if (keyCache?.d === d) return keyCache.key;
  const pub = fromB64u(process.env.VAPID_PUBLIC_KEY!); // 04 || x(32) || y(32)
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache = { d, key };
  return key;
}

async function vapidHeader(endpoint: string, subject: string): Promise<string> {
  const head = b64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(new TextEncoder().encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(), new TextEncoder().encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

/** 한 기기에 신호를 보낸다. 'gone' 이면 더 이상 없는 기기(구독 해제)라 목록에서 지운다. */
async function ping(endpoint: string, subject: string): Promise<'ok' | 'gone' | 'fail'> {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: await vapidHeader(endpoint, subject), TTL: '3600', Urgency: 'high', 'Content-Length': '0' }, signal: AbortSignal.timeout(6000) });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

/** 작업일보를 볼 수 있는(현장정보 메뉴) 사람 모두에게 알린다. 올린 본인은 뺀다. 못 보내도 글 올리기는 성공해야 하므로 오류는 삼킨다. */
export async function notifySitePost(i: { title: string; body: string; url: string; authorId: string; origin: string }): Promise<void> {
  if (!pushReady()) return;
  try {
    const state = await getPushState();
    if (state.subs.length === 0) return;
    const members = new Map((await getActiveMembers()).map(m => [m.id, m]));
    const author = i.authorId || 'root';
    const targets = state.subs.filter(s => {
      if (s.memberId === author) return false;
      if (s.memberId === 'root') return true;
      const m = members.get(s.memberId);
      return !!m && hasMenu(memberRoles(m), m.menus, 'sites', m.actions);
    });
    if (targets.length === 0) return;
    const item: PushItem = { id: Date.now().toString(36), at: new Date().toISOString(), title: i.title, body: i.body, url: i.url, to: [...new Set(targets.map(t => t.memberId))] };
    await updatePushState(s => ({ ...s, feed: [...s.feed, item].slice(-40) })); // 먼저 내용을 남겨야 기기가 신호를 받고 가져갈 수 있다
    const subject = process.env.VAPID_SUBJECT || i.origin;
    const results = await Promise.all(targets.map(async t => [t.endpoint, await ping(t.endpoint, subject)] as const));
    const gone = new Set(results.filter(([, r]) => r === 'gone').map(([e]) => e));
    if (gone.size) await updatePushState(s => ({ ...s, subs: s.subs.filter(x => !gone.has(x.endpoint)) }));
  } catch { /* 알림 실패가 작업일보 저장을 막지 않는다 */ }
}
