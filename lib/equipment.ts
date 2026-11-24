// 장비정보의 최저가 계산 (서버·브라우저 공용)
import type { Equipment, EquipmentHistory } from './types';

export type Lowest = { price: number; mall: string; url: string; source: 'manual' | 'naver' };

/** 직접 등록한 가격과 네이버 최저가 중 가장 싼 값 */
export function lowestOf(e: Pick<Equipment, 'offers' | 'naver'>): Lowest | null {
  const list: Lowest[] = [
    ...e.offers.filter(o => o.price > 0).map(o => ({ price: o.price, mall: o.mall, url: o.url, source: 'manual' as const })),
    ...(e.naver && e.naver.price > 0 ? [{ price: e.naver.price, mall: e.naver.mall, url: e.naver.url, source: 'naver' as const }] : []),
  ];
  return list.sort((a, b) => a.price - b.price)[0] ?? null;
}

/** 최저가가 바뀌었으면 기록에 한 줄 더한다 (최근 60번까지) */
export function settleHistory(e: Pick<Equipment, 'offers' | 'naver' | 'history'>, now: string): EquipmentHistory[] {
  const low = lowestOf(e);
  if (!low) return e.history;
  const last = e.history[e.history.length - 1];
  if (last && last.price === low.price) return e.history;
  return [...e.history, { at: now, price: low.price, mall: low.mall }].slice(-60);
}

/** 직전 최저가와 비교한 변동 (없으면 null) */
export function priceChange(e: Pick<Equipment, 'history'>): { prev: number; diff: number } | null {
  const h = e.history;
  if (h.length < 2) return null;
  const prev = h[h.length - 2].price;
  const diff = h[h.length - 1].price - prev;
  return diff === 0 ? null : { prev, diff };
}
