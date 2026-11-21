// 현장의 공사기간 표시 (서버·브라우저 어디서든 가져와 쓸 수 있는 순수 함수)
const DAY = 24 * 60 * 60 * 1000;
export const fmtDate = (d: string) => (d ? d.replaceAll('-', '.') : '');

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
/** 마감일 변경 한 번의 일수 (+ 연장, - 단축) */
export const extensionDays = (e: { from: string; to: string }) => dayDiff(e.from, e.to);
/** 지금까지의 연장 합계 일수 (처음 마감일 기준으로 며칠 연장됐는지) */
export const totalExtension = (list: { from: string; to: string }[]) => list.reduce((n, e) => n + extensionDays(e), 0);
/** 날짜(YYYY-MM-DD)에 일수를 더한 날짜 */
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = dayDiff;

export type PeriodInfo = { text: string; badge: { label: string; cls: string } | null; urgent: boolean };

/** 공사기간 문구와 상태 배지. 마감이 오늘~7일 안이면 urgent(붉은색). 날짜는 브라우저의 오늘 기준. */
export function sitePeriod(startDate: string, endDate: string): PeriodInfo {
  if (!startDate && !endDate) return { text: '공사기간 미정', badge: null, urgent: false };
  const text = `${fmtDate(startDate) || '?'} ~ ${fmtDate(endDate) || '?'}`;
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const left = endDate ? Math.round((Date.parse(endDate) - Date.parse(today)) / DAY) : null; // 마감까지 남은 날수 (오늘이면 0)
  if (left !== null && left >= 0 && left <= 7) return { text, badge: { label: left === 0 ? '오늘 마감' : `마감 D-${left}`, cls: 'bg-red-600 text-white' }, urgent: true };
  if (startDate && today < startDate) return { text, badge: { label: '착공 전', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' }, urgent: false };
  if (left !== null && left < 0) return { text, badge: { label: '공사 종료', cls: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300' }, urgent: false };
  return { text, badge: { label: '공사 중', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200' }, urgent: false };
}
