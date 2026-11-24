import { actorCan, getActor } from '@/lib/auth';
import { getEquipment, removeEquipment, saveEquipment } from '@/lib/db';
import { settleHistory } from '@/lib/equipment';
import { json, limited, sameOrigin } from '@/lib/guard';
import { FAIL_TEXT, priceFromUrl } from '@/lib/page-price';
import crypto from 'node:crypto';

// 장비정보: 연장 정보 등록(등록 권한) · 정보 수정과 판매처 가격 추가·삭제(수정 권한) · 장비 삭제(삭제 권한).
// 최저가는 직접 등록한 판매처 가격과 네이버 최저가(/refresh) 중 가장 싼 값이고, 바뀔 때마다 기록이 남는다.
type Body = { action?: unknown; id?: unknown; name?: unknown; brand?: unknown; model?: unknown; category?: unknown; spec?: unknown; query?: unknown; mall?: unknown; price?: unknown; url?: unknown; offerId?: unknown };
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const clipText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
const MAX_OFFERS = 12;

/** 링크 정리: 비어 있으면 빈 값, http(s)가 없으면 https:// 를 붙이고, http·https 가 아니면 거절한다. */
function cleanUrl(raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().slice(0, 2000);
  } catch {
    return null;
  }
}

/** 자주 쓰는 쇼핑몰은 한글 이름으로, 나머지는 도메인 그대로 */
const MALLS: [string, string][] = [['coupang', '쿠팡'], ['11st', '11번가'], ['gmarket', 'G마켓'], ['auction', '옥션'], ['smartstore.naver', '스마트스토어'], ['naver', '네이버'], ['danawa', '다나와'], ['ssg', 'SSG'], ['lotteon', '롯데온'], ['interpark', '인터파크'], ['tmon', '티몬'], ['wemakeprice', '위메프'], ['domeggook', '도매꾹'], ['ohou', '오늘의집'], ['hardwarestore', '하드웨어스토어']];
const mallName = (host: string) => MALLS.find(([k]) => host.includes(k))?.[1] ?? host.slice(0, 30);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('equipment');
  if (!actor) return json({ error: '장비정보 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'equipment', 240, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as Body | null;
  const a = b?.action;
  const need = a === 'add' ? 'register' : a === 'update' || a === 'offer_add' || a === 'offer_link' || a === 'offer_remove' ? 'edit' : a === 'delete' ? 'delete' : null;
  if (!b || !need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'equipment', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const id = clip(b.id, 64);
  if (a === 'delete') return id && (await removeEquipment(id)) ? json({ ok: true }) : json({ error: '없는 장비예요.' }, 404);

  if (a === 'add' || a === 'update') {
    const name = clip(b.name, 60);
    if (!name) return json({ error: '장비명을 적어 주세요.' }, 400);
    const fields = { name, brand: clip(b.brand, 30), model: clip(b.model, 40), category: clip(b.category, 30), spec: clipText(b.spec, 500), query: clip(b.query, 80) };
    if (a === 'add') {
      const row = await saveEquipment(null, { ...fields, offers: [], naver: null, history: [] });
      return json({ ok: true, id: row?.id });
    }
    const cur = (await getEquipment()).find(x => x.id === id);
    if (!cur) return json({ error: '없는 장비예요.' }, 404);
    await saveEquipment(id, { ...fields, offers: cur.offers, naver: cur.naver, history: cur.history });
    return json({ ok: true });
  }

  // offer_add · offer_remove: 직접 등록한 판매처 가격
  const cur = (await getEquipment()).find(x => x.id === id);
  if (!cur) return json({ error: '없는 장비예요.' }, 404);
  let offers = cur.offers;
  if (a === 'offer_link') {
    // 상품 링크에서 가격을 읽어 판매처 가격으로 등록한다 (이후 갱신 때마다 다시 읽는다)
    const link = cleanUrl(b.url);
    if (!link) return json({ error: '상품 링크를 넣어 주세요. (http:// 또는 https:// 주소)' }, 400);
    if (offers.length >= MAX_OFFERS) return json({ error: `판매처 가격은 ${MAX_OFFERS}개까지 등록할 수 있어요.` }, 400);
    if (offers.some(o => o.url === link)) return json({ error: '이미 등록한 링크예요.' }, 400);
    const r = await priceFromUrl(link);
    if (!r.ok) return json({ error: FAIL_TEXT[r.reason], code: r.reason }, r.reason === 'no-price' ? 422 : 502);
    const mall = clip(b.mall, 30) || mallName(r.result.mall);
    offers = [...offers, { id: crypto.randomBytes(4).toString('hex'), mall, price: r.result.price, url: link, at: new Date().toISOString(), auto: true }];
  } else if (a === 'offer_add') {
    const mall = clip(b.mall, 30);
    if (!mall) return json({ error: '판매처 이름을 적어 주세요.' }, 400);
    const price = typeof b.price === 'number' && Number.isInteger(b.price) && b.price >= 1 && b.price <= 99_999_999 ? b.price : NaN;
    if (Number.isNaN(price)) return json({ error: '가격은 1원 이상의 숫자로 적어 주세요.' }, 400);
    const url = cleanUrl(b.url);
    if (url === null) return json({ error: '링크는 http:// 또는 https:// 주소로 적어 주세요.' }, 400);
    if (offers.length >= MAX_OFFERS) return json({ error: `판매처 가격은 ${MAX_OFFERS}개까지 등록할 수 있어요.` }, 400);
    offers = [...offers, { id: crypto.randomBytes(4).toString('hex'), mall, price, url, at: new Date().toISOString() }];
  } else {
    const before = offers.length;
    offers = offers.filter(o => o.id !== clip(b.offerId, 32));
    if (offers.length === before) return json({ error: '없는 가격이에요.' }, 404);
  }
  const history = settleHistory({ offers, naver: cur.naver, history: cur.history }, new Date().toISOString());
  await saveEquipment(id, { name: cur.name, brand: cur.brand, model: cur.model, category: cur.category, spec: cur.spec, query: cur.query, offers, naver: cur.naver, history });
  return json({ ok: true });
}
