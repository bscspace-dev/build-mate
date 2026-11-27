import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { getProducts, setProductBattery, setProductCompat, setProductModel, setProductTags, setProductVoltage, updateProduct } from '@/lib/db';
import { asKind, KINDS } from '@/lib/types';
import { normTags } from '@/lib/tags';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeImage, saveImage } from '@/lib/images';

// 소모품(품목) 정보 수정: 이름·세부분류·브랜드·가격, 사진은 새로 올릴 때만 바꾼다. '수정' 권한이 있어야 한다.
// (카테고리는 '이동', 재고는 재고 칸에서 바꾼다)
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
  if (!actorCan(actor, 'catalog', 'edit')) return json({ error: '소모품 수정 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (limited(req, 'editproduct', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad request' }, 400);

  const rawKey = text(form.get('key'), 64);
  const key = rawKey.split('@')[0]; // 연결 복사본이면 원본을 고친다
  const name = text(form.get('name'), 100);
  let sub = text(form.get('sub'), 100);
  const brand = text(form.get('brand'), 50);
  const price = whole(form.get('price'), 99_999_999);
  const rawKind = form.get('kind');
  const kind = (KINDS as readonly unknown[]).includes(rawKind) ? asKind(rawKind) : undefined;
  if (!key) return json({ error: 'bad key' }, 400);
  if (!name) return json({ error: '품목 이름을 적어 주세요.' }, 400);
  if (Number.isNaN(price)) return json({ error: '가격은 0 이상의 숫자로 적어 주세요.' }, 400);

  const photo = form.get('photo');
  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto) {
    if (!TYPES.includes(photo.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
    if (photo.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 3MB 이하로 올려 주세요.' }, 413);
  }

  if (rawKey !== key) sub = (await getProducts()).find(p => p.key === key)?.sub ?? sub; // 복사본의 세부분류는 그 공정에서만 쓰는 값이라 원본에는 쓰지 않는다
  const image = hasPhoto ? await saveImage(key, new Uint8Array(await photo.arrayBuffer()), photo.type) : undefined;
  let r: { prevImage: string } | null;
  try {
    r = await updateProduct(key, { name, sub, brand, price, kind, image });
  } catch (e) {
    if (image) await removeImage(image).catch(() => undefined);
    throw e;
  }
  if (!r) {
    if (image) await removeImage(image).catch(() => undefined);
    return json({ error: '없는 소모품이에요.' }, 404);
  }
  const hasModel = form.has('model');
  const model = text(form.get('model'), 100); // 연장 제품명(모델명): 비우면 지운다
  if (hasModel) await setProductModel(key, model);
  const hasTags = form.has('tags');
  const tags = normTags(form.get('tags')); // 연장 태그: 비우면 지운다
  if (hasTags) await setProductTags(key, tags);
  const hasCompat = form.has('compat');
  const compat = text(form.get('compat'), 100); // 연장 호환성: 비우면 지운다
  if (hasCompat) await setProductCompat(key, compat);
  const hasVoltage = form.has('voltage');
  const voltage = text(form.get('voltage'), 20); // 연장 전압: 비우면 지운다
  if (hasVoltage) await setProductVoltage(key, voltage);
  const hasBattery = form.has('battery');
  const battery = text(form.get('battery'), 10); // 연장 배터리 포함 여부: 비우면 지운다
  if (hasBattery) await setProductBattery(key, battery);
  // 사진을 바꿨으면 예전 사진 파일은 지운다 (같은 파일 이름에 덮어쓴 경우는 그대로 둔다)
  if (image && r.prevImage && r.prevImage !== image) await removeImage(r.prevImage).catch(() => undefined);
  return json({ ok: true, name, sub, brand, price, ...(hasModel ? { model } : {}), ...(hasVoltage ? { voltage } : {}), ...(hasCompat ? { compat } : {}), ...(hasTags ? { tags } : {}), ...(hasBattery ? { battery: battery === '포함' || battery === '미포함' ? battery : '' } : {}), ...(kind ? { kind } : {}), ...(image ? { image } : {}) });
}

export const POST = audited('catalog', handlePOST);
