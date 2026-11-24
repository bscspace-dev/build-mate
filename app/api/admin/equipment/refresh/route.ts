import { actorCan, getActor } from '@/lib/auth';
import { getEquipment, saveEquipment } from '@/lib/db';
import { lowestOf, settleHistory } from '@/lib/equipment';
import { json, limited, sameOrigin } from '@/lib/guard';
import { naverLowest, naverReady } from '@/lib/naver-shop';
import { priceFromUrl } from '@/lib/page-price';

// 한 장비의 가격을 갱신한다 (수정 권한). 여러 개는 화면에서 하나씩 차례로 부른다.
//  · 링크로 등록한 판매처 가격(auto)은 그 상품 페이지를 다시 열어 가격을 새로 읽는다.
//  · 네이버 키가 서버에 있으면 네이버 쇼핑 최저가도 함께 갱신한다 (없으면 건너뜀).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('equipment');
  if (!actor) return json({ error: '장비정보 메뉴 권한이 필요해요.' }, 401);
  if (!actorCan(actor, 'equipment', 'edit')) return json({ error: '최저가를 갱신할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (limited(req, 'equipment-refresh', 600, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id.slice(0, 64) : '';
  const cur = (await getEquipment()).find(x => x.id === id);
  if (!cur) return json({ error: '없는 장비예요.' }, 404);

  const autos = cur.offers.filter(o => o.auto && o.url);
  const useNaver = naverReady();
  if (autos.length === 0 && !useNaver) return json({ error: '링크로 등록한 가격이 없어요. 판매처 가격에 상품 링크를 넣어 주세요.', code: 'nolink' }, 422);

  const now = new Date().toISOString();
  const before = lowestOf(cur)?.price ?? null;
  let okCount = 0, failCount = 0;

  // 링크 가격: 한 번에 몇 개씩만 읽어 서버와 쇼핑몰에 부담을 줄인다
  const fresh = new Map<string, number>();
  for (let i = 0; i < autos.length; i += 3) {
    await Promise.all(autos.slice(i, i + 3).map(async o => {
      const r = await priceFromUrl(o.url);
      if (r.ok) { fresh.set(o.id, r.result.price); okCount++; } else failCount++;
    }));
  }
  const offers = cur.offers.map(o => (fresh.has(o.id) ? { ...o, price: fresh.get(o.id)!, at: now } : o));

  let naver = cur.naver;
  if (useNaver) {
    const query = cur.query || `${cur.brand} ${cur.model}`.trim() || cur.name;
    const r = await naverLowest(query, cur.model);
    if (r.ok) { naver = { ...r.result, at: now }; okCount++; } else failCount++;
  }

  if (okCount === 0) return json({ error: '가격을 읽지 못했어요. 쇼핑몰이 자동 접속을 막았거나 링크가 바뀌었을 수 있어요. 가격을 직접 적어 주세요.', code: 'fail' }, 502);

  const history = settleHistory({ offers, naver, history: cur.history }, now);
  await saveEquipment(id, { name: cur.name, brand: cur.brand, model: cur.model, category: cur.category, spec: cur.spec, query: cur.query, offers, naver, history });
  const low = lowestOf({ offers, naver });
  return json({ ok: true, price: low?.price ?? 0, changed: before !== (low?.price ?? null), failed: failCount });
}
