import { actorCan, getActor } from '@/lib/auth';
import { getRequests } from '@/lib/db';
import { json } from '@/lib/guard';

// 아직 '준비 완료'가 안 된 현장 요청 (새 요청 알림용). '현장요청' 메뉴의 수정(처리) 권한이 있는 사람만.
export async function GET() {
  const actor = await getActor('requests');
  if (!actor) return json({ error: '로그인이 필요해요.' }, 401);
  if (!actorCan(actor, 'requests', 'edit')) return json({ error: '권한이 없어요.' }, 403);
  const pending = (await getRequests()).filter(r => !r.done); // 최신순
  return json({ ok: true, requests: pending.slice(0, 50), total: pending.length });
}
