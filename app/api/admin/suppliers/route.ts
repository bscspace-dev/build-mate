import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { getMember, getTeams, getTrades, patchMember, removeMember, setSupplierNote, getSupplierStars, setSupplierStars } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { addMember } from '@/lib/members';
import { sideOf, teamGroup, type Team } from '@/lib/roles';

// 거래처 관리: 등록(등록 권한) · 수정(수정 권한) · 삭제(삭제 권한). 거래처 쪽 회원만 다룬다.
// 로그인 아이디·비밀번호는 여기서 만들거나 바꾸지 않는다 (최고 관리자·개발팀의 회원 관리에서).
type Body = { action?: unknown; id?: unknown; name?: unknown; role?: unknown; handles?: unknown; phone?: unknown; address?: unknown; note?: unknown; ids?: unknown; on?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isCoopTeam = (teams: Team[], key: string) => { const g = teamGroup(teams, key); return g !== null && sideOf(g) === 'coop'; };

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('suppliers');
  if (!actor) return json({ error: '거래처 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'suppliers', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  if (b && a === 'star') {
    // 즐겨찾기(별표): 계정마다 따로 저장되어 나에게만 적용된다
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.filter((k): k is string => typeof k === 'string').map(k => clip(k, 64)))].slice(0, 500) : [];
    if (ids.length === 0) return json({ error: 'bad request' }, 400);
    const who = actor.kind === 'member' ? actor.member.id : 'root';
    const cur = new Set((await getSupplierStars())[who] ?? []);
    ids.forEach(k => { if (b.on !== false) cur.add(k); else cur.delete(k); });
    await setSupplierStars(who, [...cur].slice(-5000));
    return json({ ok: true });
  }
  const need = a === 'add' ? 'register' : a === 'update' ? 'edit' : a === 'delete' ? 'delete' : null;
  if (!b || !need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'suppliers', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  const teams = await getTeams();

  if (a === 'add') {
    const role = teams.find(t => isCoopTeam(teams, t.key))?.key; // 팀은 따로 고르지 않는다: 거래처 쪽 첫 팀으로 들어간다
    if (!role) return json({ error: '거래처 팀이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 400);
    const r = await addMember({ name: clip(b.name, 40), role, handles: b.handles, phone: b.phone, address: b.address, account: false }, await getTrades());
    if ('error' in r) return json({ error: r.error.startsWith('이미 등록된 이름') ? '같은 이름이 이미 있어서 등록하지 못했어요. 데이터베이스에서 같은 이름을 허용하도록 바꿔야 해요 (supabase/allow-supplier-duplicate-names.sql).' : r.error }, 400);
    const note = clip(b.note, 200);
    if (note) await setSupplierNote(r.member.id, note);
    return json({ ok: true });
  }

  // 수정·삭제: 대상이 거래처(거래처 쪽 팀) 회원일 때만 — 사내 회원은 이 화면에서 건드릴 수 없다
  const id = clip(b.id, 64);
  const target = id ? await getMember(id) : null;
  if (!target || !isCoopTeam(teams, target.role)) return json({ error: '없는 거래처예요.' }, 404);

  if (a === 'delete') {
    if (!(await removeMember(id))) return json({ error: '없는 거래처예요.' }, 404);
    await setSupplierNote(id, '').catch(() => {});
    return json({ ok: true });
  }

  const name = clip(b.name, 40);
  if (!name) return json({ error: '이름은 1~40자로 적어 주세요.' }, 400);
  const res = await patchMember(id, { name, handles: clip(b.handles, 100), phone: clip(b.phone, 30), address: clip(b.address, 200) }, true); // 거래처는 같은 이름 허용
  if ('conflict' in res) return json({ error: '같은 이름이 이미 있어서 저장하지 못했어요. 데이터베이스에서 같은 이름을 허용하도록 바꿔야 해요 (supabase/allow-supplier-duplicate-names.sql).' }, 400);
  if ('notFound' in res) return json({ error: '없는 거래처예요.' }, 404);
  if (b.note !== undefined) await setSupplierNote(id, clip(b.note, 200));
  return json({ ok: true });
}

export const POST = audited('suppliers', handlePOST);
