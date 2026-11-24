import { getProducts, getSites, getTeams, getTrades, returnStock, saveRequest, takeStock } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { getSessionMember } from '@/lib/member-session';
import { canSurvey, memberRoles, memberTrades } from '@/lib/roles';
import type { RequestItem } from '@/lib/types';

// 현장 자재 요청 (현장작업자·현장관리자 등 '자재 요청' 메뉴를 쓸 수 있는 회원).
// 누군지·이름·공정은 로그인 세션과 등록된 값으로만 정한다(보낸 값은 믿지 않음). 자재 이름·이미지는 서버의 카탈로그에서 가져와 저장한다.
const MAX_ITEMS = 300;
const MAX_QTY = 99999;
const MAX_CUSTOM = 20;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (limited(req, 'request', 30, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const raw = await req.text();
  if (raw.length > 100_000) return json({ error: '내용이 너무 커요.' }, 413);
  let b: { trade?: unknown; site?: unknown; items?: unknown; customs?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const member = await getSessionMember();
  if (!member) return json({ error: '로그인이 필요해요. 다시 로그인해 주세요.' }, 401);
  if (!canSurvey(memberRoles(member), member.menus)) return json({ error: '자재 요청 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const site = typeof b.site === 'string' ? b.site.trim().replace(/\s+/g, ' ') : '';
  if (!site || !(await getSites()).some(s => s.name === site)) return json({ error: '등록된 현장을 골라 주세요. 목록에 없으면 관리자에게 현장 등록을 요청해 주세요.' }, 400);
  const trade = typeof b.trade === 'string' ? b.trade : '';
  if (!memberTrades(await getTeams(), member, await getTrades()).includes(trade)) return json({ error: '내 팀이 맡은 공정이 아니에요.' }, 400);
  const picks = Array.isArray(b.items) ? b.items : [];
  const customs = Array.isArray(b.customs) ? b.customs : [];
  if (picks.length + customs.length < 1) return json({ error: '요청할 자재를 1개 이상 골라 주세요.' }, 400);
  if (picks.length > MAX_ITEMS || customs.length > MAX_CUSTOM) return json({ error: '한 번에 요청할 수 있는 품목 수를 넘었어요.' }, 400);

  const products = new Map((await getProducts()).map(p => [p.key, p]));
  const seen = new Set<string>();
  const items: RequestItem[] = [];
  for (const it of picks as { k?: unknown; q?: unknown }[]) {
    const k = typeof it?.k === 'string' ? it.k : '';
    const q = typeof it?.q === 'number' ? it.q : NaN;
    const p = products.get(k);
    if (!p || seen.has(k)) return json({ error: '없는 자재가 섞여 있어요. 화면을 새로고침해 주세요.' }, 400);
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) return json({ error: `“${p.name}” 수량은 1~${MAX_QTY} 사이로 적어 주세요.` }, 400);
    seen.add(k);
    items.push({ k, n: p.name, i: p.image, q });
  }

  // 목록에 없는 품목: 이름과 수량을 직접 적어 요청한다
  const extra: RequestItem[] = [];
  for (const [idx, c] of (customs as { n?: unknown; q?: unknown }[]).entries()) {
    const n = typeof c?.n === 'string' ? c.n.trim().replace(/\s+/g, ' ') : '';
    const q = typeof c?.q === 'number' ? c.q : NaN;
    if (!n || n.length > 100) return json({ error: '직접 적는 품목 이름은 1~100자로 적어 주세요.' }, 400);
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) return json({ error: `“${n}” 수량은 1~${MAX_QTY} 사이로 적어 주세요.` }, 400);
    extra.push({ k: 'x' + (idx + 1), n, i: '', q, x: true });
  }

  // 재고에서 요청 수량만큼 뺀다. 재고보다 많이 요청해도 받고, 재고는 0까지만 줄어든다. 모자란 수량은 요청에 적어 둔다.
  const taken = await takeStock(items.map(i => ({ k: i.k, q: i.q })));
  if ('short' in taken) return json({ error: taken.short }, 409);
  for (const it of items) {
    const short = it.q - (taken.took[it.k] ?? 0);
    if (short > 0) it.s = short;
  }
  let saved;
  try {
    saved = await saveRequest({ workerId: member.id, name: member.name, trade, site, items: [...items, ...extra] });
  } catch (e) {
    await returnStock(taken.took).catch(() => undefined); // 요청 저장에 실패하면 뺀 재고를 되돌린다
    throw e;
  }
  return json({ ok: true, id: saved.id, count: items.length + extra.length });
}
