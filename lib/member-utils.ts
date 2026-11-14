import type { Member, PublicMember } from './types';
// (이 파일은 서버·브라우저 어디서 가져와도 되는 순수 도우미만 둔다)

/** 브라우저로 보내도 되는 형태로 변환 — 비밀번호 해시는 제외한다. */
export const toPublic = (m: Member): PublicMember => ({
  id: m.id, name: m.name, role: m.role, trades: m.trades, menus: m.menus, actions: m.actions, createdAt: m.createdAt,
  loginId: m.loginId ?? null, mustChangePassword: m.mustChangePassword, idChanged: m.idChanged,
});

export type Credentials = { loginId: string; password: string };

/** 요청한 사람. root = .env.local 의 내장 최고 관리자 */
export type Actor = { kind: 'root' } | { kind: 'member'; member: Member };
