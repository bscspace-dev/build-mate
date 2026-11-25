import 'server-only';
import { after } from 'next/server';
import { addAudit } from './db';
import { hasRootSession } from './auth';
import { getSessionMember } from './member-session';
import type { MenuKey } from './roles';

// 변경이력: 모든 메뉴의 추가·수정·삭제를 한곳(audit_log)에 남긴다.
//  · audited(menu, handler): 관리자 API 의 POST 를 감싸서, 성공하면 누가·언제·무엇을 했는지 자동으로 기록한다.
//  · recordChange(...): 더 자세한 내용(예: 금액 3,000 → 3,500)을 직접 남길 때 쓴다.
//  · 기록에 실패해도(테이블이 아직 없어도) 원래 작업은 그대로 성공한다.

export type ChangeInfo = { action: string; target: string; detail: string };

const ADD = /^(add|new|create|register|assign|copy|upload|post)/i;
const DEL = /^(delete|remove|purge|resign|unassign|revoke|cancel|reject)/i;
const NAMES: Record<string, string> = { rename: '이름 변경', stock: '재고 변경', stockBulk: '재고 일괄 변경', move: '카테고리 이동', kind: '분류 변경', reorder: '순서 변경', swap: '순서 변경', restore: '복원', reset: '비밀번호 재발급', done: '준비 완료', fill: '부족분 채움', approve: '승인', buy: '구매완료', buyMany: '구매완료', link: '구매 링크 변경' };
/** 값을 남기지 않는 항목 (개인정보·비밀번호) */
const HIDDEN = /pass|pw|account|bank|holder|license|phone|address|resident|ssn|token|secret|current|next|photo|file|image/i;
const TARGET_KEYS = ['name', 'title', 'nickname', 'label', 'productName', 'key', 'id', 'siteId'];
const SKIP = new Set(['action', 'menu', ...TARGET_KEYS]);

const actionLabel = (a: string): string => (!a ? '수정' : NAMES[a] ?? (ADD.test(a) ? '추가' : DEL.test(a) ? '삭제' : `수정 (${a})`));

/** 요청 본문에서 무엇을 했는지 뽑는다 (JSON · 폼 모두) */
async function readInfo(req: Request): Promise<ChangeInfo | null> {
  const type = req.headers.get('content-type') ?? '';
  let src: Record<string, unknown> = {};
  if (type.includes('application/json')) {
    const b = await req.json().catch(() => null);
    if (b && typeof b === 'object' && !Array.isArray(b)) src = b as Record<string, unknown>;
  } else if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const f = await req.formData().catch(() => null);
    if (f) for (const [k, v] of f.entries()) if (typeof v === 'string') src[k] = v;
  } else return null;
  const action = typeof src.action === 'string' ? src.action : '';
  let target = '';
  for (const k of TARGET_KEYS) { const v = src[k]; if (typeof v === 'string' && v.trim()) { target = v.trim(); break; } if (typeof v === 'number') { target = String(v); break; } }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(src)) {
    if (SKIP.has(k) || HIDDEN.test(k)) continue;
    if (typeof v === 'string' && v && v.length <= 40) parts.push(`${k}: ${v}`);
    else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}: ${v}`);
    else if (Array.isArray(v) && v.length <= 8 && v.every(x => typeof x === 'string' && x.length <= 20)) parts.push(`${k}: ${v.join(', ')}`);
    else if (Array.isArray(v)) parts.push(`${k}: ${v.length}건`);
  }
  return { action: actionLabel(action), target: target.slice(0, 100), detail: parts.join(' · ').slice(0, 400) };
}

async function who(): Promise<{ id: string; name: string }> {
  const m = await getSessionMember();
  if (m) return { id: m.id, name: m.name };
  return (await hasRootSession()) ? { id: '', name: '최고 관리자' } : { id: '', name: '알 수 없음' };
}

/** 직접 남기는 변경이력 (실패해도 던지지 않는다) */
export async function recordChange(menu: MenuKey, info: ChangeInfo): Promise<void> {
  try {
    const by = await who();
    await addAudit({ menu, action: info.action, target: info.target, detail: info.detail, byId: by.id, byName: by.name });
  } catch { /* 기록 실패는 작업을 막지 않는다 */ }
}

/** 직접 남기는 변경이력 — 응답을 기다리게 하지 않고 응답이 나간 뒤에 저장한다 (회원 확인은 미리 시작해 둔 것을 쓴다) */
export function recordChangeLater(menu: MenuKey, info: ChangeInfo, byPromise?: Promise<{ id: string; name: string }>): void {
  const by = (byPromise ?? who()).catch(() => ({ id: '', name: '알 수 없음' }));
  try {
    after(async () => {
      try {
        const b = await by;
        await addAudit({ menu, action: info.action, target: info.target, detail: info.detail, byId: b.id, byName: b.name });
      } catch { /* 기록 실패는 작업을 막지 않는다 */ }
    });
  } catch {
    void recordChange(menu, info); // after 를 못 쓰는 환경이면 그냥 저장한다
  }
}

/** 관리자 API(POST)를 감싸서 성공한 작업을 변경이력에 남긴다 */
export function audited(menu: MenuKey, handler: (req: Request) => Promise<Response>, pick?: (info: ChangeInfo) => ChangeInfo | null): (req: Request) => Promise<Response> {
  return async req => {
    const by = who().catch(() => ({ id: '', name: '알 수 없음' })); // 작업과 동시에 미리 확인해 둔다
    let info: ChangeInfo | null = null;
    try { info = await readInfo(req.clone()); } catch { /* 본문을 못 읽어도 작업은 계속 */ }
    const res = await handler(req);
    if (res.ok && info) {
      const final = pick ? pick(info) : info;
      if (final) recordChangeLater(menu, final, by);
    }
    return res;
  };
}
