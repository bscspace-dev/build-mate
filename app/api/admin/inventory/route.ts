import { getActor } from '@/lib/auth';
import { addInventory, addProduct, getPurchaseLinks, getInventory, getInventoryExcluded, removeInventory, saveInventoryExcluded, deleteProducts, getCategoryTrades, getProducts, getTrades, getPricingSnapshots, nextProductKey, savePricingSnapshots, setPurchaseLink, setStock, updateProduct } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { inventoryTrades } from '@/lib/inventory';
import { recordChangeLater } from '@/lib/audit';
import { headOf, rewriteSub } from '@/lib/sub-path';

// 장비조사·가격조사(menu): 내 팀이 맡은 공정(대분류)의 상비품 목록에서
//  · 추가(add)  = 고른 공정·카테고리로 창고장비현황에도 상비품이 등록된다. 누가 언제 추가했는지 남는다. (가격조사는 금액·수량도 함께)
//  · 수정(rename) = 창고장비현황에도 같은 이름으로 바뀐다. (가격조사는 금액 = 창고장비현황 가격, 수량 = 구매 예정 수량)
//  · 구매완료(buy, 가격조사만) = 구매 예정 수량이 창고장비현황 재고에 더해지고, 구매완료 목록에 구매한 사람·때와 함께 남는다.
//  · 삭제(delete) = 창고장비현황의 휴지통으로 간다(복원 가능). 누가 언제 지웠는지 남는다.
// 내 팀이 맡은 공정은 팀 관리의 '관여 공정'을 따른다 (최고 관리자·개발팀은 모든 공정).
type Body = { vendor?: unknown; ship?: unknown; excludedTrades?: unknown; excludedCategories?: unknown; ids?: unknown; excluded?: unknown; items?: unknown; id?: unknown; url?: unknown; keys?: unknown; menu?: unknown; action?: unknown; trade?: unknown; category?: unknown; name?: unknown; key?: unknown; price?: unknown; qty?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
/** 0 이상의 정수 (비어 있으면 0, 잘못되면 NaN) */
const whole = (v: unknown, max: number) => (v === undefined || v === null || v === '' ? 0 : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : NaN);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const menu = b.menu === 'pricing' ? 'pricing' : 'inventory';
  const pricing = menu === 'pricing';
  const actor = await getActor(menu);
  if (!actor) return json({ error: `${pricing ? '가격조사' : '장비조사'} 메뉴 권한이 필요해요.` }, 401);
  if (limited(req, menu, 300, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  // 서로 상관없는 조회는 동시에 한다 (한 번 왕복에 약 0.2초씩 걸려서, 차례로 하면 그만큼 더해진다)
  const [scope, excl] = await Promise.all([
    inventoryTrades(actor),
    // 장비조사에서 제외한 공정·카테고리는 보이지도, 추가·수정·삭제도 안 된다 (가격조사는 해당 없음)
    pricing ? Promise.resolve({ trades: [] as string[], categories: [] as string[] }) : getInventoryExcluded(),
  ]);
  const { admin } = scope;
  const trades = scope.trades.filter(t => !excl.trades.includes(t));
  const me = actor.kind === 'member' ? { id: actor.member.id, name: actor.member.name } : { id: '', name: '최고 관리자' };
  const memo = pricing ? 'pricing' : ''; // 기록에 어느 메뉴에서 했는지 남긴다

  if (b.action === 'add') {
    const trade = clip(b.trade, 40);
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = pricing ? whole(b.price, 99_999_999) : 0;
    const qty = pricing ? whole(b.qty, 9_999_999) : 0;
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    if (Number.isNaN(qty)) return json({ error: '수량은 0 이상의 숫자로 적어 주세요.' }, 400);
    const category = clip(b.category, 40);
    if (!category) return json({ error: '카테고리를 골라 주세요.' }, 400);
    const [catTrades, allProducts, key, allTrades] = await Promise.all([getCategoryTrades(), getProducts(), nextProductKey(), getTrades()]); // 동시에 조회
    if (catTrades[category] !== trade) return json({ error: '이 공정의 카테고리가 아니에요.' }, 400);
    if (excl.categories.includes(category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    if (allProducts.some(p => catTrades[p.category] === trade && p.name === name)) return json({ error: '이 공정에 이미 있는 품목이에요.' }, 400);
    const product = await addProduct({ key, kind: '상비품', category, sub: rewriteSub('', '', headOf(category, catTrades, allTrades)), name, brand: '', price, priceInclVat: null, vatBasis: '', soldout: false, stock: 0, image: '', trades: [trade] });
    await addInventory({ action: 'add', category: trade, productKey: product.key, name, brand: '', qty, price, memo, byId: me.id, byName: me.name });
    recordChangeLater(menu, { action: '추가', target: name, detail: `${trade} › ${category}${pricing ? ` · 금액 ${price.toLocaleString('ko-KR')} · 구매 예정 수량 ${qty}` : ''}` });
    return json({ ok: true, key: product.key });
  }

  if (b.action === 'rename') {
    const [all, catTrades] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const p = all.find(x => x.key === clip(b.key, 40));
    if (!p || p.kind !== '상비품') return json({ error: '없는 상비품이에요.' }, 404);
    const trade = catTrades[p.category] ?? '';
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    if (excl.categories.includes(p.category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = pricing ? whole(b.price, 99_999_999) : p.price;
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    if (all.some(x => x.key !== p.key && catTrades[x.category] === trade && x.name === name)) return json({ error: '이 공정에 이미 있는 품목 이름이에요.' }, 400);
    if (!(await updateProduct(p.key, { name, sub: p.sub, brand: p.brand, price }))) return json({ error: '없는 상비품이에요.' }, 404);
    const changes: string[] = [];
    if (name !== p.name) changes.push(`이름 ${p.name} → ${name}`);
    if (pricing && price !== p.price) changes.push(`금액 ${p.price.toLocaleString('ko-KR')} → ${price.toLocaleString('ko-KR')}`);
    if (changes.length) recordChangeLater(menu, { action: '수정', target: name, detail: changes.join(' · ') });
    return json({ ok: true, name, price });
  }

  if (b.action === 'link') {
    // 구매 링크 등록·수정·삭제(빈 값): 내 공정의 품목만
    if (!pricing) return json({ error: 'bad request' }, 400);
    const p = (await getProducts()).find(x => x.key === clip(b.key, 40));
    if (!p) return json({ error: '없는 상비품이에요.' }, 404);
    const trade = (await getCategoryTrades())[p.category] ?? '';
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const raw = typeof b.url === 'string' ? b.url.trim() : '';
    let url = '';
    if (raw) {
      try {
        const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('proto');
        url = u.toString().slice(0, 2000);
      } catch {
        return json({ error: '링크는 http:// 또는 https:// 주소로 적어 주세요.' }, 400);
      }
    }
    const vendor = clip(b.vendor, 40);
    await setPurchaseLink(p.key, url || vendor ? { url, vendor } : null);
    recordChangeLater(menu, { action: '구매처·링크 변경', target: p.name, detail: url || vendor ? `구매처 ${vendor || '—'} · ${url || '링크 없음'}` : '구매처·링크 삭제' });
    return json({ ok: true, url, vendor });
  }

  if (b.action === 'excludeSave') {
    // 장비조사에서 제외할 공정·카테고리 정하기: 모든 권한이 있는 사람만
    if (pricing) return json({ error: 'bad request' }, 400);
    if (!admin) return json({ error: '조사 제외 설정은 모든 권한이 있는 사람(최고 관리자·개발팀)만 바꿀 수 있어요.' }, 403);
    const allTrades = await getTrades();
    const catTrades = await getCategoryTrades();
    const ts = Array.isArray(b.excludedTrades) ? [...new Set(b.excludedTrades.filter((x): x is string => typeof x === 'string' && allTrades.includes(x)))] : [];
    const cs = Array.isArray(b.excludedCategories) ? [...new Set(b.excludedCategories.filter((x): x is string => typeof x === 'string' && !!catTrades[x]))] : [];
    await saveInventoryExcluded({ trades: ts, categories: cs });
    recordChangeLater(menu, { action: '조사 제외 설정', target: '장비조사', detail: `제외 공정: ${ts.join(', ') || '없음'} · 제외 카테고리: ${cs.join(', ') || '없음'}` });
    return json({ ok: true });
  }

  if (b.action === 'doneDelete') {
    // 구매완료 내역서 삭제: 모든 권한이 있는 사람(최고 관리자·개발팀)만. 구매 기록만 지우고, 이미 더해진 창고 재고는 되돌리지 않는다.
    if (!pricing) return json({ error: 'bad request' }, 400);
    if (!admin) return json({ error: '구매완료 내역서는 모든 권한이 있는 사람(최고 관리자·개발팀)만 삭제할 수 있어요.' }, 403);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((x): x is string => typeof x === 'string').map(x => clip(x, 64)))].slice(0, 500) : [];
    if (ids.length === 0) return json({ error: 'bad request' }, 400);
    const entries = (await getInventory()).filter(e => e.action === 'buy' && ids.includes(e.id));
    let removed = 0, total = 0;
    for (const e of entries) {
      if (await removeInventory(e.id)) { removed++; total += e.price * e.qty; }
    }
    if (removed === 0) return json({ error: '없는 내역이에요.' }, 404);
    const day = new Date(entries[0].createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    recordChangeLater(menu, { action: '구매 내역서 삭제', target: day, detail: `${removed}건 · 합계 ${total.toLocaleString('ko-KR')}원 (창고 재고는 그대로)` });
    return json({ ok: true, removed });
  }

  if (b.action === 'snapSave' || b.action === 'snapLoad' || b.action === 'snapDelete') {
    // 금액·수량 저장 / 불러오기 / 삭제 (가격조사). 저장은 화면에 보이는 품목(keys), 불러오기는 저장된 품목 전부(내 공정 것만)
    if (!pricing) return json({ error: 'bad request' }, 400);
    const list = await getPricingSnapshots();
    if (b.action === 'snapDelete') {
      const id = clip(b.id, 40);
      const snap = list.find(x => x.id === id);
      if (!snap) return json({ error: '없는 저장본이에요.' }, 404);
      await savePricingSnapshots(list.filter(x => x.id !== id));
      recordChangeLater(menu, { action: '저장본 삭제', target: snap.name, detail: `${snap.items.length}개 품목` });
      return json({ ok: true });
    }
    const all = await getProducts();
    const catTrades = await getCategoryTrades();
    const mine = (key: string) => { const p = all.find(x => x.key === key); return p && p.kind === '상비품' && trades.includes(catTrades[p.category] ?? '') ? p : null; };
    if (b.action === 'snapSave') {
      const name = clip(b.name, 30);
      if (!name) return json({ error: '저장본 이름을 적어 주세요.' }, 400);
      const given = Array.isArray(b.items) ? (b.items as { key?: unknown; qty?: unknown; ship?: unknown }[]).slice(0, 2000) : [];
      const items = given.flatMap(it => { const p = typeof it?.key === 'string' ? mine(it.key) : null; const q = whole(it?.qty, 9_999_999); const sh = whole(it?.ship, 9_999_999); return p && !Number.isNaN(q) ? [{ key: p.key, price: p.price, qty: q, ship: Number.isNaN(sh) ? 0 : sh }] : []; });
      const excluded = Array.isArray(b.excluded) ? [...new Set(b.excluded.filter((k): k is string => typeof k === 'string' && !!mine(k)))].slice(0, 2000) : []; // 조사에서 제외한 품목
      if (items.length === 0 && excluded.length === 0) return json({ error: '저장할 품목이 없어요.' }, 400);
      const snap = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, at: new Date().toISOString(), byName: me.name, items, excluded };
      await savePricingSnapshots([snap, ...list.filter(x => x.name !== name)].slice(0, 30)); // 같은 이름이면 덮어쓰고 최대 30개
      recordChangeLater(menu, { action: '금액·수량 저장', target: name, detail: `${items.length}개 품목 · 제외 ${excluded.length}개` });
      return json({ ok: true, count: items.length });
    }
    const snap = list.find(x => x.id === clip(b.id, 40));
    if (!snap) return json({ error: '없는 저장본이에요.' }, 404);
    let applied = 0, priceChanged = 0;
    const loaded: { key: string; qty: number; ship: number }[] = [];
    for (const it of snap.items) { // 한 품목씩: 금액은 창고장비현황 가격으로 되돌리고, 수량은 화면에 채워 보낸다
      const p = mine(it.key);
      if (!p) continue;
      if (it.price !== p.price) { await updateProduct(p.key, { name: p.name, sub: p.sub, brand: p.brand, price: it.price }); priceChanged++; }
      loaded.push({ key: p.key, qty: it.qty, ship: it.ship ?? 0 });
      applied++;
    }
    const excludedNow = (snap.excluded ?? []).filter(k => !!mine(k));
    if (applied === 0 && excludedNow.length === 0) return json({ error: '불러올 수 있는 품목이 없어요. (삭제됐거나 내 공정이 아니에요)' }, 400);
    recordChangeLater(menu, { action: '금액·수량 불러오기', target: snap.name, detail: `${applied}개 품목 · 금액 바뀐 품목 ${priceChanged}개` });
    return json({ ok: true, applied, skipped: snap.items.length - applied, items: loaded, excluded: excludedNow });
  }

  if (b.action === 'buy' || b.action === 'buyMany') {
    if (!pricing) return json({ error: 'bad request' }, 400);
    const wanted: { key: string; qty: number; ship: number }[] = b.action === 'buy' ? [{ key: clip(b.key, 40), qty: whole(b.qty, 9_999_999), ship: whole(b.ship, 9_999_999) }] : Array.isArray(b.items) ? (b.items as { key?: unknown; qty?: unknown; ship?: unknown }[]).slice(0, 500).map(it => ({ key: typeof it?.key === 'string' ? clip(it.key, 40) : '', qty: whole(it?.qty, 9_999_999), ship: whole(it?.ship, 9_999_999) })) : [];
    if (wanted.length === 0) return json({ error: 'bad request' }, 400);
    const catTrades = await getCategoryTrades();
    const infos = await getPurchaseLinks(); // 구매처는 품목에 등록해 둔 값을 구매 기록에 남긴다
    let done = 0;
    const skipped: string[] = [];
    for (const { key, qty, ship } of wanted) { // 한 품목씩 차례로: 재고에 구매 수량을 더하고 구매완료로 남긴다
      const p = (await getProducts()).find(x => x.key === key);
      const trade = p ? catTrades[p.category] ?? '' : '';
      if (!p || p.kind !== '상비품' || !trades.includes(trade) || !(qty > 0)) { skipped.push(p?.name ?? key); continue; }
      const shipping = Number.isNaN(ship) ? 0 : ship;
      const vendor = infos[p.key]?.vendor ?? '';
      const supply = qty * p.price, vat = Math.round(supply * 0.1);
      await setStock(p.key, p.stock + qty); // 창고장비현황 재고에 더한다
      await addInventory({ action: 'buy', category: trade, productKey: p.key, name: p.name, brand: p.brand, qty, price: p.price, shipping, vendor, memo, byId: me.id, byName: me.name });
      recordChangeLater(menu, { action: '구매완료', target: p.name, detail: `${qty.toLocaleString('ko-KR')}개 × ${p.price.toLocaleString('ko-KR')}원 = 공급가액 ${supply.toLocaleString('ko-KR')} · 부가세 ${vat.toLocaleString('ko-KR')} · 배송비 ${shipping.toLocaleString('ko-KR')} · 합계 ${(supply + vat + shipping).toLocaleString('ko-KR')}원${vendor ? ` · 구매처 ${vendor}` : ''} · 재고 ${p.stock} → ${p.stock + qty}` });
      done++;
    }
    if (done === 0) return json({ error: b.action === 'buy' ? '구매할 수량을 먼저 적어 주세요.' : '구매할 수량이 적힌 품목이 없어요.' }, 400);
    return json({ ok: true, done, skipped });
  }

  if (b.action === 'delete') {
    const [allP, catT] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const p = allP.find(x => x.key === clip(b.key, 40));
    if (!p || p.kind !== '상비품') return json({ error: '없는 상비품이에요.' }, 404);
    const trade = catT[p.category] ?? '';
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    if (excl.categories.includes(p.category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    if ((await deleteProducts([p.key])) === 0) return json({ error: '없는 상비품이에요.' }, 404);
    await addInventory({ action: 'delete', category: trade, productKey: p.key, name: p.name, brand: p.brand, qty: p.stock, price: p.price, memo, byId: me.id, byName: me.name });
    recordChangeLater(menu, { action: '삭제', target: p.name, detail: `${trade} › ${p.category} · 창고장비현황 휴지통으로 이동` });
    return json({ ok: true });
  }
  return json({ error: 'bad request' }, 400);
}
