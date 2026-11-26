import { getActor } from '@/lib/auth';
import { addInventory, addProduct, getPurchaseLinks, setProductModel, setProductBattery, setProductVoltage, getPurchaseOptions, savePurchaseOptions, getVendorShipping, saveVendorShipping, getInventory, getInventoryExcluded, removeInventory, saveInventoryExcluded, deleteProducts, getCategoryTrades, getProducts, getTrades, getFavoriteVendors, saveFavoriteVendors, getPricingSnapshots, nextProductKey, savePricingSnapshots, setPurchaseLink, setStock, updateProduct } from '@/lib/db';
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
type Body = { incl?: unknown; on?: unknown; unit?: unknown; vendor?: unknown; ship?: unknown; excludedTrades?: unknown; excludedCategories?: unknown; ids?: unknown; excluded?: unknown; items?: unknown; id?: unknown; url?: unknown; keys?: unknown; menu?: unknown; action?: unknown; trade?: unknown; category?: unknown; name?: unknown; key?: unknown; price?: unknown; qty?: unknown };
/** 가격조사 옵션 행의 키 `품목키#옵션id` 를 나눈다 (옵션이 아니면 opt 는 빈 문자열) */
const splitKey = (k: string) => { const i = k.indexOf('#'); return i < 0 ? { base: k, opt: '' } : { base: k.slice(0, i), opt: k.slice(i + 1) }; };
/** 판매단위 글자 앞의 입수(숫자). 없으면 1 */
const unitCount = (u: string) => { const m = /^\s*(\d[\d,]*(?:\.\d+)?)/.exec(u); const n = m ? Number(m[1].replace(/,/g, '')) : 1; return n > 0 ? Math.round(n) : 1; };
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
    inventoryTrades(actor, menu),
    // 장비조사에서 제외한 공정·카테고리는 보이지도, 추가·수정·삭제도 안 된다 (가격조사는 해당 없음)
    pricing ? Promise.resolve({ trades: [] as string[], categories: [] as string[] }) : getInventoryExcluded(),
  ]);
  const { admin } = scope;
  const trades = scope.trades.filter(t => !excl.trades.includes(t));
  const me = actor.kind === 'member' ? { id: actor.member.id, name: actor.member.name } : { id: '', name: '최고 관리자' };
  const memo = pricing ? 'pricing' : ''; // 기록에 어느 메뉴에서 했는지 남긴다
  const okKind = (k: string) => k === '상비품' || k === '자재' || k === '연장'; // 장비조사·가격조사 모두 상비품·자재·연장을 다룬다

  if (b.action === 'add') {
    const trade = clip(b.trade, 40);
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = whole(b.price, 99_999_999); // 장비조사도 가격을 함께 등록할 수 있다
    const qty = pricing ? whole(b.qty, 9_999_999) : 0;
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    if (Number.isNaN(qty)) return json({ error: '수량은 0 이상의 숫자로 적어 주세요.' }, 400);
    const category = clip(b.category, 40);
    if (!category) return json({ error: '카테고리를 골라 주세요.' }, 400);
    const [catTrades, allProducts, key, allTrades] = await Promise.all([getCategoryTrades(), getProducts(), nextProductKey(), getTrades()]); // 동시에 조회
    if (catTrades[category] !== trade) return json({ error: '이 공정의 카테고리가 아니에요.' }, 400);
    if (excl.categories.includes(category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    if (allProducts.some(p => catTrades[p.category] === trade && p.name === name)) return json({ error: '이 공정에 이미 있는 품목이에요.' }, 400);
    const wantKind = (b as { kind?: unknown }).kind;
    const kind = wantKind === '자재' || wantKind === '연장' ? wantKind : '상비품';
    const brandIn = clip((b as { brand?: unknown }).brand, 50);
    const product = await addProduct({ key, kind, category, sub: rewriteSub('', '', headOf(category, catTrades, allTrades)), name, brand: brandIn, price, priceInclVat: null, vatBasis: '', soldout: false, stock: 0, image: '', trades: [trade] });
    await addInventory({ action: 'add', category: trade, productKey: product.key, name, brand: '', qty, price, memo, byId: me.id, byName: me.name }).catch(() => undefined); // 기록 저장 실패는 작업을 막지 않는다
    recordChangeLater(menu, { action: '추가', target: name, detail: `${trade} › ${category}${pricing ? ` · 금액 ${price.toLocaleString('ko-KR')} · 구매 예정 수량 ${qty}` : ''}` });
    const modelIn = clip((b as { model?: unknown }).model, 100);
    if (modelIn) await setProductModel(product.key, modelIn); // 연장 제품명(모델명)
    const voltageIn = clip((b as { voltage?: unknown }).voltage, 20);
    if (voltageIn) await setProductVoltage(product.key, voltageIn); // 연장 전압 (예: 18V)
    const batteryIn = clip((b as { battery?: unknown }).battery, 10);
    if (batteryIn === '포함' || batteryIn === '미포함') await setProductBattery(product.key, batteryIn); // 연장 배터리 포함 여부
    return json({ ok: true, key: product.key });
  }

  if (b.action === 'rename') {
    const [all, catTrades] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const sk = splitKey(clip(b.key, 60));
    if (sk.opt) {
      // 가격조사의 판매 옵션 행: 이 옵션의 금액만 바꾼다 (품목 이름·창고장비현황 가격은 그대로)
      if (!pricing) return json({ error: 'bad request' }, 400);
      const bp = all.find(x => x.key === sk.base);
      if (!bp || !okKind(bp.kind)) return json({ error: '없는 품목이에요.' }, 404);
      if (!trades.includes(catTrades[bp.category] ?? '')) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
      const price = whole(b.price, 99_999_999);
      if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
      const opts = await getPurchaseOptions();
      const o = (opts[sk.base] ?? []).find(x => x.id === sk.opt);
      if (!o) return json({ error: '없는 판매 옵션이에요.' }, 404);
      const incl = typeof b.incl === 'number' && Number.isInteger(b.incl) && b.incl >= 0 && Math.round(b.incl / 1.1) === price ? b.incl : null;
      const before = o.price;
      o.price = price; o.incl = incl;
      await savePurchaseOptions(opts);
      if (before !== price) recordChangeLater(menu, { action: '옵션 금액 수정', target: `${bp.name} (${o.unit || '옵션'})`, detail: `금액 ${before.toLocaleString('ko-KR')} → ${price.toLocaleString('ko-KR')}` });
      return json({ ok: true, name: bp.name, price });
    }
    const p = all.find(x => x.key === clip(b.key, 40));
    if (!p || !okKind(p.kind)) return json({ error: '없는 품목이에요.' }, 404);
    const trade = catTrades[p.category] ?? '';
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    if (excl.categories.includes(p.category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = b.price === undefined ? p.price : whole(b.price, 99_999_999); // 장비조사는 가격을 보냈을 때만 바꾼다
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    if (all.some(x => x.key !== p.key && catTrades[x.category] === trade && x.name === name)) return json({ error: '이 공정에 이미 있는 품목 이름이에요.' }, 400);
    // 부가세 포함가를 직접 적었으면(incl) 그 값을 그대로 저장한다. 공급가와 맞지 않으면 저장하지 않고, 적지 않았으면 (금액이 그대로일 때만) 기존 값을 유지한다.
    const inclGiven = b.incl === null ? null : typeof b.incl === 'number' && Number.isInteger(b.incl) && b.incl >= 0 && Math.round(b.incl / 1.1) === price ? b.incl : undefined;
    const priceInclVat = inclGiven !== undefined ? inclGiven : b.incl !== undefined ? null : price === p.price ? p.priceInclVat : null;
    const brandNew = typeof (b as { brand?: unknown }).brand === 'string' ? clip((b as { brand?: unknown }).brand, 50) : p.brand;
    if (!(await updateProduct(p.key, { name, sub: p.sub, brand: brandNew, price, priceInclVat }))) return json({ error: '없는 상비품이에요.' }, 404);
    if (typeof (b as { model?: unknown }).model === 'string') await setProductModel(p.key, clip((b as { model?: unknown }).model, 100));
    if (typeof (b as { voltage?: unknown }).voltage === 'string') await setProductVoltage(p.key, clip((b as { voltage?: unknown }).voltage, 20));
    if (typeof (b as { battery?: unknown }).battery === 'string') await setProductBattery(p.key, clip((b as { battery?: unknown }).battery, 10));
    const changes: string[] = [];
    if (name !== p.name) changes.push(`이름 ${p.name} → ${name}`);
    if (price !== p.price) changes.push(`금액 ${p.price.toLocaleString('ko-KR')} → ${price.toLocaleString('ko-KR')}`);
    if (changes.length) recordChangeLater(menu, { action: '수정', target: name, detail: changes.join(' · ') });
    return json({ ok: true, name, price });
  }

  if (b.action === 'favVendor') {
    // 자주 가는 구매처 고정/해제 (모두 같이 쓴다)
    if (!pricing) return json({ error: 'bad request' }, 400);
    const vendor = clip(b.vendor, 40);
    if (!vendor) return json({ error: '구매처 이름이 없어요.' }, 400);
    const cur = await getFavoriteVendors();
    const has = cur.some(v => v.toLowerCase() === vendor.toLowerCase());
    const next = b.on === false ? cur.filter(v => v.toLowerCase() !== vendor.toLowerCase()) : has ? cur : [...cur, vendor].slice(-40);
    await saveFavoriteVendors(next);
    recordChangeLater(menu, { action: b.on === false ? '자주 가는 구매처 해제' : '자주 가는 구매처 고정', target: vendor, detail: `${next.length}곳` });
    return json({ ok: true, favorites: next });
  }

  if (b.action === 'vendorShip') {
    // 구매처별 배송 정책: 기본 배송비와 무료배송 기준 금액 (둘 다 0이면 정책 삭제)
    if (!pricing) return json({ error: 'bad request' }, 400);
    const vendor = clip(b.vendor, 40);
    if (!vendor) return json({ error: '구매처 이름이 필요해요.' }, 400);
    const fee = whole((b as { fee?: unknown }).fee, 9_999_999);
    const freeOver = whole((b as { freeOver?: unknown }).freeOver, 99_999_999);
    if (Number.isNaN(fee) || Number.isNaN(freeOver)) return json({ error: '배송비와 무료배송 기준은 0 이상의 숫자로 적어 주세요.' }, 400);
    const all = await getVendorShipping();
    const k = vendor.toLowerCase();
    if (fee > 0 || freeOver > 0) all[k] = { fee, freeOver }; else delete all[k];
    await saveVendorShipping(all);
    recordChangeLater(menu, { action: '구매처 배송비 설정', target: vendor, detail: fee > 0 || freeOver > 0 ? `기본 배송비 ${fee.toLocaleString('ko-KR')}원 · 무료배송 ${freeOver > 0 ? freeOver.toLocaleString('ko-KR') + '원 이상' : '기준 없음'}` : '설정 삭제' });
    return json({ ok: true });
  }

  if (b.action === 'optAdd' || b.action === 'optDel') {
    // 가격조사: 같은 품목에 판매 옵션(묶음·단품 등)을 더하거나 지운다
    if (!pricing) return json({ error: 'bad request' }, 400);
    const ok = splitKey(clip(b.key, 60));
    const p = (await getProducts()).find(x => x.key === ok.base);
    if (!p || !okKind(p.kind)) return json({ error: '없는 품목이에요.' }, 404);
    if (!trades.includes((await getCategoryTrades())[p.category] ?? '')) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const opts = await getPurchaseOptions();
    const list = opts[p.key] ?? [];
    if (b.action === 'optAdd') {
      if (list.length >= 8) return json({ error: '판매 옵션은 품목마다 8개까지 만들 수 있어요.' }, 400);
      const id = Math.random().toString(36).slice(2, 7);
      opts[p.key] = [...list, { id, unit: '', vendor: '', url: '', price: p.price, incl: null }];
      await savePurchaseOptions(opts);
      recordChangeLater(menu, { action: '판매 옵션 추가', target: p.name, detail: `옵션 ${list.length + 2}개째` });
      return json({ ok: true, id });
    }
    const o = list.find(x => x.id === ok.opt);
    if (!o) return json({ error: '없는 판매 옵션이에요.' }, 404);
    if (list.length <= 1) delete opts[p.key]; else opts[p.key] = list.filter(x => x.id !== ok.opt);
    await savePurchaseOptions(opts);
    recordChangeLater(menu, { action: '판매 옵션 삭제', target: p.name, detail: o.unit || '옵션' });
    return json({ ok: true });
  }

  if (b.action === 'link') {
    // 구매 링크 등록·수정·삭제(빈 값): 내 공정의 품목만 (장비조사에서는 링크만 바꾸고 구매처·판매단위는 그대로 둔다)
    const lk = splitKey(clip(b.key, 60));
    const p = (await getProducts()).find(x => x.key === lk.base);
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
    let vendor = clip(b.vendor, 40);
    let unit = clip(b.unit, 20); // 판매단위 (예: 박스, 10개입)
    if (!pricing) {
      if (excl.categories.includes(p.category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
      const curInfo = (await getPurchaseLinks())[p.key];
      vendor = curInfo?.vendor ?? ''; unit = curInfo?.unit ?? '';
    }
    if (lk.opt) {
      // 판매 옵션 행: 이 옵션의 구매처·판매단위·링크만 바꾼다
      const opts = await getPurchaseOptions();
      const o = (opts[p.key] ?? []).find(x => x.id === lk.opt);
      if (!o) return json({ error: '없는 판매 옵션이에요.' }, 404);
      o.url = url; o.vendor = vendor; o.unit = unit;
      await savePurchaseOptions(opts);
      recordChangeLater(menu, { action: '옵션 구매처·링크 변경', target: `${p.name} (${unit || '옵션'})`, detail: `구매처 ${vendor || '—'} · 판매단위 ${unit || '—'} · ${url || '링크 없음'}` });
      return json({ ok: true, url, vendor, unit });
    }
    await setPurchaseLink(p.key, url || vendor || unit ? { url, vendor, unit } : null);
    recordChangeLater(menu, { action: '구매처·링크 변경', target: p.name, detail: url || vendor || unit ? `구매처 ${vendor || '—'} · 판매단위 ${unit || '—'} · ${url || '링크 없음'}` : '구매처·판매단위·링크 삭제' });
    return json({ ok: true, url, vendor, unit });
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
    const optsAll = await getPurchaseOptions();
    const mine = (key: string) => { const sk = splitKey(key); const p = all.find(x => x.key === sk.base); return p && okKind(p.kind) && trades.includes(catTrades[p.category] ?? '') && (!sk.opt || (optsAll[p.key] ?? []).some(o => o.id === sk.opt)) ? p : null; };
    if (b.action === 'snapSave') {
      const name = clip(b.name, 30);
      if (!name) return json({ error: '저장본 이름을 적어 주세요.' }, 400);
      const given = Array.isArray(b.items) ? (b.items as { key?: unknown; qty?: unknown; ship?: unknown }[]).slice(0, 2000) : [];
      const items = given.flatMap(it => { const p = typeof it?.key === 'string' ? mine(it.key) : null; const q = whole(it?.qty, 9_999_999); const sh = whole(it?.ship, 9_999_999); return p && !Number.isNaN(q) ? [{ key: clip(it.key, 60), price: p.price, qty: q, ship: Number.isNaN(sh) ? 0 : sh }] : []; });
      const excluded = Array.isArray(b.excluded) ? [...new Set(b.excluded.filter((k): k is string => typeof k === 'string' && !!mine(k)))].slice(0, 2000) : []; // 조사에서 제외한 품목
      if (items.length === 0 && excluded.length === 0) return json({ error: '저장할 품목이 없어요.' }, 400);
      const snap = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, at: new Date().toISOString(), byName: me.name, items, excluded };
      await savePricingSnapshots([snap, ...list.filter(x => x.name !== name)].slice(0, 30)); // 같은 이름이면 덮어쓰고 최대 30개
      recordChangeLater(menu, { action: '금액·수량 저장', target: name, detail: `${items.length}개 품목 · 제외 ${excluded.length}개` });
      return json({ ok: true, count: items.length });
    }
    const snap = list.find(x => x.id === clip(b.id, 40));
    if (!snap) return json({ error: '없는 저장본이에요.' }, 404);
    let applied = 0;
    const loaded: { key: string; qty: number; ship: number }[] = [];
    for (const it of snap.items) { // 한 품목씩: 금액은 창고장비현황 가격으로 되돌리고, 수량은 화면에 채워 보낸다
      const p = mine(it.key);
      if (!p) continue;
      loaded.push({ key: it.key, qty: it.qty, ship: it.ship ?? 0 });
      applied++;
    }
    const excludedNow = (snap.excluded ?? []).filter(k => !!mine(k));
    if (applied === 0 && excludedNow.length === 0) return json({ error: '불러올 수 있는 품목이 없어요. (삭제됐거나 내 공정이 아니에요)' }, 400);
    recordChangeLater(menu, { action: '금액·수량 불러오기', target: snap.name, detail: `${applied}개 품목 · 수량·배송비 채움 (금액은 현재 값 유지)` });
    return json({ ok: true, applied, skipped: snap.items.length - applied, items: loaded, excluded: excludedNow });
  }

  if (b.action === 'buy' || b.action === 'buyMany') {
    if (!pricing) return json({ error: 'bad request' }, 400);
    const wanted: { key: string; qty: number; ship: number }[] = b.action === 'buy' ? [{ key: clip(b.key, 40), qty: whole(b.qty, 9_999_999), ship: whole(b.ship, 9_999_999) }] : Array.isArray(b.items) ? (b.items as { key?: unknown; qty?: unknown; ship?: unknown }[]).slice(0, 500).map(it => ({ key: typeof it?.key === 'string' ? clip(it.key, 40) : '', qty: whole(it?.qty, 9_999_999), ship: whole(it?.ship, 9_999_999) })) : [];
    if (wanted.length === 0) return json({ error: 'bad request' }, 400);
    const catTrades = await getCategoryTrades();
    const infos = await getPurchaseLinks(); // 구매처는 품목에 등록해 둔 값을 구매 기록에 남긴다
    const optsAll = await getPurchaseOptions(); // 판매 옵션(묶음·단품) 행은 옵션의 금액·구매처·판매단위로 기록한다
    let done = 0;
    const skipped: string[] = [];
    for (const { key, qty, ship } of wanted) { // 한 품목씩 차례로: 재고에 구매 수량을 더하고 구매완료로 남긴다
      const sk = splitKey(key);
      const p = (await getProducts()).find(x => x.key === sk.base);
      const trade = p ? catTrades[p.category] ?? '' : '';
      const opt = p && sk.opt ? (optsAll[p.key] ?? []).find(o => o.id === sk.opt) : undefined;
      if (!p || !okKind(p.kind) || !trades.includes(trade) || !(qty > 0) || (sk.opt && !opt)) { skipped.push(p?.name ?? key); continue; }
      const shipping = Number.isNaN(ship) ? 0 : ship;
      const vendor = (opt ? opt.vendor : infos[p.key]?.vendor) ?? '';
      const unit = (opt ? opt.unit : infos[p.key]?.unit) || '개'; // 판매단위를 적지 않았으면 기본 '개'
      const unitPrice = opt ? opt.price : p.price;
      const hasOpts = (optsAll[p.key] ?? []).length > 0;
      const addStock = hasOpts ? qty * unitCount(unit) : qty; // 판매 옵션이 있는 품목은 낱개 기준으로 재고에 더한다 (묶음 10개입 × 2 = 20)
      const supply = qty * unitPrice; // 부가세는 따로 계산하지 않는다 (단가 × 수량 + 배송비)
      await addInventory({ action: 'buy', category: trade, productKey: p.key, name: p.name, brand: p.brand, qty, price: unitPrice, shipping, vendor, unit, memo, byId: me.id, byName: me.name });
      await setStock(p.key, p.stock + addStock); // 창고장비현황 재고에 더한다
      recordChangeLater(menu, { action: '구매완료', target: p.name, detail: `${qty.toLocaleString('ko-KR')}개 × ${unitPrice.toLocaleString('ko-KR')}원 = 물품 ${supply.toLocaleString('ko-KR')} · 배송비 ${shipping.toLocaleString('ko-KR')} · 합계 ${(supply + shipping).toLocaleString('ko-KR')}원${vendor ? ` · 구매처 ${vendor}` : ''} · 재고 ${p.stock} → ${p.stock + qty}` });
      done++;
    }
    if (done === 0) return json({ error: b.action === 'buy' ? '구매할 수량을 먼저 적어 주세요.' : '구매할 수량이 적힌 품목이 없어요.' }, 400);
    return json({ ok: true, done, skipped });
  }

  if (b.action === 'deleteMany') {
    // 체크한 품목을 한꺼번에 삭제 (창고장비현황 휴지통으로). 내 공정의 상비품만 처리한다.
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.filter((k): k is string => typeof k === 'string').map(k => clip(k, 40)))].slice(0, 500) : [];
    if (keys.length === 0) return json({ error: 'bad request' }, 400);
    const [allP, catT] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const targets = keys.flatMap(k => { const p = allP.find(x => x.key === k); return p && okKind(p.kind) && trades.includes(catT[p.category] ?? '') && !excl.categories.includes(p.category) ? [p] : []; });
    if (targets.length === 0) return json({ error: '삭제할 수 있는 품목이 없어요.' }, 404);
    await deleteProducts(targets.map(p => p.key));
    await Promise.all(targets.map(p => addInventory({ action: 'delete', category: catT[p.category] ?? '', productKey: p.key, name: p.name, brand: p.brand, qty: p.stock, price: p.price, memo, byId: me.id, byName: me.name }).catch(() => undefined)));
    recordChangeLater(menu, { action: '삭제', target: `${targets.length}개 품목`, detail: `${targets.slice(0, 5).map(p => p.name).join(', ')}${targets.length > 5 ? ` 외 ${targets.length - 5}개` : ''} · 창고장비현황 휴지통으로 이동` });
    return json({ ok: true, removed: targets.map(p => p.key) });
  }

  if (b.action === 'delete') {
    const [allP, catT] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const p = allP.find(x => x.key === clip(b.key, 40));
    if (!p || !okKind(p.kind)) return json({ error: '없는 품목이에요.' }, 404);
    const trade = catT[p.category] ?? '';
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    if (excl.categories.includes(p.category)) return json({ error: '장비조사에서 제외된 카테고리예요.' }, 403);
    if ((await deleteProducts([p.key])) === 0) return json({ error: '없는 상비품이에요.' }, 404);
    await addInventory({ action: 'delete', category: trade, productKey: p.key, name: p.name, brand: p.brand, qty: p.stock, price: p.price, memo, byId: me.id, byName: me.name }).catch(() => undefined); // 기록 저장 실패는 작업을 막지 않는다
    recordChangeLater(menu, { action: '삭제', target: p.name, detail: `${trade} › ${p.category} · 창고장비현황 휴지통으로 이동` });
    return json({ ok: true });
  }
  return json({ error: 'bad request' }, 400);
}
