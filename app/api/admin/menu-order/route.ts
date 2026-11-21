import { hasRootSession } from '@/lib/auth';
import { saveMenuOrder } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';
import { getSessionMember } from '@/lib/member-session';
import { isStaffAdmin, memberRoles, orderedMenuKeys } from '@/lib/roles';

// 상단 메뉴 순서 저장 — 최고 관리자(내장 계정 포함)·개발팀만. 모든 사용자에게 같은 순서로 보인다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const member = await getSessionMember();
  const allowed = member ? isStaffAdmin(memberRoles(member)) : await hasRootSession();
  if (!allowed) return json({ error: '메뉴 순서는 최고 관리자와 개발팀만 바꿀 수 있어요.' }, 403);
  const b = (await req.json().catch(() => null)) as { order?: unknown } | null;
  if (!b || !Array.isArray(b.order) || b.order.length > 50) return json({ error: 'bad request' }, 400);
  const order = orderedMenuKeys(b.order);
  await saveMenuOrder(order);
  return json({ ok: true, order });
}
