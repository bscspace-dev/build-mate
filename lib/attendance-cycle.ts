// 출근 조회 기준: "매달 며칠부터 며칠까지". 서버·브라우저 공용 순수 함수.
//  · 시작일 < 종료일 (예: 1일 ~ 31일)   → 한 달 안의 기간.
//  · 시작일 ≥ 종료일 (예: 21일 ~ 20일, 9일 ~ 9일) → 지난달 시작일부터 이번 달 종료일까지 (두 날짜 모두 포함). 종료가 있는 달의 기간이다. (9일 ~ 9일: 10/9 ~ 11/9)
//  · 31처럼 그 달에 없는 날짜는 그 달의 말일로 본다.
export type Cycle = { startDay: number; endDay: number };
export const DEFAULT_CYCLE: Cycle = { startDay: 1, endDay: 31 };

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); // m0 = 0~11
const day = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(Math.min(d, daysIn(y, m0)))}`;

export const validCycle = (c: unknown): c is Cycle => {
  const x = c as Cycle;
  return !!x && Number.isInteger(x.startDay) && Number.isInteger(x.endDay) && x.startDay >= 1 && x.startDay <= 31 && x.endDay >= 1 && x.endDay <= 31;
};

/** ym(YYYY-MM)분의 조회 기간 */
export function cyclePeriod(c: Cycle, ym: string): { from: string; to: string } {
  const y = Number(ym.slice(0, 4));
  const m0 = Number(ym.slice(5, 7)) - 1;
  const to = day(y, m0, c.endDay);
  if (c.startDay < c.endDay) return { from: day(y, m0, c.startDay), to };
  const prev = new Date(Date.UTC(y, m0 - 1, 1));
  return { from: day(prev.getUTCFullYear(), prev.getUTCMonth(), c.startDay), to };
}

/** 날짜가 속한 '분'(YYYY-MM): 예) 21일~20일 기준이면 11/21 은 12월분 */
export function cycleMonthOf(c: Cycle, date: string): string {
  const y = Number(date.slice(0, 4));
  const m0 = Number(date.slice(5, 7)) - 1;
  const d = Number(date.slice(8, 10));
  const t = c.startDay >= c.endDay && d >= Math.min(c.startDay, daysIn(y, m0)) && d > c.endDay ? new Date(Date.UTC(y, m0 + 1, 1)) : new Date(Date.UTC(y, m0, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export const shiftYm = (ym: string, n: number) => { const t = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };

const dayText = (d: number) => (d >= 31 ? '말일' : `${d}일`);
export function cycleText(c: Cycle): string {
  if (c.startDay < c.endDay) return `매월 ${dayText(c.startDay)} ~ ${dayText(c.endDay)}`;
  return `매월 ${dayText(c.startDay)} ~ 다음 달 ${dayText(c.endDay)}`;
}

// ───────── 기준 이력 ─────────
// 기준을 바꿔도 지난 달은 그때 기준 그대로 보이도록, 기준마다 '적용 시작 월(from, YYYY-MM)'을 같이 저장한다.
// 어떤 달분의 기간은 그 달 이전(같은 달 포함)에 시작된 기준 중 가장 최근 것으로 계산한다.
export type CycleEntry = Cycle & { from: string };
export const FIRST_FROM = '0000-01'; // 맨 처음 기준(예전부터 쓰던 기준)의 적용 시작 월
const isYm = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** 저장된 값을 기준 이력으로 읽는다. 예전 형식(기준 하나)은 처음부터 적용된 기준 하나로 본다. 비어 있으면 기본값. */
export function toEntries(raw: unknown): CycleEntry[] {
  const list = Array.isArray(raw) ? raw : validCycle(raw) ? [{ ...(raw as Cycle), from: FIRST_FROM }] : [];
  const out = list.filter((e): e is CycleEntry => validCycle(e) && (isYm((e as CycleEntry).from) || (e as CycleEntry).from === FIRST_FROM)).sort((a, b) => a.from.localeCompare(b.from));
  return out.length ? out : [{ ...DEFAULT_CYCLE, from: FIRST_FROM }];
}
export const validFrom = isYm;

/** ym 달분에 적용되는 기준 */
export function cycleFor(entries: CycleEntry[], ym: string): Cycle {
  let cur = entries[0];
  for (const e of entries) if (e.from <= ym) cur = e;
  return { startDay: cur.startDay, endDay: cur.endDay };
}
export const periodOf = (entries: CycleEntry[], ym: string) => cyclePeriod(cycleFor(entries, ym), ym);

/** 날짜가 속한 '분'(YYYY-MM): 앞뒤 달을 같이 따져 그 날짜가 기간 안에 드는 달을 고른다 */
export function monthOfDate(entries: CycleEntry[], date: string): string {
  const base = date.slice(0, 7);
  for (const ym of [shiftYm(base, 1), base, shiftYm(base, -1)]) {
    const p = periodOf(entries, ym);
    if (date >= p.from && date <= p.to) return ym;
  }
  return base;
}

/** 같은 적용 시작 월의 기준이 있으면 바꾸고, 없으면 추가한다 */
export const upsertEntry = (entries: CycleEntry[], e: CycleEntry): CycleEntry[] => toEntries([...entries.filter(x => x.from !== e.from), e]);
/** 적용 시작 월이 from 인 기준을 뺀다 (맨 처음 기준은 지울 수 없다) */
export const removeEntry = (entries: CycleEntry[], from: string): CycleEntry[] => (from === entries[0].from ? entries : entries.filter(x => x.from !== from));
