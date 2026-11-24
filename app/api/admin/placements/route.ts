import { getActor, placementsFull } from '@/lib/auth';
import { assignPlacements, copyPlacements, getLeaves, getActiveMembers, getPlacements, getSites, getTeams, removePlacement, removePlacementsRange, setPlacementNote } from '@/lib/db';
import { leaveSlots } from '@/lib/leave';
import { OFFICE_SITE_ID } from '@/lib/office-site';
import { json, limited, sameOrigin } from '@/lib/guard';
import { memberHasGroup } from '@/lib/roles';
import { isDualMember } from '@/lib/office-auto';
import { isSlot, SLOTS, type Slot } from '@/lib/types';

// 현장배치: 날짜별로 현장작업자를 현장에 배치한다. 배치·복사는 '등록' 권한, 빼기는 '삭제' 권한.
// 배치 대상은 현장 부서(현장작업자 정·부, 현장관리자 PM) 회원. 오전·오후·종일로 나눠 배치할 수 있고,
// 한 사람은 같은 날 같은 시간대에 한 현장만 — 다시 배치하면 옮겨진다.
type Body = { action?: unknown; date?: unknown; siteId?: unknown; memberIds?: unknown; memberId?: unknown; from?: unknown; to?: unknown; slot?: unknown; slots?: unknown; note?: unknown };
// slot: 'am' 오전 · 'pm' 오후 · 'ot' 야간(오후 5~8시, 0.5일) · 'nt' 심야(오후 8~10시, 1일) · 'all' 종일(오전+오후). 없으면 종일.
const slotsOf = (v: unknown): Slot[] | null => (v === undefined || v === 'all' ? [...SLOTS] : isSlot(v) ? [v] : null);
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const isSunday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() === 0; // 일요일은 쉬는 날이라 배치·작업 내용을 넣지 않는다
const REST = '일요일은 쉬는 날이라 배치할 수 없어요.';
// 승인된 휴가 중인 회원 (그 날짜·시간대를 휴가가 가리는 경우)
const onLeaveAt = async (date: string, slots: Slot[]) => new Set((await getLeaves()).filter(l => l.status === 'approved' && date >= l.startDate && date <= l.endDate && slots.some(s => leaveSlots(l.kind).includes(s))).map(l => l.memberId));

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('placements');
  if (!actor) return json({ error: '현장배치 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'placements', 300, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  const need = a === 'assign' || a === 'copy' || a === 'note' || a === 'extra' ? 'register' : a === 'remove' ? 'delete' : null;
  if (!b || !need) return json({ error: 'bad request' }, 400);
  if (!placementsFull(actor)) return json({ error: '이 작업을 할 권한이 없어요. (현장배치 모든 권한이 필요해요) 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  if (a === 'remove') {
    // 빼기는 시간대를 여러 개 한 번에 줄 수 있다 (slots: ['am','ot'] 처럼). 없으면 slot 하나.
    const slots = Array.isArray(b.slots) ? [...new Set(b.slots.filter(isSlot))] : slotsOf(b.slot);
    if (!isDate(b.date) || typeof b.memberId !== 'string' || !slots || slots.length === 0) return json({ error: 'bad request' }, 400);
    return (await removePlacement(b.date, b.memberId, slots)) ? json({ ok: true }) : json({ error: '이미 빠졌거나 없는 배치예요.' }, 404);
  }

  if (a === 'note') {
    // 그날 이 현장의 작업 내용 메모 (비우면 지운다)
    const note = typeof b.note === 'string' ? b.note.trim().replace(/[ \t]+/g, ' ').slice(0, 200) : '';
    if (!isDate(b.date) || typeof b.siteId !== 'string' || !(b.siteId === OFFICE_SITE_ID || (await getSites()).some(s => s.id === b.siteId))) return json({ error: '현장을 확인해 주세요.' }, 400);
    if (isSunday(b.date)) return json({ error: REST }, 400);
    await setPlacementNote(b.date, b.siteId, note);
    return json({ ok: true });
  }

  // 배치할 수 있는 회원(현장 부서)과 현장
  const [members, teams, sites] = await Promise.all([getActiveMembers(), getTeams(), getSites()]);
  const fieldIds = members.filter(m => memberHasGroup(teams, m, 'field')).map(m => m.id);
  const siteIds = [OFFICE_SITE_ID, ...sites.map(s => s.id)]; // 사무실은 고정 항목

  if (a === 'extra') {
    // 야간·심야 전원 체크: 그날 이 현장에 오후(종일 포함)로 배치된 모든 인원에게 야간(또는 심야)을 한 번에 넣는다. 오전만 한 사람은 제외.
    // 이미 전원에게 들어 있으면 전원 해제한다 (해제는 '삭제' 권한). 야간과 심야는 하루에 하나만이라 심야를 넣으면 야간은 빠진다.
    if (!isDate(b.date) || typeof b.siteId !== 'string' || !siteIds.includes(b.siteId) || (b.slot !== 'ot' && b.slot !== 'nt')) return json({ error: 'bad request' }, 400);
    if (isSunday(b.date)) return json({ error: REST }, 400);
    const day = await getPlacements(b.date, b.date);
    const leaveSet = await onLeaveAt(b.date, [b.slot]);
    const crew = [...new Set(day.filter(p => p.siteId === b.siteId && p.slot === 'pm' && fieldIds.includes(p.memberId) && !leaveSet.has(p.memberId)).map(p => p.memberId))]; // 오후 근무자만 (휴가 중인 사람 제외)
    if (!crew.length) return json({ error: '이 현장에 오후(종일 포함)로 배치된 인원이 없어요. 오전만 한 사람은 야간·심야에서 제외돼요.' }, 400);
    const have = new Set(day.filter(p => p.siteId === b.siteId && p.slot === b.slot).map(p => p.memberId));
    if (crew.every(id => have.has(id))) {
      if (!placementsFull(actor)) return json({ error: '체크를 해제할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
      for (const id of crew) await removePlacement(b.date, id, [b.slot]);
      return json({ ok: true, count: crew.length, on: false });
    }
    await assignPlacements(b.date, b.siteId, crew, [b.slot]);
    return json({ ok: true, count: crew.length, on: true });
  }

  if (a === 'copy') {
    if (!isDate(b.from) || !isDate(b.to) || b.from === b.to) return json({ error: '복사할 날짜를 확인해 주세요.' }, 400);
    if (isSunday(b.to)) return json({ ok: true, count: 0 }); // 쉬는 날로는 복사하지 않는다
    const n = await copyPlacements(b.from, b.to, { sites: siteIds, members: fieldIds });
    // 그날 승인된 휴가가 있는 사람은 복사된 배치를 다시 뺀다
    const toDate: string = b.to;
    for (const l of (await getLeaves()).filter(x => x.status === 'approved' && toDate >= x.startDate && toDate <= x.endDate)) await removePlacementsRange(l.memberId, toDate, toDate, leaveSlots(l.kind));
    return json({ ok: true, count: n });
  }

  if (!isDate(b.date) || typeof b.siteId !== 'string' || !siteIds.includes(b.siteId)) return json({ error: '현장을 골라 주세요.' }, 400);
  if (isSunday(b.date)) return json({ error: REST }, 400);
  const ids = Array.isArray(b.memberIds) ? [...new Set(b.memberIds.filter((x): x is string => typeof x === 'string'))] : [];
  if (!ids.length || ids.length > 200) return json({ error: '배치할 인원을 골라 주세요.' }, 400);
  if (!ids.every(id => fieldIds.includes(id))) return json({ error: '현장 부서(현장작업자·현장관리자) 회원만 배치할 수 있어요.' }, 400);
  const slots = slotsOf(b.slot);
  if (!slots) return json({ error: '시간대를 골라 주세요.' }, 400);
  // 사무실에는 사무실·현장 팀을 모두 가진 인원(겸직)만 배치할 수 있다
  if (b.siteId === OFFICE_SITE_ID && !ids.every(id => { const m = members.find(x => x.id === id); return !!m && isDualMember(teams, m); })) return json({ error: '사무실에는 사무실·현장 팀을 모두 가진 인원만 배치할 수 있어요.' }, 400);
  const leaveSet = await onLeaveAt(b.date, slots);
  const blocked = ids.filter(id => leaveSet.has(id));
  if (blocked.length) {
    const nm = new Map(members.map(m => [m.id, m.name]));
    return json({ error: `${blocked.map(id => nm.get(id) ?? '?').join(', ')}님은 그날 승인된 휴가예요. 선택에서 빼 주세요.` }, 400);
  }
  return json({ ok: true, count: await assignPlacements(b.date, b.siteId, ids, slots) });
}
