import 'server-only';

// 네이버 쇼핑 검색(공식 API)으로 모델명의 최저가를 찾는다.
//  · NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 .env.local 에 있어야 한다 (네이버 개발자센터 > 애플리케이션 등록 > 검색).
//  · 모델명이 제목에 들어 있는 상품만 보고, 중고·렌탈과 터무니없이 싼 부품(중간 가격의 35% 미만)은 뺀다.
export type NaverResult = { price: number; mall: string; url: string; title: string };

export const naverReady = () => !!process.env.NAVER_CLIENT_ID && !!process.env.NAVER_CLIENT_SECRET;
const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
const strip = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&quot;|&amp;|&lt;|&gt;|&#39;/g, ' ').trim();

export async function naverLowest(query: string, model: string): Promise<{ ok: true; result: NaverResult } | { ok: false; reason: 'nokey' | 'none' | 'error' }> {
  if (!naverReady()) return { ok: false, reason: 'nokey' };
  const url = 'https://openapi.naver.com/v1/search/shop.json?display=30&sort=asc&query=' + encodeURIComponent(query);
  let items: { title: string; link: string; lprice: string; mallName: string }[] = [];
  try {
    const r = await fetch(url, { headers: { 'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!, 'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET! }, cache: 'no-store' });
    if (!r.ok) return { ok: false, reason: 'error' };
    items = ((await r.json()) as { items?: typeof items }).items ?? [];
  } catch {
    return { ok: false, reason: 'error' };
  }
  const need = norm(model);
  let rows = items
    .map(i => ({ title: strip(i.title), url: i.link, price: Number(i.lprice), mall: i.mallName || '' }))
    .filter(i => i.price > 0 && !/중고|렌탈|대여|리퍼|전시상품/.test(i.title) && (!need || norm(i.title).includes(need)));
  if (rows.length === 0) return { ok: false, reason: 'none' };
  const sorted = [...rows].sort((a, b) => a.price - b.price);
  const median = sorted[Math.floor(sorted.length / 2)].price;
  rows = sorted.filter(i => i.price >= median * 0.35); // 부품·액세서리처럼 너무 싼 상품은 뺀다
  const best = rows[0] ?? sorted[0];
  return { ok: true, result: { price: best.price, mall: best.mall, url: best.url, title: best.title } };
}
