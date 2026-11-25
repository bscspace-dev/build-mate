import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { headOf, rewriteSub } from '@/lib/sub-path';
import { getProducts, setSubs, addCategory, getCategories, getCategoryTrades, getTrades, removeCategory, renameCategory, saveCategoryOrder, setCategoryTrade } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 소모품 카테고리 등록 / 이름 수정·순서 변경 / 삭제 (각각 소모품 메뉴의 등록·수정·삭제 권한)
// 삭제하면 그 카테고리의 소모품은 모두 휴지통으로 이동한다 (복원 가능)
const MAX = 20;
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);
  const body = (await req.json().catch(() => null)) as { action?: unknown; name?: unknown; to?: unknown; dir?: unknown; trade?: unknown } | null;
  if (!body) return json({ error: 'bad request' }, 400);
  const need = body.action === 'add' ? 'register' : body.action === 'rename' || body.action === 'reorder' || body.action === 'settrade' ? 'edit' : body.action === 'delete' ? 'delete' : null;
  if (!need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'catalog', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const name = clean(body.name);
  if (!name || name.length > MAX) return json({ error: `카테고리 이름은 1~${MAX}자로 적어 주세요.` }, 400);

  if (body.action === 'settrade') {
    const trade = typeof body.trade === 'string' ? body.trade : '';
    const [ctBefore, trades, prods] = await Promise.all([getCategoryTrades(), getTrades(), getProducts()]);
    const r = await setCategoryTrade(name, trade);
    if ('notFound' in r) return json({ error: '없는 카테고리나 공정이에요.' }, 404);
    const oldHead = headOf(name, ctBefore, trades), newHead = headOf(name, { ...ctBefore, [name]: trade }, trades);
    if (oldHead !== newHead) await setSubs(prods.filter(p => p.category === name).map(p => ({ key: p.key, sub: rewriteSub(p.sub, oldHead, newHead) })));
    return json({ ok: true });
  }

  if (body.action === 'add') {
    const trade = typeof body.trade === 'string' ? body.trade : '';
    if (trade && !(await getTrades()).includes(trade)) return json({ error: '없는 공정이에요.' }, 400);
    const r = await addCategory(name, trade);
    if ('conflict' in r) return json({ error: '이미 있는 카테고리 이름이에요.' }, 400);
    return json({ ok: true, name });
  }
  if (body.action === 'reorder') {
    // 끌어서 이동: name 을 to(다른 카테고리)가 있던 자리로 옮긴다
    if (typeof body.to === 'string') {
      const list = await getCategories();
      const i = list.indexOf(name);
      const j = list.indexOf(body.to);
      if (i < 0 || j < 0) return json({ error: '없는 카테고리예요.' }, 404);
      if (i !== j) {
        list.splice(j, 0, list.splice(i, 1)[0]);
        await saveCategoryOrder(list);
      }
      return json({ ok: true, order: list });
    }
    // 같은 공정 묶음 안에서 한 칸 위(up) / 아래(down)로 옮긴다
    if (body.dir !== 'up' && body.dir !== 'down') return json({ error: 'bad request' }, 400);
    const [list, tmap] = await Promise.all([getCategories(), getCategoryTrades()]);
    const i = list.indexOf(name);
    if (i < 0) return json({ error: '없는 카테고리예요.' }, 404);
    const same = (c: string) => (tmap[c] ?? '') === (tmap[name] ?? '');
    let j = i;
    do j += body.dir === 'up' ? -1 : 1;
    while (j >= 0 && j < list.length && !same(list[j]));
    if (j < 0 || j >= list.length) return json({ ok: true, order: list });
    [list[i], list[j]] = [list[j], list[i]];
    await saveCategoryOrder(list);
    return json({ ok: true, order: list });
  }
  if (body.action === 'rename') {
    const to = clean(body.to);
    if (!to || to.length > MAX) return json({ error: `새 이름은 1~${MAX}자로 적어 주세요.` }, 400);
    if (to === name) return json({ ok: true, name: to, count: 0 });
    const [ctBefore, trades, prods] = await Promise.all([getCategoryTrades(), getTrades(), getProducts()]);
    const r = await renameCategory(name, to);
    if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
    if ('conflict' in r) return json({ error: '이미 있는 카테고리 이름이에요.' }, 400);
    const oldHead = headOf(name, ctBefore, trades), newHead = headOf(to, { ...ctBefore, [to]: ctBefore[name] ?? '' }, trades);
    await setSubs(prods.filter(p => p.category === name).map(p => ({ key: p.key, sub: rewriteSub(p.sub, oldHead, newHead) })));
    return json({ ok: true, name: to, count: 'count' in r ? r.count : 0 });
  }
  const r = await removeCategory(name);
  if ('notFound' in r) return json({ error: '없는 카테고리예요.' }, 404);
  return json({ ok: true, count: 'count' in r ? r.count : 0 }); // 그 카테고리의 소모품은 휴지통으로 옮겨졌다
}

export const POST = audited('catalog', handlePOST);
