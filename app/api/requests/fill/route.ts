import { actorCan, getActor } from '@/lib/auth';
import { fillRequestItem } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 재고가 모자랐던 품목을 채운다(입고). 입고 수량이 재고에 들어가고, 이 요청의 부족분이 바로 채워진다.
// '현장요청' 메뉴의 수정(처리) 권한이 필요하다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('requests');
  if (!actor) return json({ error: '로그인이 필요해요.' }, 401);
  if (!actorCan(actor, 'requests', 'edit')) return json({ error: '요청을 처리할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const b = (await req.json().catch(() => null)) as { id?: unknown; k?: unknown; received?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id : '';
  const k = typeof b?.k === 'string' ? b.k : '';
  const received = typeof b?.received === 'number' ? b.received : NaN;
  if (!id || id.length > 40 || !k || k.length > 64) return json({ error: 'bad request' }, 400);
  if (!Number.isInteger(received) || received < 1 || received > 9_999_999) return json({ error: '입고 수량을 숫자로 적어 주세요.' }, 400);

  const r = await fillRequestItem(id, k, received);
  return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, request: r.request });
}
