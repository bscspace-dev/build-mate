import { actorCan, getActor } from '@/lib/auth';
import { getMember, getTeams, getTrades, patchMember, removeMember } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { addMember } from '@/lib/members';
import { sideOf, teamGroup, type Team } from '@/lib/roles';

// 거래처 관리: 등록(등록 권한) · 수정(수정 권한) · 삭제(삭제 권한). 거래처 쪽 회원만 다룬다.
// 로그인 아이디·비밀번호는 여기서 만들거나 바꾸지 않는다 (최고 관리자·개발팀의 회원 관리에서).
type Body = { action?: unknown; id?: unknown; name?: unknown; role?: unknown; handles?: unknown; phone?: unknown; address?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isCoopTeam = (teams: Team[], key: string) => { const g = teamGroup(teams, key); return g !== null && sideOf(g) === 'coop'; };

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('suppliers');
  if (!actor) return json({ error: '거래처 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'suppliers', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  const need = a === 'add' ? 'register' : a === 'update' ? 'edit' : a === 'delete' ? 'delete' : null;
  if (!b || !need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'suppliers', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  const teams = await getTeams();

  if (a === 'add') {
    const role = teams.find(t => isCoopTeam(teams, t.key))?.key; // 팀은 따로 고르지 않는다: 거래처 쪽 첫 팀으로 들어간다
    if (!role) return json({ error: '거래처 팀이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 400);
    const r = await addMember({ name: clip(b.name, 40), role, handles: b.handles, phone: b.phone, address: b.address, account: false }, await getTrades());
    return 'error' in r ? json({ error: r.error }, 400) : json({ ok: true });
  }

  // 수정·삭제: 대상이 거래처(거래처 쪽 팀) 회원일 때만 — 사내 회원은 이 화면에서 건드릴 수 없다
  const id = clip(b.id, 64);
  const target = id ? await getMember(id) : null;
  if (!target || !isCoopTeam(teams, target.role)) return json({ error: '없는 거래처예요.' }, 404);

  if (a === 'delete') {
    return (await removeMember(id)) ? json({ ok: true }) : json({ error: '없는 거래처예요.' }, 404);
  }

  const name = clip(b.name, 40);
  if (!name) return json({ error: '이름은 1~40자로 적어 주세요.' }, 400);
  const res = await patchMember(id, { name, handles: clip(b.handles, 100), phone: clip(b.phone, 30), address: clip(b.address, 200) });
  if ('conflict' in res) return json({ error: '이미 등록된 이름이에요. 구분되게 적어 주세요 (예: 가나다 철물2).' }, 400);
  if ('notFound' in res) return json({ error: '없는 거래처예요.' }, 404);
  return json({ ok: true });
}
