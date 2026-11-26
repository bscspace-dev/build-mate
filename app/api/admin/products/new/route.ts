import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { addProduct, getCategories, getCategoryTrades, nextProductKey, getTrades, setProductModel, setProductBattery, setProductVoltage } from '@/lib/db';
import { headOf, rewriteSub } from '@/lib/sub-path';
import { json, limited, sameOrigin } from '@/lib/guard';
import { asKind } from '@/lib/types';
import { removeImage, saveImage } from '@/lib/images';

// 새 소모품(품목) 등록: 사진 + 정보. '등록' 권한이 있어야 한다.
// 사진은 브라우저에서 줄여서(webp) 보낸 파일을 받아 저장한다.
const MAX_IMAGE = 3 * 1024 * 1024;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const text = (v: FormDataEntryValue | null, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const whole = (v: FormDataEntryValue | null, max: number) => {
  const s = typeof v === 'string' ? v.replace(/[,\s]/g, '') : '';
  if (!s) return 0;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN;
};

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('catalog');
  if (!actor) return json({ error: '소모품 메뉴 권한이 필요해요.' }, 401);
  if (!actorCan(actor, 'catalog', 'register')) return json({ error: '품목을 등록할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (limited(req, 'newproduct', 60, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad request' }, 400);

  const name = text(form.get('name'), 100);
  const category = text(form.get('category'), 20);
  const sub = text(form.get('sub'), 100);
  const brand = text(form.get('brand'), 50);
  const price = whole(form.get('price'), 99_999_999);
  const kind = asKind(form.get('kind'));
  const stock = whole(form.get('stock'), 9_999_999);
  if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
  if (Number.isNaN(price)) return json({ error: '가격은 0 이상의 숫자로 적어 주세요.' }, 400);
  if (Number.isNaN(stock)) return json({ error: '재고는 0 이상의 숫자로 적어 주세요.' }, 400);
  if (!category || !(await getCategories()).includes(category)) return json({ error: '카테고리를 골라 주세요.' }, 400);

  const photo = form.get('photo');
  if (!(photo instanceof File) || photo.size === 0) return json({ error: '사진을 올려 주세요.' }, 400);
  if (!TYPES.includes(photo.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
  if (photo.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 3MB 이하로 올려 주세요.' }, 413);

  const key = await nextProductKey();
  const catTrades = await getCategoryTrades();
  const trade = catTrades[category] ?? '';
  const subPath = rewriteSub(sub, '', headOf(category, catTrades, await getTrades())); // 세부분류: 공정>카테고리(>직접 적은 내용)
  const image = await saveImage(key, new Uint8Array(await photo.arrayBuffer()), photo.type);
  try {
    // 카테고리가 속한 공정을 자재의 공정으로 정해 둔다(현장 요청 화면에서 그 공정 작업자에게 보이도록)
    const product = await addProduct({ key, kind, category, sub: subPath, name, brand, price, priceInclVat: null, vatBasis: '', soldout: false, stock, image, trades: trade ? [trade] : [] });
    const model = text(form.get('model'), 100); // 연장 제품명(모델명)
    if (model) await setProductModel(product.key, model);
    const voltage = text(form.get('voltage'), 20); // 연장 전압 (예: 18V)
    if (voltage) await setProductVoltage(product.key, voltage);
    const battery = text(form.get('battery'), 10); // 연장 배터리 포함 여부
    if (battery === '포함' || battery === '미포함') await setProductBattery(product.key, battery);
    return json({ ok: true, product });
  } catch (e) {
    await removeImage(image).catch(() => undefined); // 등록에 실패하면 올린 사진도 지운다
    throw e;
  }
}

export const POST = audited('catalog', handlePOST);
