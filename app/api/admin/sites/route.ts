import { actorCan, getActor } from '@/lib/auth';
import { addSite, getMembers, getSites, removeSite, updateSite } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { memberHasRole } from '@/lib/roles';
import { removeImage, saveImage } from '@/lib/images';

// 현장일정: 등록(등록 권한) · 수정(수정 권한) · 삭제(삭제 권한). 자재 요청에서 고르는 현장 목록이다.
// 항목: 현장명(필수) · 공사기간(시작·종료일) · 담당 PM(현장관리자 PM 팀 회원) · 현장 주소 · 특이사항 · 현장 사진(여러 장)
// 등록·수정은 사진 때문에 multipart(FormData), 삭제는 JSON 으로 받는다.
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PHOTOS = 10; // 현장 하나에 올릴 수 있는 사진 수
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('sites');
  if (!actor) return json({ error: '현장일정 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'sites', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
  let get: (k: string) => FormDataEntryValue | unknown;
  let files: File[] = [];
  if (multipart) {
    const form = await req.formData().catch(() => null);
    if (!form) return json({ error: 'bad request' }, 400);
    get = k => form.get(k);
    files = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
  } else {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return json({ error: 'bad request' }, 400);
    get = k => b[k];
  }
  const a = get('action');
  const need = a === 'add' ? 'register' : a === 'update' ? 'edit' : a === 'delete' ? 'delete' : null;
  if (!need) return json({ error: 'bad request' }, 400);
  if (!actorCan(actor, 'sites', need)) return json({ error: '이 작업을 할 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);

  const id = clip(get('id'), 64);
  if (a === 'delete') {
    if (!id) return json({ error: 'bad id' }, 400);
    const r = await removeSite(id);
    if ('error' in r) return json(r, 400);
    await Promise.all(r.photos.map(p => removeImage(p).catch(() => undefined))); // 현장 사진 파일도 정리한다
    return json({ ok: true });
  }

  const name = clip(get('name'), 50);
  if (!name) return json({ error: '현장명을 1~50자로 적어 주세요.' }, 400);
  const startDate = clip(get('startDate'), 10);
  const endDate = clip(get('endDate'), 10);
  if ((startDate && !isDate(startDate)) || (endDate && !isDate(endDate))) return json({ error: '공사기간 날짜가 올바르지 않아요.' }, 400);
  if (startDate && endDate && endDate < startDate) return json({ error: '공사 종료일이 시작일보다 빠를 수 없어요.' }, 400);
  const pmId = clip(get('pmId'), 64);
  if (pmId) {
    // 담당 PM은 현장관리자(PM) 팀 회원만 지정할 수 있다
    const m = (await getMembers()).find(x => x.id === pmId);
    if (!m || !memberHasRole(m, 'pm')) return json({ error: '담당 PM은 현장관리자(PM) 팀 회원 중에서 골라 주세요.' }, 400);
  }

  // 사진(여러 장): keep = 그대로 둘 기존 사진 주소들(수정할 때), photo = 새로 올린 파일들
  let keep: string[] | undefined;
  if (a === 'update') {
    const cur = (await getSites()).find(x => x.id === id);
    if (!cur) return json({ error: '없는 현장이에요.' }, 400);
    let want: unknown = [];
    try { want = JSON.parse(typeof get('keep') === 'string' ? (get('keep') as string) : '[]'); } catch { want = []; }
    keep = (Array.isArray(want) ? want : []).filter((p): p is string => typeof p === 'string' && cur.photos.includes(p)); // 이 현장의 사진만 남길 수 있다
  }
  if (files.length + (keep?.length ?? 0) > MAX_PHOTOS) return json({ error: `사진은 한 현장에 ${MAX_PHOTOS}장까지 올릴 수 있어요.` }, 400);
  for (const f of files) {
    if (!TYPES.includes(f.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
    if (f.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 한 장에 3MB 이하로 올려 주세요.' }, 413);
  }
  const saved: string[] = [];
  const dropSaved = () => Promise.all(saved.map(p => removeImage(p).catch(() => undefined)));
  try {
    for (const f of files) saved.push(await saveImage('site-' + Math.random().toString(36).slice(2, 10), new Uint8Array(await f.arrayBuffer()), f.type));
  } catch (e) {
    await dropSaved();
    throw e;
  }
  const photos = a === 'update' ? [...(keep ?? []), ...saved] : saved;
  const input = { name, address: clip(get('address'), 200), pmId, startDate, endDate, memo: clip(get('memo'), 300), photos };

  try {
    if (a === 'add') {
      const r = await addSite(input);
      if ('error' in r) { await dropSaved(); return json(r, 400); }
      return json({ ok: true });
    }
    if (!id) { await dropSaved(); return json({ error: 'bad id' }, 400); }
    const r = await updateSite(id, input);
    if ('error' in r) { await dropSaved(); return json(r, 400); }
    await Promise.all(r.removed.map(p => removeImage(p).catch(() => undefined))); // 목록에서 뺀 사진 파일 정리
    return json({ ok: true });
  } catch (e) {
    await dropSaved();
    throw e;
  }
}
