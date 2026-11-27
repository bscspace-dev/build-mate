import 'server-only';
import { getTeams, getTrades } from './db';
import { actorCan } from './auth';
import { isStaffAdmin, memberRoles } from './roles';
import type { Actor } from './member-utils';

/**
 * 장비조사에서 이 사람이 볼 수 있는 공정(대분류).
 *  · 최고 관리자·개발팀, 그리고 장비조사 '모든 권한(조사 제외 설정)'을 부여받은 회원: 모든 공정 + 조사 제외 설정
 *  · 그 밖: 속한 팀이 맡은 공정 = 팀 관리에서 정한 '관여 공정'의 합 (예: 구조팀 → 구조)
 */
export async function inventoryTrades(actor: Actor): Promise<{ admin: boolean; trades: string[] }> {
  const all = await getTrades();
  if (actor.kind === 'root' || isStaffAdmin(memberRoles(actor.member)) || actorCan(actor, 'inventory', 'edit')) return { admin: true, trades: all };
  const teams = await getTeams();
  const mine = new Set(memberRoles(actor.member).flatMap(r => teams.find(t => t.key === r)?.trades ?? []));
  return { admin: false, trades: all.filter(t => mine.has(t)) };
}
