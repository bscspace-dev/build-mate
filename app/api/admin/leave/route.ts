import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { addLeave, cancelLeave, decideLeave, getAnnualLeave, getLeaves, getActiveMembers, getTeams, removePlacementsRange, setAnnualLeave } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { isLeaveKind, leaveDates, leaveDaysInYear, leaveSlots, leaveUsage } from '@/lib/leave';
import { isOfficePay } from '@/lib/roles';

// 휴가신청: 신청·취소는 본인('휴가 신청' 권한), 승인·반려는 '승인·반려'(수정) 권한.
// 승인하면 그 기간(일요일 제외)의 해당 시간대 배치가 빠지고, 현장배치·출근관리에 휴가로 표시된다.
type Body = { action?: unknown; memberId?: unknown; year?: unknown; days?: unknown; id?: unknown; startDate?: unknown; endDate?: unknown; kind?: unknown; reason?: unknown; note?: unknown };
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/[ \t]+/g, ' ').slice(0, max) : '');
const MAX_DAYS = 60; // 한 번에 신청할 수 있는 휴가 기간

// 사무(사무실 부서) 회원의 휴가는 연차에서 차감된다. 현장 회원은 연차가 없고 휴가 일수만 출근에서 빠진다.
// 연차 총 일수가 정해져 있는 사무 회원은 (승인 + 대기) 일수가 총량을 넘으면 신청할 수 없다.
async function officeShortage(memberId: string, req: { startDate: string; endDate: string; kind: 'full' | 'am' | 'pm' }, includePending: boolean): Promise<string | null> {
  const [members, teams, annual, leaves] = await Promise.all([getActiveMembers(), getTeams(), getAnnualLeave(), getLeaves()]);
  const m = members.find(x => x.id === memberId);
  if (!m || !isOfficePay(teams, m)) return null; // 4대보험 사무직 기준이 아니면(일수제) 연차 차감 없음
  for (const year of new Set(leaveDates(req).map(d => Number(d.slice(0, 4))))) {
    const total = annual[String(year)]?.[memberId];
    if (total === undefined) continue; // 연차 총량이 아직 정해지지 않았으면 막지 않는다
    const { used, pending } = leaveUsage(leaves.filter(l => l.status !== 'pending' || includePending), memberId, year);
    const need = leaveDaysInYear(req, year);
    const remain = total - used - (includePending ? pending : 0);
    if (need > remain) return `${year}년 연차가 부족해요. (총 ${total}일 · 사용 ${used}일${includePending && pending ? ` · 대기 ${pending}일` : ''} → 잔여 ${remain}일, 신청 ${need}일)`;
  }
  return null;
}

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('leave');
  if (!actor) return json({ error: '휴가신청 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'leave', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  if (!b || (a !== 'apply' && a !== 'cancel' && a !== 'approve' && a !== 'reject' && a !== 'allowance')) return json({ error: 'bad request' }, 400);

  if (a === 'allowance') {
    // 사무 회원의 그 해 연차 총 일수 부여 — '승인·반려'(수정) 권한. days 가 비어 있으면 미설정으로 되돌린다.
    if (!actorCan(actor, 'leave', 'edit')) return json({ error: '연차를 부여할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
    const year = typeof b.year === 'number' && Number.isInteger(b.year) && b.year >= 2000 && b.year <= 2100 ? b.year : NaN;
    const days = b.days === null ? null : typeof b.days === 'number' && b.days >= 0 && b.days <= 60 && Number.isInteger(b.days * 2) ? b.days : NaN;
    if (Number.isNaN(year) || (days !== null && Number.isNaN(days)) || typeof b.memberId !== 'string') return json({ error: '연도와 연차 일수(0~60, 0.5 단위)를 확인해 주세요.' }, 400);
    const [members, teams] = await Promise.all([getActiveMembers(), getTeams()]);
    const m = members.find(x => x.id === b.memberId);
    if (!m || !isOfficePay(teams, m)) return json({ error: '연차는 급여 기준이 4대보험 사무직인 회원에게만 부여해요.' }, 400);
    await setAnnualLeave(year, b.memberId, days);
    return json({ ok: true });
  }

  if (a === 'apply' || a === 'cancel') {
    if (actor.kind !== 'member') return json({ error: '휴가는 회원 계정으로만 신청할 수 있어요.' }, 403);
    if (!actorCan(actor, 'leave', 'register')) return json({ error: '휴가를 신청할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
    if (a === 'cancel') {
      return typeof b.id === 'string' && (await cancelLeave(b.id, actor.member.id)) ? json({ ok: true }) : json({ error: '취소할 수 없는 신청이에요. (이미 처리됐거나 내 신청이 아니에요)' }, 400);
    }
    const reason = clip(b.reason, 300);
    if (!isDate(b.startDate) || !isDate(b.endDate) || !isLeaveKind(b.kind)) return json({ error: '휴가 기간과 구분을 확인해 주세요.' }, 400);
    if (b.endDate < b.startDate) return json({ error: '종료일이 시작일보다 빠를 수 없어요.' }, 400);
    if (b.kind !== 'full' && b.endDate !== b.startDate) return json({ error: '반차는 하루만 신청할 수 있어요.' }, 400);
    const dates = leaveDates({ startDate: b.startDate, endDate: b.endDate });
    if (dates.length === 0) return json({ error: '일요일은 쉬는 날이라 휴가로 신청하지 않아요.' }, 400);
    if (dates.length > MAX_DAYS) return json({ error: `한 번에 ${MAX_DAYS}일까지만 신청할 수 있어요.` }, 400);
    if (!reason) return json({ error: '사유를 적어 주세요.' }, 400);
    // 이미 내 신청(대기·승인)으로 같은 날이 잡혀 있으면 겹쳐 신청할 수 없다
    const { startDate: sd, endDate: ed, kind: kd } = { startDate: b.startDate, endDate: b.endDate, kind: b.kind }; // 좁혀진 타입을 콜백 안에서도 쓰려고 복사
    const dup = (await getLeaves()).find(l => l.memberId === actor.member.id && l.status !== 'rejected' && l.startDate <= ed && l.endDate >= sd && (l.kind === 'full' || kd === 'full' || l.kind === kd));
    if (dup) return json({ error: '이미 신청했거나 승인된 휴가와 날짜가 겹쳐요.' }, 400);
    const short = await officeShortage(actor.member.id, { startDate: b.startDate, endDate: b.endDate, kind: b.kind }, true);
    if (short) return json({ error: short }, 400);
    const row = await addLeave({ memberId: actor.member.id, startDate: b.startDate, endDate: b.endDate, kind: b.kind, reason });
    return json({ ok: true, id: row.id });
  }

  // 승인·반려
  if (!actorCan(actor, 'leave', 'edit')) return json({ error: '휴가를 승인할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (typeof b.id !== 'string') return json({ error: 'bad id' }, 400);
  const note = clip(b.note, 200);
  if (a === 'reject' && !note) return json({ error: '반려 사유를 적어 주세요.' }, 400);
  const by = actor.kind === 'member' ? actor.member.name : '최고 관리자';
  if (a === 'approve') {
    // 사무 회원은 승인하면 연차에서 빠지므로, 대기 중인 이 신청을 뺀 나머지 기준으로 연차가 모자라면 승인할 수 없다
    const target = (await getLeaves()).find(l => l.id === b.id);
    if (target && target.status === 'pending') {
      const short = await officeShortage(target.memberId, target, false);
      if (short) return json({ error: short + ' 연차를 먼저 조정해 주세요.' }, 400);
    }
  }
  const done = await decideLeave(b.id, a === 'approve' ? 'approved' : 'rejected', by, note);
  if (!done) return json({ error: '이미 처리됐거나 없는 신청이에요.' }, 404);
  let removed = 0;
  if (a === 'approve') removed = await removePlacementsRange(done.memberId, done.startDate, done.endDate, leaveSlots(done.kind)); // 휴가 처리: 그 기간 배치를 뺀다
  return json({ ok: true, removed });
}

export const POST = audited('leave', handlePOST);
