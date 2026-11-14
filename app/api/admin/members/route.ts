import { actorCan, getActor } from '@/lib/auth';
import { getTrades } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';
import { addMember, deleteMember, resetMember, updateMember } from '@/lib/members';

// 회원 관리 (최고 관리자·개발팀 전용): 생성(아이디·임시 비밀번호 발급) / 수정 / 임시 비밀번호 재발급 / 삭제
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('members');
  if (!actor) return json({ error: '회원 관리 권한이 없어요. 최고 관리자나 개발팀 계정으로 로그인해 주세요.' }, 401);

  const b = (await req.json().catch(() => null)) as {
    action?: unknown; id?: unknown; name?: unknown; role?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; loginId?: unknown;
  } | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

  // 동작별 권한: 생성=등록, 수정·임시 비밀번호 재발급=수정, 삭제=삭제
  const need = b.action === 'add' ? 'register' : b.action === 'update' || b.action === 'reset' ? 'edit' : b.action === 'delete' ? 'delete' : null;
  if (!need) return json({ error: 'bad action' }, 400);
  if (!actorCan(actor, 'members', need)) return json({ error: '이 작업을 할 권한이 없어요.' }, 403);

  if (b.action === 'add') {
    const r = await addMember({ name: str(b.name) ?? '', role: b.role, menus: b.menus, actions: b.actions, trades: b.trades, loginId: str(b.loginId) }, await getTrades());
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, ...r });
  }

  if (typeof b.id !== 'string') return json({ error: 'bad id' }, 400);

  if (b.action === 'update') {
    const patch: { name?: string; role?: unknown; menus?: unknown; actions?: unknown; trades?: unknown; loginId?: string } = {};
    if (b.name !== undefined) patch.name = str(b.name) ?? '';
    if (b.role !== undefined) patch.role = b.role;
    if (b.menus !== undefined) patch.menus = b.menus;
    if (b.actions !== undefined) patch.actions = b.actions;
    if (b.trades !== undefined) patch.trades = b.trades;
    if (b.loginId !== undefined) patch.loginId = str(b.loginId) ?? '';
    const r = await updateMember(actor, b.id, patch, await getTrades());
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, member: r });
  }
  if (b.action === 'reset') {
    const r = await resetMember(actor, b.id);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true, ...r });
  }
  if (b.action === 'delete') {
    const r = await deleteMember(actor, b.id);
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true });
  }
  return json({ error: 'bad action' }, 400);
}
