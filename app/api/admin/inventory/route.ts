import { getActor } from '@/lib/auth';
import { getInventoryStars, setInventoryStars, setKind, getProductLinks, saveProductLinks, getCategories, moveProducts, setSubs, addInventory, addProduct, getPurchaseLinks, setProductModel, setProductBattery, setProductVoltage, setProductCompat, setProductTags, deleteProducts, getCategoryTrades, getProducts, getTrades, nextProductKey, setPurchaseLink, updateProduct } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { inventoryTrades } from '@/lib/inventory';
import { recordChangeLater } from '@/lib/audit';
import { headOf, rewriteSub } from '@/lib/sub-path';
import { normTags } from '@/lib/tags';
import { viewOf } from '@/lib/product-link';

// 장비조사: 내 팀이 맡은 공정(대분류)의 상비품 목록에서
//  · 추가(add)  = 고른 공정·카테고리로 창고현황에도 상비품이 등록된다. 누가 언제 추가했는지 남는다. (가격조사는 금액·수량도 함께)
//  · 수정(rename) = 창고현황에도 같은 이름으로 바뀐다.
//  · 삭제(delete) = 창고현황의 휴지통으로 간다(복원 가능). 누가 언제 지웠는지 남는다.
// 내 팀이 맡은 공정은 팀 관리의 '관여 공정'을 따른다 (최고 관리자·개발팀은 모든 공정).
type Body = { incl?: unknown; on?: unknown; unit?: unknown; vendor?: unknown; ship?: unknown; ids?: unknown; excluded?: unknown; items?: unknown; id?: unknown; url?: unknown; keys?: unknown; menu?: unknown; action?: unknown; trade?: unknown; category?: unknown; name?: unknown; key?: unknown; price?: unknown; qty?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
/** 0 이상의 정수 (비어 있으면 0, 잘못되면 NaN) */
const whole = (v: unknown, max: number) => (v === undefined || v === null || v === '' ? 0 : typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : NaN);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const menu = 'inventory' as const;
  const actor = await getActor(menu);
  if (!actor) return json({ error: '장비조사 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, menu, 300, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  // 서로 상관없는 조회는 동시에 한다 (한 번 왕복에 약 0.2초씩 걸려서, 차례로 하면 그만큼 더해진다)
  const [scope, plinks] = await Promise.all([
    inventoryTrades(actor),
    getProductLinks().catch(() => [] as import('@/lib/types').ProductLink[]), // 공통 연결 복사본
  ]);
  const trades = scope.trades;
  const me = actor.kind === 'member' ? { id: actor.member.id, name: actor.member.name } : { id: '', name: '최고 관리자' };
  const memo = '';
  const okKind = (k: string) => k === '상비품' || k === '자재' || k === '연장'; // 상비품·자재·연장을 다룬다

  if (b.action === 'add') {
    const trade = clip(b.trade, 40);
    if (!trades.includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = whole(b.price, 99_999_999); // 장비조사도 가격을 함께 등록할 수 있다
    const qty = 0;
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    const category = clip(b.category, 40);
    if (!category) return json({ error: '카테고리를 골라 주세요.' }, 400);
    const [catTrades, allProducts, key, allTrades] = await Promise.all([getCategoryTrades(), getProducts(), nextProductKey(), getTrades()]); // 동시에 조회
    if (catTrades[category] !== trade) return json({ error: '이 공정의 카테고리가 아니에요.' }, 400);
    if ((b as { kind?: unknown }).kind !== '연장' && allProducts.some(p => catTrades[p.category] === trade && p.name === name)) return json({ error: '이 공정에 이미 있는 품목이에요.' }, 400); // 연장은 같은 이름을 중복 등록할 수 있다 (브랜드·제품명이 다른 같은 종류 연장)
    const wantKind = (b as { kind?: unknown }).kind;
    const kind = wantKind === '자재' || wantKind === '연장' ? wantKind : '상비품';
    const brandIn = clip((b as { brand?: unknown }).brand, 50);
    const product = await addProduct({ key, kind, category, sub: rewriteSub('', '', headOf(category, catTrades, allTrades)), name, brand: brandIn, price, priceInclVat: null, vatBasis: '', soldout: false, stock: 0, image: '', trades: [trade] });
    await addInventory({ action: 'add', category: trade, productKey: product.key, name, brand: '', qty, price, memo, byId: me.id, byName: me.name }).catch(() => undefined); // 기록 저장 실패는 작업을 막지 않는다
    recordChangeLater(menu, { action: '추가', target: name, detail: `${trade} › ${category}` });
    const modelIn = clip((b as { model?: unknown }).model, 100);
    if (modelIn) await setProductModel(product.key, modelIn); // 연장 제품명(모델명)
    const tagsIn = normTags((b as { tags?: unknown }).tags);
    if (tagsIn.length) await setProductTags(product.key, tagsIn); // 연장 태그
    const compatIn = clip((b as { compat?: unknown }).compat, 100);
    if (compatIn) await setProductCompat(product.key, compatIn); // 연장 호환성
    const voltageIn = clip((b as { voltage?: unknown }).voltage, 20);
    if (voltageIn) await setProductVoltage(product.key, voltageIn); // 연장 전압 (예: 18V)
    const batteryIn = clip((b as { battery?: unknown }).battery, 10);
    if (batteryIn === '포함' || batteryIn === '미포함') await setProductBattery(product.key, batteryIn); // 연장 배터리 포함 여부
    return json({ ok: true, key: product.key });
  }

  if (b.action === 'rename') {
    const [all, catTrades] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const rv = viewOf(clip(b.key, 40), all, catTrades, plinks); // 복사본이면 원본을 고친다 (모든 공정에 같이 반영)
    const p = rv?.p;
    if (!rv || !p || !okKind(p.kind)) return json({ error: '없는 품목이에요.' }, 404);
    if (!trades.includes(rv.trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const trade = catTrades[p.category] ?? '';
    const name = clip(b.name, 100);
    if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
    const price = b.price === undefined ? p.price : whole(b.price, 99_999_999); // 장비조사는 가격을 보냈을 때만 바꾼다
    if (Number.isNaN(price)) return json({ error: '금액은 0 이상의 숫자로 적어 주세요.' }, 400);
    if (p.kind !== '연장' && all.some(x => x.key !== p.key && catTrades[x.category] === trade && x.name === name)) return json({ error: '이 공정에 이미 있는 품목 이름이에요.' }, 400);
    // 부가세 포함가를 직접 적었으면(incl) 그 값을 그대로 저장한다. 공급가와 맞지 않으면 저장하지 않고, 적지 않았으면 (금액이 그대로일 때만) 기존 값을 유지한다.
    const inclGiven = b.incl === null ? null : typeof b.incl === 'number' && Number.isInteger(b.incl) && b.incl >= 0 && Math.round(b.incl / 1.1) === price ? b.incl : undefined;
    const priceInclVat = inclGiven !== undefined ? inclGiven : b.incl !== undefined ? null : price === p.price ? p.priceInclVat : null;
    const brandNew = typeof (b as { brand?: unknown }).brand === 'string' ? clip((b as { brand?: unknown }).brand, 50) : p.brand;
    if (!(await updateProduct(p.key, { name, sub: p.sub, brand: brandNew, price, priceInclVat }))) return json({ error: '없는 상비품이에요.' }, 404);
    if (typeof (b as { model?: unknown }).model === 'string') await setProductModel(p.key, clip((b as { model?: unknown }).model, 100));
    if ((b as { tags?: unknown }).tags !== undefined) await setProductTags(p.key, normTags((b as { tags?: unknown }).tags));
    if (typeof (b as { compat?: unknown }).compat === 'string') await setProductCompat(p.key, clip((b as { compat?: unknown }).compat, 100));
    if (typeof (b as { voltage?: unknown }).voltage === 'string') await setProductVoltage(p.key, clip((b as { voltage?: unknown }).voltage, 20));
    if (typeof (b as { battery?: unknown }).battery === 'string') await setProductBattery(p.key, clip((b as { battery?: unknown }).battery, 10));
    const changes: string[] = [];
    if (name !== p.name) changes.push(`이름 ${p.name} → ${name}`);
    if (price !== p.price) changes.push(`금액 ${p.price.toLocaleString('ko-KR')} → ${price.toLocaleString('ko-KR')}`);
    if (changes.length) recordChangeLater(menu, { action: '수정', target: name, detail: changes.join(' · ') });
    return json({ ok: true, name, price });
  }

  if (b.action === 'link') {
    // 구매 링크 등록·수정·삭제(빈 값): 내 공정의 품목만 (장비조사에서는 링크만 바꾸고 구매처·판매단위는 그대로 둔다)
    const lv = viewOf(clip(b.key, 40), await getProducts(), await getCategoryTrades(), plinks);
    const p = lv?.p;
    if (!lv || !p) return json({ error: '없는 상비품이에요.' }, 404);
    if (!trades.includes(lv.trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
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
    const curInfo = (await getPurchaseLinks())[p.key]; // 장비조사에서는 링크만 바꾸고 구매처·판매단위는 그대로 둔다
    const vendor = curInfo?.vendor ?? '', unit = curInfo?.unit ?? '';
    await setPurchaseLink(p.key, url || vendor || unit ? { url, vendor, unit } : null);
    recordChangeLater(menu, { action: '구매처·링크 변경', target: p.name, detail: url || vendor || unit ? `구매처 ${vendor || '—'} · 판매단위 ${unit || '—'} · ${url || '링크 없음'}` : '구매처·판매단위·링크 삭제' });
    return json({ ok: true, url, vendor, unit });
  }

  if (b.action === 'move' || b.action === 'copy') {
    // move: 체크한 품목을 다른 공정·카테고리로 이동 / copy: 원본은 그대로 두고 다른 공정·카테고리 목록에도 보이게 연결 복사 (재고·가격·링크는 원본 하나)
    // 내가 맡은 공정(최고 관리자·개발팀은 전체)의 품목만, 내가 맡은 공정으로만 가능하다. (장비조사 전용)
    const copy = b.action === 'copy';
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.filter((k): k is string => typeof k === 'string').map(k => clip(k, 40)))].slice(0, 500) : [];
    if (keys.length === 0) return json({ error: 'bad request' }, 400);
    const toTrade = clip(b.trade, 40);
    if (!trades.includes(toTrade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 403);
    const [allP, catT, allTrades, allCats] = await Promise.all([getProducts(), getCategoryTrades(), getTrades(), getCategories()]);
    const toCats = allCats.filter(c => catT[c] === toTrade);
    const wantCat = clip(b.category, 40);
    const views = [...new Map(keys.flatMap(k => { const v = viewOf(k, allP, catT, plinks); return v && okKind(v.p.kind) && trades.includes(v.trade) ? [[k, { k, v }] as const] : []; })).values()];
    if (views.length === 0) return json({ error: copy ? '복사할 수 있는 품목이 없어요.' : '옮길 수 있는 품목이 없어요.' }, 404);
    const flatOnly = views.every(x => x.v.p.kind === '연장'); // 연장은 카테고리 구분이 없어서 공정의 첫 카테고리에 둔다
    const dest = flatOnly ? (toCats[0] ?? '') : wantCat;
    if (!dest) return json({ error: flatOnly ? '이 공정에는 카테고리가 없어서 옮길 수 없어요.' : '카테고리를 골라 주세요.' }, 400);
    if (!toCats.includes(dest)) return json({ error: '이 공정의 카테고리가 아니에요.' }, 400);
    const catFor = (p: { kind: string }) => (p.kind === '연장' ? (toCats[0] ?? dest) : dest);
    const homeTrade = (p: { category: string }) => catT[p.category] ?? '';
    const cur = [...plinks];
    const done: { key: string; category: string }[] = [];
    const bad: string[] = [];
    if (copy) {
      const at = new Date().toISOString();
      for (const { v } of views) {
        const p = v.p;
        if (homeTrade(p) === toTrade || cur.some(l => l.key === p.key && l.trade === toTrade)) { bad.push(`${p.name} (이 공정에 이미 있어요)`); continue; }
        const link = { id: Math.random().toString(36).slice(2, 8), key: p.key, trade: toTrade, category: catFor(p), at, byName: me.name };
        cur.push(link);
        done.push({ key: `${p.key}@${link.id}`, category: link.category });
      }
      if (done.length === 0) return json({ error: `복사할 수 있는 품목이 없어요: ${bad.slice(0, 3).join(', ')}` }, 400);
      await saveProductLinks(cur);
      recordChangeLater(menu, { action: '공통 연결 복사', target: `${done.length}개 품목`, detail: `${views.slice(0, 5).map(x => x.v.p.name).join(', ')}${views.length > 5 ? ` 외 ${views.length - 5}개` : ''} → ${toTrade} › ${dest}` });
      return json({ ok: true, moved: done, category: dest, skipped: bad });
    }
    // 이동: 원본은 카테고리를 바꾸고, 복사본은 놓인 자리(공정·카테고리)만 바꾼다
    const masters = views.filter(x => !x.v.link && x.v.category !== catFor(x.v.p)).map(x => x.v.p);
    const clash = masters.filter(p => p.kind !== '연장' && homeTrade(p) !== toTrade && allP.some(x => homeTrade(x) === toTrade && x.name === p.name)); // 도착 공정에 같은 이름이 있으면 옮기지 않는다 (연장은 중복 허용)
    if (clash.length) return json({ error: `도착 공정에 이미 있는 품목 이름이에요: ${clash.slice(0, 3).map(p => p.name).join(', ')}${clash.length > 3 ? ' 외' : ''}` }, 400);
    for (const to of [...new Set(masters.map(p => catFor(p)))]) {
      const ks = masters.filter(p => catFor(p) === to).map(p => p.key);
      const r = await moveProducts(ks, to);
      if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
      await setSubs(ks.map(key => ({ key, sub: headOf(to, catT, allTrades) })));
    }
    masters.forEach(p => done.push({ key: p.key, category: catFor(p) }));
    let linkChanged = false;
    for (const { k, v } of views) {
      if (!v.link) continue;
      if (homeTrade(v.p) === toTrade || cur.some(l => l.id !== v.link!.id && l.key === v.link!.key && l.trade === toTrade)) { bad.push(`${v.p.name} (이 공정에 이미 있어요)`); continue; }
      const to = catFor(v.p);
      if (v.link.trade === toTrade && v.link.category === to) continue;
      const i = cur.findIndex(l => l.id === v.link!.id);
      if (i >= 0) { cur[i] = { ...cur[i], trade: toTrade, category: to }; linkChanged = true; done.push({ key: k, category: to }); }
    }
    if (linkChanged) await saveProductLinks(cur);
    if (done.length === 0 && bad.length) return json({ error: `옮길 수 없어요: ${bad.slice(0, 3).join(', ')}` }, 400);
    if (done.length) recordChangeLater(menu, { action: '이동', target: `${done.length}개 품목`, detail: `${views.slice(0, 5).map(x => x.v.p.name).join(', ')}${views.length > 5 ? ` 외 ${views.length - 5}개` : ''} → ${toTrade} › ${dest}` });
    return json({ ok: true, moved: done, category: dest, skipped: bad });
  }

  if (b.action === 'star') {
    // 즐겨찾기(별표): 계정마다 따로 저장되어 나에게만 적용된다 (다른 아이디에는 보이지 않는다)
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.filter((k): k is string => typeof k === 'string').map(k => clip(k, 40)))].slice(0, 500) : [];
    if (keys.length === 0) return json({ error: 'bad request' }, 400);
    const who = me.id || 'root';
    const on = (b as { on?: unknown }).on !== false;
    const cur = new Set((await getInventoryStars())[who] ?? []);
    keys.forEach(k => { if (on) cur.add(k); else cur.delete(k); });
    await setInventoryStars(who, [...cur].slice(-5000));
    return json({ ok: true, count: cur.size });
  }

  if (b.action === 'kind') {
    // 체크한 품목의 종류(상비품·자재·연장)를 바꾼다. 상비품·자재로 바꿀 때는 공정·카테고리를 정해야 하고, 연장은 공정만 쓰므로 지금 공정의 첫 카테고리에 둔다.
    const keys = Array.isArray(b.keys) ? [...new Set(b.keys.filter((k): k is string => typeof k === 'string').map(k => clip(k, 40)))].slice(0, 500) : [];
    const toKind = (b as { kind?: unknown }).kind;
    if (keys.length === 0 || (toKind !== '상비품' && toKind !== '자재' && toKind !== '연장')) return json({ error: 'bad request' }, 400);
    const [allP, catT, allTrades, allCats] = await Promise.all([getProducts(), getCategoryTrades(), getTrades(), getCategories()]);
    const homeOf = (p: { category: string }) => catT[p.category] ?? '';
    const catsOf = (t: string) => allCats.filter(c => catT[c] === t);
    // 복사본을 골랐어도 바뀌는 것은 원본이다 (원본이 내 공정에 있을 때만)
    const picked = [...new Map(keys.flatMap(k => { const v = viewOf(k, allP, catT, plinks); return v && okKind(v.p.kind) && trades.includes(homeOf(v.p)) ? [[v.p.key, v.p] as const] : []; })).values()];
    if (picked.length === 0) return json({ error: '바꿀 수 있는 품목이 없어요.' }, 404);
    const toTrade = clip(b.trade, 40);
    const wantCat = clip(b.category, 40);
    if (toKind !== '연장') {
      if (!trades.includes(toTrade)) return json({ error: toTrade ? '내 팀이 맡은 공정이 아니에요.' : '옮길 공정을 골라 주세요.' }, toTrade ? 403 : 400);
      if (!wantCat) return json({ error: '옮길 카테고리를 골라 주세요.' }, 400);
      if (!catsOf(toTrade).includes(wantCat)) return json({ error: '이 공정의 카테고리가 아니에요.' }, 400);
      const clash = picked.filter(p => homeOf(p) !== toTrade && allP.some(x => x.key !== p.key && homeOf(x) === toTrade && x.name === p.name));
      if (clash.length) return json({ error: `도착 공정에 이미 있는 품목 이름이에요: ${clash.slice(0, 3).map(p => p.name).join(', ')}${clash.length > 3 ? ' 외' : ''}` }, 400);
    }
    const destOf = (p: { category: string }) => (toKind === '연장' ? (catsOf(homeOf(p))[0] ?? p.category) : wantCat);
    await setKind(picked.map(p => p.key), toKind);
    const byCat = new Map<string, string[]>();
    picked.forEach(p => { const d = destOf(p); if (d !== p.category) byCat.set(d, [...(byCat.get(d) ?? []), p.key]); });
    for (const [cat, ks] of byCat) {
      const r = await moveProducts(ks, cat);
      if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
      await setSubs(ks.map(key => ({ key, sub: headOf(cat, catT, allTrades) })));
    }
    const changed = picked.map(p => { const d = destOf(p); return { key: p.key, trade: toKind === '연장' ? homeOf(p) : toTrade, category: d }; });
    recordChangeLater(menu, { action: '종류 변경', target: `${picked.length}개 품목`, detail: `${picked.slice(0, 5).map(p => p.name).join(', ')}${picked.length > 5 ? ` 외 ${picked.length - 5}개` : ''} → ${toKind}${toKind === '연장' ? '' : ` (${toTrade} › ${wantCat})`}` });
    return json({ ok: true, kind: toKind, changed });
  }

  if (b.action === 'deleteMany' || b.action === 'delete') {
    // 삭제: 원본은 창고현황 휴지통으로 가고(연결된 복사본도 함께 사라진다), 복사본은 그 공정에서만 빠진다. 내 공정의 품목만 처리한다.
    const many = b.action === 'deleteMany';
    const keys = many ? (Array.isArray(b.keys) ? [...new Set(b.keys.filter((k): k is string => typeof k === 'string').map(k => clip(k, 40)))].slice(0, 500) : []) : [clip(b.key, 40)];
    if (keys.length === 0 || !keys[0]) return json({ error: 'bad request' }, 400);
    const [allP, catT] = await Promise.all([getProducts(), getCategoryTrades()]); // 동시에 조회
    const views = keys.flatMap(k => { const v = viewOf(k, allP, catT, plinks); return v && okKind(v.p.kind) && trades.includes(v.trade) ? [{ k, v }] : []; });
    if (views.length === 0) return json({ error: many ? '삭제할 수 있는 품목이 없어요.' : '없는 품목이에요.' }, 404);
    const copies = views.filter(x => x.v.link);
    const targets = views.filter(x => !x.v.link).map(x => x.v);
    if (copies.length) await saveProductLinks(plinks.filter(l => !copies.some(c => c.v.link!.id === l.id)));
    if (targets.length) {
      await deleteProducts(targets.map(v => v.p.key));
      await Promise.all(targets.map(v => addInventory({ action: 'delete', category: v.trade, productKey: v.p.key, name: v.p.name, brand: v.p.brand, qty: v.p.stock, price: v.p.price, memo, byId: me.id, byName: me.name }).catch(() => undefined)));
    }
    const names = views.map(x => x.v.p.name);
    recordChangeLater(menu, { action: '삭제', target: views.length === 1 ? names[0] : `${views.length}개 품목`, detail: `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 외 ${names.length - 5}개` : ''} · ${targets.length ? '창고현황 휴지통으로 이동' : ''}${targets.length && copies.length ? ' / ' : ''}${copies.length ? `복사본 ${copies.length}개는 이 공정에서만 제거` : ''}` });
    return json({ ok: true, removed: views.map(x => x.k) });
  }
  return json({ error: 'bad request' }, 400);
}
