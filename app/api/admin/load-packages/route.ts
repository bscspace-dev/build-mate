import { audited } from '@/lib/audit';
import { getActor, vehiclesFull } from '@/lib/auth';
import { getProducts, removeLoadPackage, saveLoadPackage } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';

// 적재 패키지: 자주 싣는 연장·상비품 묶음을 만들고 고치고 지운다. 차량정보의 수정 권한이 있는 사람만.
// (패키지를 차량에 적재하는 것은 기존 '적재' 요청으로 품목마다 처리된다)
type Body = { action?: unknown; id?: unknown; name?: unknown; items?: unknown };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('vehicles');
  if (!actor) return json({ error: '차량정보 메뉴 권한이 필요해요.' }, 401);
  if (!vehiclesFull(actor)) return json({ error: '적재 패키지를 만들 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (limited(req, 'load-packages', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b || (b.action !== 'save' && b.action !== 'remove')) return json({ error: 'bad request' }, 400);
  const id = str(b.id, 64);

  if (b.action === 'remove') {
    if (!id) return json({ error: 'bad id' }, 400);
    const r = await removeLoadPackage(id);
    return 'error' in r ? json(r, 400) : json(r);
  }

  const name = str(b.name, 30);
  if (!name) return json({ error: '패키지 이름을 적어 주세요.' }, 400);
  const raw = Array.isArray(b.items) ? b.items : [];
  if (raw.length < 1 || raw.length > 60) return json({ error: '패키지에는 품목을 1~60개 담아 주세요.' }, 400);
  const products = new Map((await getProducts()).map(p => [p.key, p]));
  const seen = new Set<string>();
  const items: { key: string; qty: number }[] = [];
  for (const x of raw as { key?: unknown; qty?: unknown }[]) {
    const key = str(x?.key, 64);
    const qty = typeof x?.qty === 'number' && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= 99_999 ? x.qty : 0;
    const p = products.get(key);
    if (!p || p.kind === '자재') return json({ error: '없는 품목이 있어요. 연장이나 상비품만 담을 수 있어요.' }, 400);
    if (!qty) return json({ error: `“${p.name}” 수량은 1 이상의 숫자로 적어 주세요.` }, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, qty });
  }
  const r = await saveLoadPackage({ name, items }, id || null);
  return 'error' in r ? json(r, 400) : json(r);
}

export const POST = audited('vehicles', handlePOST);
