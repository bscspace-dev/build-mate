import { actorCan, getActor } from '@/lib/auth';
import { addPurchase, removePurchase, updatePurchase } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import type { PurchaseStatus } from '@/lib/types';

// 구매관리: 등록(등록 권한) · 수정·상태 변경(수정 권한) · 삭제(삭제 권한)
type Body = { action?: unknown; id?: unknown; name?: unknown; brand?: unknown; url?: unknown; price?: unknown; qty?: unknown; memo?: unknown; tags?: unknown; status?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');
const STATUSES: PurchaseStatus[] = ['want', 'ordered', 'done'];

/** 태그 정리: 앞의 #·공백을 떼고 20자까지, 쉼표 제거, 중복 없이 최대 5개 */
function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    const v = typeof t === 'string' ? t.replace(/[,#]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 20) : '';
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= 5) break;
  }
  return out;
}

/** 링크 정리: 비어 있으면 빈 값, http(s)가 없으면 https:// 를 붙이고, http·https 가 아니면(javascript: 등) 거절한다. */
function cleanUrl(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('purchases');
  if (!actor) return json({ error: '구매관리 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'purchases', 240, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  const need = a === 'add' ? 'register' : a === 'update' || a === 'status' ? 'edit' : a === 'delete' ? 'delete' : null;
  if (!b || !need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'purchases', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const id = typeof b.id === 'string' ? b.id.slice(0, 64) : '';
  if (a === 'delete') return id && (await removePurchase(id)) ? json({ ok: true }) : json({ error: '없는 품목이에요.' }, 404);

  const status = STATUSES.includes(b.status as PurchaseStatus) ? (b.status as PurchaseStatus) : 'want';
  const name = clip(b.name, 100);
  if (!name) return json({ error: '품목명을 적어 주세요.' }, 400);
  const url = cleanUrl(b.url);
  if (url === null) return json({ error: '구매 링크는 http:// 또는 https:// 주소로 적어 주세요.' }, 400);
  const price = typeof b.price === 'number' && Number.isInteger(b.price) && b.price >= 0 && b.price <= 99_999_999 ? b.price : NaN;
  const qty = typeof b.qty === 'number' && Number.isInteger(b.qty) && b.qty >= 1 && b.qty <= 9999 ? b.qty : NaN;
  if (Number.isNaN(price)) return json({ error: '가격은 0 이상의 숫자(원)로 적어 주세요.' }, 400);
  if (Number.isNaN(qty)) return json({ error: '수량은 1 이상의 숫자로 적어 주세요.' }, 400);
  const input = { name, brand: clip(b.brand, 30), url, price, qty, memo: clip(b.memo, 300), tags: cleanTags(b.tags), status };

  if (a === 'add') {
    await addPurchase(input, actor.kind === 'member' ? actor.member.name : '최고 관리자');
    return json({ ok: true });
  }
  return id && (await updatePurchase(id, input)) ? json({ ok: true }) : json({ error: '없는 품목이에요.' }, 404);
}
