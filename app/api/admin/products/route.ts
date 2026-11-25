import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { headOf } from '@/lib/sub-path';
import { getCategoryTrades, getProducts, getTrades, setSubs, deleteProducts, moveProducts, setKind, purgeProducts, renameProduct, reorderProducts, restoreProducts, setStock, swapProducts } from '@/lib/db';
import { asKind, KINDS } from '@/lib/types';
import { json, sameOrigin } from '@/lib/guard';

// 소모품: 삭제(휴지통으로 이동) / 복원 / 영구 삭제(휴지통의 것만, 이미지까지 완전 삭제) → '삭제' 권한
//        카테고리 이동 · 이름 변경 · 재고 수량 → '수정' 권한
async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);

  const body = (await req.json().catch(() => null)) as { action?: unknown; keys?: unknown; category?: unknown; key?: unknown; name?: unknown; stock?: unknown; items?: unknown; a?: unknown; b?: unknown; kind?: unknown } | null;
  const a = body?.action;
  if (!body || (a !== 'delete' && a !== 'restore' && a !== 'purge' && a !== 'move' && a !== 'kind' && a !== 'rename' && a !== 'swap' && a !== 'reorder' && a !== 'stock' && a !== 'stockBulk')) return json({ error: 'bad request' }, 400);
  const editing = a === 'move' || a === 'kind' || a === 'rename' || a === 'swap' || a === 'reorder' || a === 'stock' || a === 'stockBulk';
  if (editing ? !actorCan(actor, 'catalog', 'edit') : !actorCan(actor, 'catalog', 'delete')) {
    return json({ error: editing ? '소모품 수정 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' : '소모품 삭제 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  }
  if (a === 'reorder') {
    // 드래그로 순서 변경: keys = 화면에 보이는 순서대로 나열한 소모품 번호
    if (!Array.isArray(body.keys) || body.keys.length < 2 || body.keys.length > 5000 || !body.keys.every(k => typeof k === 'string' && k.length < 64)) return json({ error: 'bad keys' }, 400);
    if (!(await reorderProducts(body.keys as string[]))) return json({ error: '순서를 바꿀 수 없어요.' }, 404);
    return json({ ok: true });
  }
  if (a === 'swap') {
    // 두 소모품의 목록 순서를 서로 바꾼다 (순서 이동)
    const ka = body.a;
    const kb = body.b;
    if (typeof ka !== 'string' || typeof kb !== 'string' || ka.length > 64 || kb.length > 64) return json({ error: 'bad key' }, 400);
    if (!(await swapProducts(ka, kb))) return json({ error: '순서를 바꿀 수 없어요.' }, 404);
    return json({ ok: true });
  }
  if (a === 'stockBulk') {
    // 엑셀로 올린 재고 일괄 반영: items = [{ key, stock }]
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 5000) return json({ error: 'bad items' }, 400);
    let updated = 0;
    const missing: string[] = [];
    for (const it of items as { key?: unknown; stock?: unknown }[]) {
      if (typeof it?.key !== 'string' || !it.key || it.key.length > 64 || typeof it.stock !== 'number' || !Number.isInteger(it.stock) || it.stock < 0 || it.stock > 9_999_999) return json({ error: 'bad items' }, 400);
    }
    for (const it of items as { key: string; stock: number }[]) { // 순서대로 하나씩 (파일 저장소 동시 쓰기 방지)
      if ((await setStock(it.key, it.stock)) === 0) missing.push(it.key);
      else updated++;
    }
    return json({ ok: true, updated, missing });
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
  if (a === 'kind') {
    if (!(KINDS as readonly unknown[]).includes(body.kind)) return json({ error: '분류를 골라 주세요.' }, 400);
    const kind = asKind(body.kind);
    return json({ ok: true, count: await setKind(keys, kind), kind });
  }
  if (a === 'move') {
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!category) return json({ error: '옮길 카테고리를 골라 주세요.' }, 400);
    const [before, catTrades, trades] = await Promise.all([getProducts(), getCategoryTrades(), getTrades()]);
    const r = await moveProducts(keys, category);
    if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
    // 옮기면 세부분류는 비워지므로(기존 동작) 새 카테고리의 공정>카테고리만 넣는다
    const newHead = headOf(category, catTrades, trades);
    const set = new Set(keys);
    await setSubs(before.filter(p => set.has(p.key) && p.category !== category).map(p => ({ key: p.key, sub: newHead })));
    return json({ ok: true, count: 'count' in r ? r.count : 0 });
  }
  const count = a === 'delete' ? await deleteProducts(keys) : a === 'restore' ? await restoreProducts(keys) : await purgeProducts(keys);
  return json({ ok: true, count });
}

export const POST = audited('catalog', handlePOST);
