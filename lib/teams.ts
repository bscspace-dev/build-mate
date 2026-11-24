import 'server-only';
import crypto from 'node:crypto';
import { getTeams, getTrades, insertTeam, removeTeam, updateTeamTrades } from './db';
import { isFieldRole, isGroup, type Team } from './roles';

// 팀명 규칙 (구조: 구분(사내/협력) → 부서(사무실/현장/외주) → 팀명)
//  · 구분·부서는 고정이라 수정할 수 없다. 팀명만 추가·삭제한다. 팀 이름을 바꾸는 기능은 없다.
//  · 추가·삭제는 최고 관리자·개발팀만 (호출하는 쪽에서 권한을 확인한다).
//  · 기본 동작이 걸린 팀(최고 관리자·개발팀·현장작업자·현장관리자(PM))은 삭제할 수 없다.
//  · 소속 회원이 있는 팀은 삭제할 수 없다 — 다른 팀으로 옮긴 뒤 지운다.
//  · 새로 만든 팀은 기본 메뉴가 없다(내 정보만). 필요하면 회원별로 메뉴·동작 권한을 부여한다.

export type Err = { error: string };

const squash = (s: string) => s.trim().replace(/\s+/g, ' ');

export async function addTeam(input: { label: string; group: unknown }): Promise<{ team: Team } | Err> {
  const label = squash(input.label);
  if (!label || label.length > 20) return { error: '팀 이름은 1~20자로 적어 주세요.' };
  if (!isGroup(input.group)) return { error: '사무실·현장·외주 중에서 골라 주세요.' };
  const team: Team = { key: 't_' + crypto.randomBytes(4).toString('hex'), label, group: input.group, locked: false };
  const r = await insertTeam(team);
  return 'conflict' in r ? { error: '이미 있는 팀 이름이에요.' } : { team: r.team };
}

/** 현장 팀이 관여하는 공정 정하기 (직접 만든 현장 팀만, 등록된 공정 중에서). */
export async function setTeamTrades(key: string, raw: unknown): Promise<{ team: Team } | Err> {
  const team = (await getTeams()).find(t => t.key === key);
  if (!team) return { error: '팀을 찾을 수 없어요.' };
  if (team.group !== 'field' || isFieldRole(key)) return { error: '직접 만든 현장 팀만 공정을 정할 수 있어요.' };
  const allowed = await getTrades();
  const trades = Array.isArray(raw) ? [...new Set(raw.filter((t): t is string => typeof t === 'string'))] : [];
  if (!trades.every(t => allowed.includes(t))) return { error: '목록에 없는 공정이에요.' };
  const saved = await updateTeamTrades(key, trades);
  return saved ? { team: saved } : { error: '팀을 찾을 수 없어요.' };
}

export async function deleteTeam(key: string): Promise<{ ok: true } | Err> {
  if (isFieldRole(key)) {
    // 현장팀: 사수·부사수·PM 내부 팀을 함께 지운다 (하나라도 쓰는 회원이 있으면 아무것도 지우지 않는다)
    const keys = (await getTeams()).filter(t => isFieldRole(t.key)).map(t => t.key);
    for (const k of keys) {
      const r = await removeTeam(k);
      if ('inUse' in r) return { error: `현장팀에 회원이 ${r.inUse}명 있어요. 다른 팀으로 옮긴 뒤 지워 주세요.` };
    }
    return { ok: true };
  }
  const team = (await getTeams()).find(t => t.key === key);
  if (!team) return { error: '팀을 찾을 수 없어요.' };
  if (team.locked) return { error: `“${team.label}”은 기본 동작이 걸린 팀이라 지울 수 없어요.` };
  const r = await removeTeam(key);
  if ('inUse' in r) return { error: `이 팀에 회원이 ${r.inUse}명 있어요. 다른 팀으로 옮긴 뒤 지워 주세요.` };
  if ('notFound' in r) return { error: '팀을 찾을 수 없어요.' };
  return { ok: true };
}
