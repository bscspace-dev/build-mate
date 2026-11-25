import { getActor } from '@/lib/auth';
import { removeAudit } from '@/lib/db';
import { recordChange } from '@/lib/audit';
import { json, limited, sameOrigin } from '@/lib/guard';
import { isStaffAdmin, memberRoles } from '@/lib/roles';

// 변경이력 삭제: 모든 권한이 있는 사람(최고 관리자·개발팀)만. 삭제한 사실은 변경이력에 새로 남는다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('history');
  if (!actor) return json({ error: '변경이력 메뉴 권한이 필요해요.' }, 401);
  if (!(actor.kind === 'root' || isStaffAdmin(memberRoles(actor.member)))) return json({ error: '변경이력은 모든 권한이 있는 사람(최고 관리자·개발팀)만 삭제할 수 있어요.' }, 403);
  if (limited(req, 'history', 60, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as { action?: unknown; ids?: unknown } | null;
  if (!b || b.action !== 'delete' || !Array.isArray(b.ids)) return json({ error: 'bad request' }, 400);
  const ids = [...new Set(b.ids.filter((x): x is string => typeof x === 'string' && x.length < 64))].slice(0, 1000);
  if (ids.length === 0) return json({ error: 'bad request' }, 400);
  const removed = await removeAudit(ids);
  if (removed === 0) return json({ error: '없는 기록이에요.' }, 404);
  await recordChange('history', { action: '삭제', target: '변경이력', detail: `${removed}건 삭제` });
  return json({ ok: true, removed });
}
