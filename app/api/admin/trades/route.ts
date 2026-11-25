import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { addTrade, getTrades, removeTrade, reorderTrades } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 공정 추가 / 삭제 (소모품 메뉴의 등록·삭제 권한)
// 삭제하면 소모품·회원에 걸린 그 공정, 카테고리의 공정 지정이 함께 빠진다 (소모품 자체는 지워지지 않는다)
const MAX_LEN = 10;
const MAX_COUNT = 30; // 설문 화면이 공정을 비트마스크(32비트)로 다루므로 30개까지
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);
  const body = (await req.json().catch(() => null)) as { action?: unknown; name?: unknown; to?: unknown } | null;
  if (!body || (body.action !== 'add' && body.action !== 'delete' && body.action !== 'reorder')) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'catalog', body.action === 'add' ? 'register' : body.action === 'reorder' ? 'edit' : 'delete')) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const name = clean(body.name);
  if (!name || name.length > MAX_LEN) return json({ error: `공정 이름은 1~${MAX_LEN}자로 적어 주세요.` }, 400);

  if (body.action === 'reorder') {
    // name 을 to(다른 공정)가 있던 자리로 옮긴다
    const list = await getTrades();
    const i = list.indexOf(name);
    const j = typeof body.to === 'string' ? list.indexOf(body.to) : -1;
    if (i < 0 || j < 0) return json({ error: '없는 공정이에요.' }, 404);
    if (i !== j) {
      list.splice(j, 0, list.splice(i, 1)[0]);
      if (!(await reorderTrades(list))) return json({ error: '순서를 바꿀 수 없어요.' }, 400);
    }
    return json({ ok: true, order: list });
  }
  if (body.action === 'add') {
    if ((await getTrades()).length >= MAX_COUNT) return json({ error: `공정은 ${MAX_COUNT}개까지 만들 수 있어요.` }, 400);
    const r = await addTrade(name);
    if ('conflict' in r) return json({ error: '이미 있는 공정 이름이에요.' }, 400);
    return json({ ok: true, name });
  }
  const r = await removeTrade(name);
  if ('notFound' in r) return json({ error: '없는 공정이에요.' }, 404);
  return json({ ok: true, count: 'count' in r ? r.count : 0 });
}

export const POST = audited('catalog', handlePOST);
