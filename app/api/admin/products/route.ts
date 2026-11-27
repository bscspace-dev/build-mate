import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { headOf } from '@/lib/sub-path';
import { getProductLinks, saveProductLinks, getCategoryTrades, getProducts, getTrades, setSubs, deleteProducts, moveProducts, setKind, purgeProducts, renameProduct, reorderProducts, restoreProducts, setStock, swapProducts } from '@/lib/db';
import { asKind, KINDS } from '@/lib/types';
import { json, sameOrigin } from '@/lib/guard';

// 소모품: 삭제(휴지통으로 이동) / 복원 / 영구 삭제(휴지통의 것만, 이미지까지 완전 삭제) → '삭제' 권한
//        카테고리 이동 · 이름 변경 · 재고 수량 → '수정' 권한
/** 공통 연결 복사본 키(원본키@id)는 원본 키로 바꿔서 쓴다 (재고·이름·분류는 원본 하나) */
const baseKey = (k: string) => k.split('@')[0];
const isCopy = (k: string) => k.includes('@');

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);

  const body = (await req.json().catch(() => null)) as { action?: unknown; keys?: unknown; category?: unknown; key?: unknown; name?: unknown; stock?: unknown; items?: unknown; a?: unknown; b?: unknown; kind?: unknown } | null;
  const a = body?.action;
  if (!body || (a !== 'delete' && a !== 'restore' && a !== 'purge' && a !== 'move' && a !== 'kind' && a !== 'rename' && a !== 'swap' && a !== 'reorder' && a !== 'stock' && a !== 'stockBulk' && a !== 'copy')) return json({ error: 'bad request' }, 400);
  const editing = a === 'move' || a === 'kind' || a === 'rename' || a === 'swap' || a === 'reorder' || a === 'stock' || a === 'stockBulk' || a === 'copy';
  if (editing ? !actorCan(actor, 'catalog', 'edit') : !actorCan(actor, 'catalog', 'delete')) {
    return json({ error: editing ? '소모품 수정 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' : '소모품 삭제 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  }
  if (a === 'reorder') {
    // 드래그로 순서 변경: keys = 화면에 보이는 순서대로 나열한 소모품 번호
    if (!Array.isArray(body.keys) || body.keys.length < 2 || body.keys.length > 5000 || !body.keys.every(k => typeof k === 'string' && k.length < 64)) return json({ error: 'bad keys' }, 400);
    const real = (body.keys as string[]).filter(k => !isCopy(k)); // 연결 복사본은 순서가 없다 (원본 순서를 따른다)
    if (real.length < 2) return json({ ok: true });
    if (!(await reorderProducts(real))) return json({ error: '순서를 바꿀 수 없어요.' }, 404);
    return json({ ok: true });
  }
  if (a === 'swap') {
    // 두 소모품의 목록 순서를 서로 바꾼다 (순서 이동)
    const ka = body.a;
    const kb = body.b;
    if (typeof ka !== 'string' || typeof kb !== 'string' || ka.length > 64 || kb.length > 64) return json({ error: 'bad key' }, 400);
    if (isCopy(ka) || isCopy(kb)) return json({ error: '연결 복사본은 순서를 바꿀 수 없어요. 원본이 있는 공정에서 바꿔 주세요.' }, 400);
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
    const byBase = new Map((items as { key: string; stock: number }[]).map(it => [baseKey(it.key), it.stock] as const)); // 복사본은 원본의 재고를 바꾼다
    for (const [key, stock] of byBase) { // 순서대로 하나씩 (파일 저장소 동시 쓰기 방지)
      if ((await setStock(key, stock)) === 0) missing.push(key);
      else updated++;
    }
    return json({ ok: true, updated, missing });
  }
  if (a === 'stock') {
    // 재고 수량 (0 이상의 정수)
    const stock = typeof body.stock === 'number' ? body.stock : NaN;
    if (typeof body.key !== 'string' || !body.key || body.key.length > 64) return json({ error: 'bad key' }, 400);
    if (!Number.isInteger(stock) || stock < 0 || stock > 9_999_999) return json({ error: '재고는 0 이상의 숫자로 적어 주세요.' }, 400);
    if ((await setStock(baseKey(body.key), stock)) === 0) return json({ error: '없는 소모품이에요.' }, 404);
    return json({ ok: true, stock });
  }
  if (a === 'rename') {
    const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (typeof body.key !== 'string' || !body.key || body.key.length > 64) return json({ error: 'bad key' }, 400);
    if (!name || name.length > 100) return json({ error: '소모품 이름은 1~100자로 적어 주세요.' }, 400);
    if ((await renameProduct(baseKey(body.key), name)) === 0) return json({ error: '없는 소모품이에요.' }, 404);
    return json({ ok: true, name });
  }
  if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 2000 || !body.keys.every(k => typeof k === 'string' && k.length < 64)) {
    return json({ error: 'bad keys' }, 400);
  }
  const keys = body.keys as string[];
  if (a === 'kind') {
    if (!(KINDS as readonly unknown[]).includes(body.kind)) return json({ error: '분류를 골라 주세요.' }, 400);
    const kind = asKind(body.kind);
    return json({ ok: true, count: await setKind([...new Set(keys.map(baseKey))], kind), kind });
  }
  const plinks = await getProductLinks().catch(() => [] as import('@/lib/types').ProductLink[]);
  const copyIds = new Set(keys.filter(isCopy).map(k => k.slice(k.indexOf('@') + 1)));
  const masterKeys = keys.filter(k => !isCopy(k));
  if (a === 'move' || a === 'copy') {
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (!category) return json({ error: a === 'copy' ? '복사할 카테고리를 골라 주세요.' : '옮길 카테고리를 골라 주세요.' }, 400);
    const [before, catTrades, trades] = await Promise.all([getProducts(), getCategoryTrades(), getTrades()]);
    const toTrade = catTrades[category] ?? '';
    const cur = [...plinks];
    if (a === 'copy') {
      // 원본은 그대로 두고 다른 공정·카테고리에도 보이게 연결한다 (재고·가격·링크·사진은 원본 하나를 같이 쓴다)
      if (!toTrade) return json({ error: '공정이 정해진 카테고리로만 복사할 수 있어요.' }, 400);
      const at = new Date().toISOString();
      const bad: string[] = [];
      let made = 0;
      const created: { key: string; base: string }[] = [];
      for (const k of [...new Set(keys.map(baseKey))]) {
        const p = before.find(x => x.key === k);
        if (!p) continue;
        if ((catTrades[p.category] ?? '') === toTrade || cur.some(l => l.key === p.key && l.trade === toTrade)) { bad.push(p.name); continue; }
        const id = Math.random().toString(36).slice(2, 8);
        cur.push({ id, key: p.key, trade: toTrade, category, at, byName: actor.kind === 'member' ? actor.member.name : '최고 관리자' });
        created.push({ key: `${p.key}@${id}`, base: p.key });
        made++;
      }
      if (made === 0) return json({ error: bad.length ? `이미 이 공정에 있는 품목이에요: ${bad.slice(0, 3).join(', ')}` : '복사할 품목이 없어요.' }, 400);
      await saveProductLinks(cur);
      return json({ ok: true, count: made, skipped: bad, created });
    }
    // 이동: 원본은 카테고리를 바꾸고, 복사본은 놓인 자리(카테고리)만 바꾼다
    let moved = 0;
    const bad: string[] = [];
    if (masterKeys.length) {
      const r = await moveProducts(masterKeys, category);
      if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
      // 옮기면 세부분류는 비워지므로(기존 동작) 새 카테고리의 공정>카테고리만 넣는다
      const newHead = headOf(category, catTrades, trades);
      const set = new Set(masterKeys);
      await setSubs(before.filter(p => set.has(p.key) && p.category !== category).map(p => ({ key: p.key, sub: newHead })));
      moved += 'count' in r ? r.count ?? 0 : 0;
    }
    let linkChanged = false;
    for (const id of copyIds) {
      const i = cur.findIndex(l => l.id === id);
      if (i < 0) continue;
      const l = cur[i];
      const p = before.find(x => x.key === l.key);
      if (!p || !toTrade) continue;
      if ((catTrades[p.category] ?? '') === toTrade || cur.some(x => x.id !== l.id && x.key === l.key && x.trade === toTrade)) { bad.push(p.name); continue; }
      if (l.trade === toTrade && l.category === category) continue;
      cur[i] = { ...l, trade: toTrade, category };
      linkChanged = true; moved++;
    }
    if (linkChanged) await saveProductLinks(cur);
    if (moved === 0 && bad.length) return json({ error: `이미 이 공정에 있는 품목이라 옮길 수 없어요: ${bad.slice(0, 3).join(', ')}` }, 400);
    return json({ ok: true, count: moved });
  }
  if (a === 'delete' && copyIds.size) { // 복사본은 그 공정에서만 빠진다 (원본·재고는 그대로)
    await saveProductLinks(plinks.filter(l => !copyIds.has(l.id)));
  }
  const count = a === 'delete' ? (masterKeys.length ? await deleteProducts(masterKeys) : 0) + copyIds.size : a === 'restore' ? await restoreProducts(masterKeys) : await purgeProducts(masterKeys);
  if (a === 'purge' && masterKeys.length) { // 영구 삭제한 원본에 걸린 복사본 연결도 지운다
    const gone = new Set(masterKeys);
    if (plinks.some(l => gone.has(l.key))) await saveProductLinks(plinks.filter(l => !gone.has(l.key)));
  }
  return json({ ok: true, count });
}

export const POST = audited('catalog', handlePOST);
