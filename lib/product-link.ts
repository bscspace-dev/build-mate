import type { Product, ProductLink } from './types';

/** 공통 연결 복사본의 키: 원본키@연결id (재고·가격·링크는 원본 하나만 갖는다) */
export const copyKey = (l: ProductLink) => `${l.key}@${l.id}`;

/** 목록에서 보이는 한 줄: 원본 품목(p)이 어느 공정·카테고리에 놓여 있는지 (복사본이면 link) */
export type PlacedView = { p: Product; trade: string; category: string; link?: ProductLink };

/** 키(원본 또는 복사본)로 품목과 놓인 자리를 찾는다. 없으면 null */
export function viewOf(key: string, all: Product[], catT: Record<string, string>, links: ProductLink[]): PlacedView | null {
  const i = key.indexOf('@');
  if (i < 0) {
    const p = all.find(x => x.key === key);
    return p ? { p, trade: catT[p.category] ?? '', category: p.category } : null;
  }
  const link = links.find(l => l.id === key.slice(i + 1) && l.key === key.slice(0, i));
  const p = link ? all.find(x => x.key === link.key) : undefined;
  return link && p ? { p, trade: link.trade, category: link.category, link } : null;
}

/** 지금 쓸 수 있는 복사본: 원본이 있고(휴지통이 아니고), 원본과 같은 공정이 아닌 것 */
export function activeLinks(all: Product[], catT: Record<string, string>, links: ProductLink[]): { link: ProductLink; p: Product; from: string }[] {
  return links.flatMap(link => {
    const p = all.find(x => x.key === link.key);
    const from = p ? catT[p.category] ?? '' : '';
    return p && from !== link.trade ? [{ link, p, from }] : [];
  });
}
