import type { Member, PublicMember } from './types';
// (이 파일은 서버·브라우저 어디서 가져와도 되는 순수 도우미만 둔다)

/** 브라우저로 보내도 되는 형태로 변환 — 비밀번호 해시는 제외한다. */
export const toPublic = (m: Member): PublicMember => ({
  id: m.id, name: m.name, role: m.role, extraRole: m.extraRole, payType: m.payType, trades: m.trades, categories: m.categories, handles: m.handles, phone: m.phone, address: m.address, addressDetail: m.addressDetail, position: m.position, hireDate: m.hireDate, payAmount: m.payAmount, payHistory: m.payHistory, bank: m.bank, accountNo: m.accountNo, accountHolder: m.accountHolder, safetyDate: m.safetyDate, license: m.license, resignDate: m.resignDate, history: m.history, photo: m.photo, bankbook: m.bankbook, fieldRoles: m.fieldRoles, officeStatus: m.officeStatus, menus: m.menus, actions: m.actions, createdAt: m.createdAt,
  loginId: m.loginId ?? null, mustChangePassword: m.mustChangePassword, idChanged: m.idChanged,
});

/** 그 날짜(YYYY-MM-DD)에 적용되는 급여 금액: 이력이 있으면 그날 이전에 시작된 가장 최근 금액, 없으면 지금 금액 */
export function payOn(m: { payAmount: number; payHistory?: { from: string; amount: number }[] }, date: string): number {
  const h = m.payHistory ?? [];
  if (h.length === 0) return m.payAmount ?? 0;
  let amt = 0;
  for (const e of h) if (e.from <= date) amt = e.amount; // h 는 적용 시작일 오름차순
  return amt;
}

/**
 * 사무직(4대보험) 월급의 세후 금액 계산. 근로자 부담분만 뺀다 (소득세·지방소득세는 넣지 않았다).
 *  · 국민연금 4.75% · 건강보험 3.595% · 장기요양보험 = 건강보험료의 13.14% · 고용보험 0.9%
 *  · 각 보험료는 10원 미만을 버린다.
 */
export function netPay(gross: number): { pension: number; health: number; care: number; employ: number; total: number; net: number } {
  const cut = (x: number) => Math.floor(x / 10) * 10;
  const pension = cut(gross * 0.0475);
  const health = cut(gross * 0.03595);
  const care = cut(health * 0.1314);
  const employ = cut(gross * 0.009);
  const total = pension + health + care + employ;
  return { pension, health, care, employ, total, net: gross - total };
}

/** 전화번호 입력을 하이픈이 들어간 모양으로 바꾼다: 010-1234-5678 · 02-123-4567 · 031-123-4567 · 1588-1234 */
export function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.startsWith('02')) {
    const x = d.slice(0, 10);
    return x.length <= 2 ? x : x.length <= 6 ? `02-${x.slice(2)}` : `02-${x.slice(2, x.length - 4)}-${x.slice(-4)}`;
  }
  if (/^1[5-8]/.test(d)) {
    const x = d.slice(0, 8); // 대표번호 (1588-1234)
    return x.length <= 4 ? x : `${x.slice(0, 4)}-${x.slice(4)}`;
  }
  const x = d.slice(0, 11);
  return x.length <= 3 ? x : x.length <= 7 ? `${x.slice(0, 3)}-${x.slice(3)}` : `${x.slice(0, 3)}-${x.slice(3, x.length - 4)}-${x.slice(-4)}`;
}

export type Credentials ={ loginId: string; password: string };

/** 요청한 사람. root = .env.local 의 내장 최고 관리자 */
export type Actor = { kind: 'root' } | { kind: 'member'; member: Member };
