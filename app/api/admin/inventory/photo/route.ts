import { getActor } from '@/lib/auth';
import { getCategoryTrades, getInventoryExcluded, getProducts, updateProduct } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { inventoryTrades } from '@/lib/inventory';
import { recordChangeLater } from '@/lib/audit';
import { removeImage, saveImage } from '@/lib/images';

// 장비조사: 품목 사진 올리기·바꾸기. 내 팀이 맡은 공정의 상비품·자재·연장만, 장비조사에서 제외된 공정·카테고리는 안 된다.
// 사진은 브라우저에서 줄여서(webp) 보낸 파일을 받아 저장한다. 창고장비현황의 같은 품목 사진도 같이 바뀐다.
const MAX_IMAGE = 3 * 1024 * 1024;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('inventory');
  if (!actor) return json({ error: '장비조사 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'inventory-photo', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad request' }, 400);
  const key = typeof form.get('key') === 'string' ? (form.get('key') as string).trim().slice(0, 64) : '';
  const photo = form.get('photo');
  if (!key) return json({ error: 'bad key' }, 400);
  if (!(photo instanceof File) || photo.size === 0) return json({ error: '사진을 골라 주세요.' }, 400);
  if (!TYPES.includes(photo.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
  if (photo.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 3MB 이하로 올려 주세요.' }, 413);

  const [scope, excl, products, catTrades] = await Promise.all([inventoryTrades(actor, 'inventory'), getInventoryExcluded(), getProducts(), getCategoryTrades()]);
  const p = products.find(x => x.key === key);
  if (!p || !(p.kind === '상비품' || p.kind === '자재' || p.kind === '연장')) return json({ error: '없는 품목이에요.' }, 404);
  const trade = catTrades[p.category] ?? '';
  if (!scope.trades.includes(trade) || excl.trades.includes(trade) || excl.categories.includes(p.category)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);

  const image = await saveImage(p.key, new Uint8Array(await photo.arrayBuffer()), photo.type);
  let r: { prevImage: string } | null;
  try {
    r = await updateProduct(p.key, { name: p.name, sub: p.sub, brand: p.brand, price: p.price, image });
  } catch (e) {
    await removeImage(image).catch(() => undefined);
    throw e;
  }
  if (!r) { await removeImage(image).catch(() => undefined); return json({ error: '없는 품목이에요.' }, 404); }
  if (r.prevImage && r.prevImage !== image) await removeImage(r.prevImage).catch(() => undefined); // 예전 사진 파일은 지운다
  const me = actor.kind === 'member' ? actor.member.name : '최고 관리자';
  recordChangeLater('inventory', { action: '사진 등록', target: p.name, detail: `${trade} › ${p.category} · ${me}` });
  return json({ ok: true, image });
}
