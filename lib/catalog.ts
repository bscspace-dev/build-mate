import type { Product } from './types';

// 설문 화면으로 보낼 때 크기를 줄이기 위한 압축 형태
export type SurveyItem = {
  k: string; // key
  n: string; // name
  c: string; // category
  s: string; // sub
  b: string; // brand
  i: string; // image
  q: number; // 남은 재고 수량 (요청할 수 있는 최대 수량)
  t: number; // 공정 비트마스크 (trades 배열의 i번째 공정이면 1<<i)
};

export function toSurveyItems(products: Product[], trades: string[]): SurveyItem[] {
  return products.map(p => ({
    k: p.key,
    n: p.name,
    c: p.category,
    s: p.sub,
    b: p.brand,
    i: p.image,
    q: p.stock ?? 0,
    t: p.trades.reduce((m, t) => {
      const i = trades.indexOf(t);
      return i >= 0 ? m | (1 << i) : m;
    }, 0),
  }));
}
