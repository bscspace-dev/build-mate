import { hasRootSession } from '@/lib/auth';
import { getMenuOrder, getTeams, getTrades, getVehicles } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { changeOwnPassword, updateMember } from '@/lib/members';
import { toPublic } from '@/lib/member-utils';
import { createMemberSession, getSessionMember } from '@/lib/member-session';
import { effectiveMenus, memberRoles, teamsLabel } from '@/lib/roles';
import { verifyPassword } from '@/lib/accounts';

// 지금 로그인한 사람의 정보 (관리자 화면 메뉴에 이름·직급을 보여주는 데도 쓴다)
export async function GET() {
  const member = await getSessionMember();
  if (member) {
    const teams = await getTeams();
    return json({
      kind: 'member',
      member: toPublic(member),
      roleLabel: teamsLabel(teams, member),
      menus: effectiveMenus(memberRoles(member), member.menus, member.actions), // 지금 쓸 수 있는 메뉴
      menuOrder: await getMenuOrder(),
      myVehicles: (await getVehicles()).filter(v => v.driverId === member.id).length, // 배차된 차량 수
    });
  }
  if (await hasRootSession()) return json({ kind: 'root', name: '최고 관리자(내장)', roleLabel: '최고 관리자', menus: ['catalog', 'vehicles', 'equipment', 'suppliers', 'sites', 'placements', 'expenses', 'attendance', 'leave', 'requests', 'members', 'staff', 'payroll'], menuOrder: await getMenuOrder() });
  return json({ error: '로그인이 필요해요.' }, 401);
}

// 본인 정보 수정: 비밀번호 변경(화면 우측 상단 버튼). 이름·공정·아이디 변경은 화면에서 쓰지 않지만 API 는 남겨 둔다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const member = await getSessionMember();
  if (!member) {
    return (await hasRootSession())
      ? json({ error: '내장 최고 관리자 계정은 .env.local 에서 바꿔요.' }, 403)
      : json({ error: '로그인이 필요해요.' }, 401);
  }
  // 현재 비밀번호를 계속 틀려 보는 시도를 막는다
  if (limited(req, 'me', 20, 10 * 60 * 1000)) return json({ error: '시도가 너무 많아요. 잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as {
    action?: unknown; name?: unknown; trades?: unknown; loginId?: unknown; password?: unknown; current?: unknown; next?: unknown;
  } | null;
  if (!b) return json({ error: 'bad request' }, 400);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const actor = { kind: 'member' as const, member };

  if (b.action === 'password') {
    const r = await changeOwnPassword(member, str(b.current), str(b.next));
    if ('error' in r) return json({ error: r.error }, r.error.includes('현재 비밀번호가') ? 403 : 400);
    await createMemberSession(r.member); // 비밀번호가 바뀌면 이전 세션 값이 무효가 되므로 새로 발급
    return json({ ok: true, member: toPublic(r.member) });
  }

  if (b.action === 'loginId') {
    // 아이디를 바꿀 때도 현재 비밀번호를 한 번 더 확인한다 (임시 비밀번호 상태인 처음 로그인에서는 생략)
    if (!member.mustChangePassword && (!member.passHash || !(await verifyPassword(str(b.password), member.passHash)))) return json({ error: '현재 비밀번호가 맞지 않아요.' }, 403);
    const r = await updateMember(actor, member.id, { loginId: str(b.loginId) }, await getTrades());
    if ('error' in r) return json({ error: r.error }, r.error.includes('한 번만') ? 403 : 400);
    return json({ ok: true, member: r });
  }

  if (b.action === 'profile') {
    const patch: { name?: string; trades?: unknown } = {};
    if (b.name !== undefined) patch.name = str(b.name);
    if (b.trades !== undefined) patch.trades = b.trades;
    const r = await updateMember(actor, member.id, patch, await getTrades());
    if ('error' in r) return json({ error: r.error }, 400);
    return json({ ok: true, member: r });
  }

  return json({ error: 'bad action' }, 400);
}
