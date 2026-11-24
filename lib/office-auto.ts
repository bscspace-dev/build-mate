import 'server-only';
import { assignPlacements, getLeaves, getActiveMembers, getPlacements, getTeams } from './db';
import { leaveSlots } from './leave';
import { OFFICE_SITE_ID } from './office-site';
import { memberHasGroup } from './roles';
import { addDays } from './site-period';
import type { Slot } from './types';

const isSunday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay() === 0;

/** 사무실·현장 팀을 모두 가진 회원(겸직)인가 — 사무실 배치 대상 */
export const isDualMember = (teams: Parameters<typeof memberHasGroup>[0], m: Parameters<typeof memberHasGroup>[1]) => memberHasGroup(teams, m, 'office') && memberHasGroup(teams, m, 'field');

/**
 * 사무실·현장 팀을 모두 가진 인원이 그날 오전/오후에 어느 곳(현장·사무실)에도 배치되지 않았으면 자동으로 '사무실'에 배치한다.
 * 밤 12시(한국 시간 자정)가 지나 새 날이 되면 그날 비어 있는 겸직 인원이 사무실로 채워진다. 그 전에는 아직 짜는 중이라 내일 이후는 건드리지 않는다.
 * 화면을 못 열어 놓친 날을 메우려고 오늘 기준 이틀 전부터 오늘까지 채운다. 일요일과 승인된 휴가 시간대는 건너뛰고, 이미 있는 배치는 바꾸지 않는다.
 */
export async function ensureOfficeDefaults(today: string): Promise<number> {
  if (process.env.OFFICE_AUTO !== 'on') return 0; // 지금은 직접 배치한다 — 자동 배치는 꺼 둔다 (켜려면 OFFICE_AUTO=on)
  const from = addDays(today, -2);
  const to = today; // 자정이 지나 '오늘'이 된 날까지만 (내일 이후는 채우지 않는다)
  const [members, teams] = await Promise.all([getActiveMembers(), getTeams()]);
  const dual = members.filter(m => isDualMember(teams, m));
  if (!dual.length) return 0;
  let filled = 0;
  const [placements, leaves] = await Promise.all([getPlacements(from, to), getLeaves()]);
  const placed = new Set(placements.map(p => `${p.date}|${p.slot}|${p.memberId}`));
  const approved = leaves.filter(l => l.status === 'approved');
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (isSunday(d)) continue;
    // 시간대(오전/오후)별로 비어 있는 겸직 인원을 모아서 사무실로 한 번에 배치한다
    const bySlots = new Map<string, { slots: Slot[]; ids: string[] }>();
    for (const m of dual) {
      const missing = (['am', 'pm'] as const).filter(s => !placed.has(`${d}|${s}|${m.id}`) && !approved.some(l => l.memberId === m.id && d >= l.startDate && d <= l.endDate && leaveSlots(l.kind).includes(s)));
      if (!missing.length) continue;
      const key = missing.join(',');
      const g = bySlots.get(key) ?? { slots: [...missing], ids: [] };
      g.ids.push(m.id);
      bySlots.set(key, g);
    }
    for (const g of bySlots.values()) {
      await assignPlacements(d, OFFICE_SITE_ID, g.ids, g.slots);
      filled += g.ids.length * g.slots.length;
    }
  }
  return filled;
}
