import { actorCan, getActor } from '@/lib/auth';
import { completeRequest } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 현장 요청을 '준비 완료'로 처리한다. '현장요청' 메뉴의 수정(처리) 권한이 필요하다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('requests');
  if (!actor) return json({ error: '로그인이 필요해요.' }, 401);
  if (!actorCan(actor, 'requests', 'edit')) return json({ error: '요청을 처리할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id : '';
  if (!id || id.length > 40) return json({ error: 'bad request' }, 400);
  const by = actor.kind === 'member' ? actor.member.name : '최고 관리자';
  const r = await completeRequest(id, by);
  // 재고가 모자라 아직 못 채운 품목이 있으면 완료할 수 없다 — 먼저 채워야 한다
  if (r === 'short') return json({ error: '재고가 부족한 품목이 있어요. 부족한 품목을 먼저 채워 주세요.' }, 409);
  // 이미 다른 사람이 완료한 요청이면 조용히 성공으로 본다(알림만 정리하면 된다)
  return json({ ok: true });
}
