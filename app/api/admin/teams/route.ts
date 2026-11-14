import { actorCan, getActor } from '@/lib/auth';
import { json, sameOrigin } from '@/lib/guard';
import { addTeam, deleteTeam } from '@/lib/teams';

// 팀명 추가·삭제 (최고 관리자·개발팀). 구분(사내/협력)·부서(사무실/현장/외주)와 팀 이름 변경은 지원하지 않는다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('members');
  if (!actor) return json({ error: '회원 관리 권한이 없어요.' }, 401);

  const b = (await req.json().catch(() => null)) as { action?: unknown; label?: unknown; group?: unknown; key?: unknown } | null;
  if (!b) return json({ error: 'bad request' }, 400);

  if (b.action === 'add') {
    if (!actorCan(actor, 'members', 'register')) return json({ error: '팀을 추가할 권한이 없어요.' }, 403);
    const r = await addTeam({ label: typeof b.label === 'string' ? b.label : '', group: b.group });
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, team: r.team });
  }
  if (b.action === 'delete') {
    if (!actorCan(actor, 'members', 'delete')) return json({ error: '팀을 삭제할 권한이 없어요.' }, 403);
    if (typeof b.key !== 'string') return json({ error: 'bad key' }, 400);
    const r = await deleteTeam(b.key);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true });
  }
  return json({ error: 'bad action' }, 400);
}
