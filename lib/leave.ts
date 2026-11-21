// 휴가 계산·표시 도우미 (서버·브라우저 공용 순수 함수)
import type { LeaveKind, LeaveStatus, Slot } from './types';

export const LEAVE_KINDS: { v: LeaveKind; label: string }[] = [{ v: 'full', label: '종일' }, { v: 'am', label: '오전 반차' }, { v: 'pm', label: '오후 반차' }];
export const leaveKindLabel = (k: LeaveKind) => LEAVE_KINDS.find(x => x.v === k)?.label ?? k;
export const leaveStatusLabel = (s: LeaveStatus) => ({ pending: '승인 대기', approved: '승인', rejected: '반려' })[s];
export const isLeaveKind = (v: unknown): v is LeaveKind => v === 'full' || v === 'am' || v === 'pm';

const DAY = 24 * 60 * 60 * 1000;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
const isSunday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() === 0;

/** 휴가가 가리는 시간대: 종일이면 하루 전체(오전·오후·야간·심야), 반차면 그 반나절 */
export const leaveSlots = (k: LeaveKind): Slot[] => (k === 'full' ? ['am', 'pm', 'ot', 'nt'] : [k]);

/** 휴가 기간의 근무일(일요일 제외) 목록 */
export const leaveDates = (l: { startDate: string; endDate: string }): string[] => {
  const out: string[] = [];
  for (let d = l.startDate; d <= l.endDate && out.length < 400; d = addDays(d, 1)) if (!isSunday(d)) out.push(d);
  return out;
};
/** 휴가 일수: 근무일 × (종일 1, 반차 0.5) */
export const leaveDays = (l: { startDate: string; endDate: string; kind: LeaveKind }) => leaveDates(l).length * (l.kind === 'full' ? 1 : 0.5);
/** 이 날짜·시간대(오전/오후)에 이 회원이 승인된 휴가인가 */
export const onLeave = (leaves: { memberId: string; startDate: string; endDate: string; kind: LeaveKind }[], memberId: string, date: string, slot: 'am' | 'pm'): boolean =>
  leaves.some(l => l.memberId === memberId && date >= l.startDate && date <= l.endDate && (l.kind === 'full' || l.kind === slot));

/** 이 휴가 중 year 해에 속한 일수 (근무일 × 종일 1·반차 0.5) — 해가 바뀌는 휴가도 해마다 나눠 센다 */
export const leaveDaysInYear = (l: { startDate: string; endDate: string; kind: LeaveKind }, year: number) =>
  leaveDates(l).filter(d => d.startsWith(String(year))).length * (l.kind === 'full' ? 1 : 0.5);

/** 회원이 year 해에 쓴 연차(승인) / 대기 중인 연차 */
export function leaveUsage(leaves: { memberId: string; startDate: string; endDate: string; kind: LeaveKind; status: LeaveStatus }[], memberId: string, year: number) {
  let used = 0;
  let pending = 0;
  for (const l of leaves) {
    if (l.memberId !== memberId) continue;
    if (l.status === 'approved') used += leaveDaysInYear(l, year);
    else if (l.status === 'pending') pending += leaveDaysInYear(l, year);
  }
  return { used, pending };
}
export type AnnualLeave = Record<string, Record<string, number>>; // { 연도: { 회원 id: 연차 총 일수 } }
