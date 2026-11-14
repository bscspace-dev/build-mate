import { actorCan, getActor } from '@/lib/auth';
import { deleteProducts, moveProducts, purgeProducts, renameProduct, restoreProducts, setStock, swapProducts } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 소모품: 삭제(휴지통으로 이동) / 복원 / 영구 삭제(휴지통의 것만, 이미지까지 완전 삭제) → '삭제' 권한
//        카테고리 이동 · 이름 변경 · 재고 수량 → '수정' 권한
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);

  const body = (await req.json().catch(() => null)) as { action?: unknown; keys?: unknown; category?: unknown; key?: unknown; name?: unknown; stock?: unknown; a?: unknown; b?: unknown } | null;
  const a = body?.action;
  if (!body || (a !== 'delete' && a !== 'restore' && a !== 'purge' && a !== 'move' && a !== 'rename' && a !== 'swap' && a !== 'stock')) return json({ error: 'bad request' }, 400);
  const editing = a === 'move' || a === 'rename' || a === 'swap' || a === 'stock';
  if (editing ? !actorCan(actor, 'catalog', 'edit') : !actorCan(actor, 'catalog', 'delete')) {
    return json({ error: editing ? '소모품 수정 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' : '소모품 삭제 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  }
  if (a === 'swap') {
    // 두 소모품의 목록 순서를 서로 바꾼다 (순서 이동)
    const ka = body.a;
    const kb = body.b;
    if (typeof ka !== 'string' || typeof kb !== 'string' || ka.length > 64 || kb.length > 64) return json({ error: 'bad key' }, 400);
    if (!(await swapProducts(ka, kb))) return json({ error: '순서를 바꿀 수 없어요.' }, 404);
    return json({ ok: true });
  }
  if (a === 'stock') {
    // 재고 수량 (0 이상의 정수)
    const stock = typeof body.stock === 'number' ? body.stock : NaN;
    if (typeof body.key !== 'string' || !body.key || body.key.length > 64) return json({ error: 'bad key' }, 400);
    if (!Number.isInteger(stock) || stock < 0 || stock > 9_999_999) return json({ error: '재고는 0 이상의 숫자로 적어 주세요.' }, 400);
    if ((await setStock(body.key, stock)) === 0) return json({ error: '없는 소모품이에요.' }, 404);
    return json({ ok: true, stock });
  }
  if (a === 'rename') {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (typeof body.key !== 'string' || !body.key || body.key.length > 64) return json({ error: 'bad key' }, 400);
    if (!name || name.length > 100) return json({ error: '소모품 이름은 1~100자로 적어 주세요.' }, 400);
    if ((await renameProduct(body.key, name)) === 0) return json({ error: '없는 소모품이에요.' }, 404);
    return json({ ok: true, name });
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 2000 || !body.keys.every(k => typeof k === 'string' && k.length < 64)) {
    return json({ error: 'bad keys' }, 400);
  }
  const keys = body.keys as string[];
  if (a === 'move') {
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!category) return json({ error: '옮길 카테고리를 골라 주세요.' }, 400);
    const r = await moveProducts(keys, category);
    if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
    return json({ ok: true, count: 'count' in r ? r.count : 0 });
  }
  const count = a === 'delete' ? await deleteProducts(keys) : a === 'restore' ? await restoreProducts(keys) : await purgeProducts(keys);
  return json({ ok: true, count });
}
