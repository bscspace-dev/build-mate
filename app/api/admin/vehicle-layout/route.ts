import { audited } from '@/lib/audit';
import { getActor, vehiclesFull } from '@/lib/auth';
import { getVehicles, saveVehicleLayout } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';

// 차량정보: 차량 순서와 차량 카테고리(묶음) 저장. 차량정보의 모든 권한이 있는 사람만.
type Body = { order?: unknown; cats?: unknown; catOf?: unknown };

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('vehicles');
  if (!actor) return json({ error: '차량정보 메뉴 권한이 필요해요.' }, 401);
  if (!vehiclesFull(actor)) return json({ error: '순서·카테고리를 바꿀 권한이 없어요.' }, 403);
  if (limited(req, 'vehicle-layout', 300, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return json({ error: 'bad request' }, 400);

  const ids = new Set((await getVehicles()).map(v => v.id));
  const order = Array.isArray(b.order) ? [...new Set(b.order.filter((x): x is string => typeof x === 'string' && ids.has(x)))] : [];
  const cats = Array.isArray(b.cats) ? [...new Set(b.cats.filter((x): x is string => typeof x === 'string').map(x => x.trim().replace(/\s+/g, ' ').slice(0, 20)).filter(Boolean))].slice(0, 30) : [];
  const catOf: Record<string, string> = {};
  if (b.catOf && typeof b.catOf === 'object' && !Array.isArray(b.catOf)) {
    for (const [id, c] of Object.entries(b.catOf as Record<string, unknown>)) if (ids.has(id) && typeof c === 'string' && cats.includes(c)) catOf[id] = c;
  }
  await saveVehicleLayout({ order, cats, catOf });
  return json({ ok: true });
}

export const POST = audited('vehicles', handlePOST);
