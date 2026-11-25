import { audited } from '@/lib/audit';
import { getActor, hasRootSession, vehiclesFull } from '@/lib/auth';
import { addVehiclePhoto, getVehicles, removeVehiclePhoto } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeImage, saveImage } from '@/lib/images';
import { getSessionMember } from '@/lib/member-session';
import type { VehiclePhoto } from '@/lib/types';

// 차량 현황 사진: 지금 차량 상태(외관·계기판·적재 상태 등)를 사진으로 남긴다.
//  · 올리기: 차량정보 등록·수정 권한이 있는 사람, 또는 그 차량을 배차받은 회원
//  · 지우기: 수정 권한이 있는 사람, 또는 내가 올린 사진
// 사진 때문에 올리기는 multipart(FormData), 지우기는 JSON 으로 받는다.
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PER_UPLOAD = 4;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const root = await hasRootSession();
  const member = root ? null : await getSessionMember();
  if (!root && !member) return json({ error: '로그인이 필요해요.' }, 401);
  if (limited(req, 'vehicle-photos', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data');
  let get: (k: string) => unknown;
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
  if (a !== 'add' && a !== 'remove') return json({ error: 'bad request' }, 400);

  const id = clip(get('id'), 64);
  const vehicle = (await getVehicles()).find(v => v.id === id);
  if (!vehicle) return json({ error: '없는 차량이에요.' }, 404);
  const actor = await getActor('vehicles');
  const canEdit = !!actor && vehiclesFull(actor);
  const isDriver = !!member && vehicle.driverId === member.id;
  const canRegister = !!actor && vehiclesFull(actor); // 차량을 등록하면서 사진을 올릴 수 있다
  if (!canEdit && !isDriver && !(a === 'add' && canRegister)) return json({ error: '이 차량의 사진을 올릴 권한이 없어요.' }, 403);

  if (a === 'remove') {
    const url = clip(get('url'), 600);
    const p = vehicle.photos.find(x => x.url === url);
    if (!p) return json({ error: '없는 사진이에요.' }, 404);
    if (!canEdit && !(member && p.byId === member.id)) return json({ error: '내가 올린 사진만 지울 수 있어요.' }, 403);
    const r = await removeVehiclePhoto(id, url);
    if ('error' in r) return json(r, 404);
    await removeImage(url).catch(() => undefined);
    return json({ ok: true });
  }

  if (files.length < 1) return json({ error: '사진을 1장 이상 올려 주세요.' }, 400);
  if (files.length > MAX_PER_UPLOAD) return json({ error: `한 번에 ${MAX_PER_UPLOAD}장까지 올릴 수 있어요.` }, 400);
  for (const f of files) {
    if (!TYPES.includes(f.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
    if (f.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 한 장에 3MB 이하로 올려 주세요.' }, 413);
  }
  const by = member?.name ?? '최고 관리자';
  const note = clip(get('note'), 200);
  const saved: string[] = [];
  try {
    for (const f of files) saved.push(await saveImage('veh-' + Math.random().toString(36).slice(2, 10), new Uint8Array(await f.arrayBuffer()), f.type));
    const at = new Date().toISOString();
    for (const url of saved) {
      const photo: VehiclePhoto = { url, at, by, byId: member?.id ?? '', note };
      const r = await addVehiclePhoto(id, photo);
      if ('error' in r) throw new Error(r.error);
      await Promise.all(r.removed.map(u => removeImage(u).catch(() => undefined))); // 한도를 넘어 밀려난 옛 사진 파일 정리
    }
    return json({ ok: true });
  } catch (e) {
    await Promise.all(saved.map(p => removeImage(p).catch(() => undefined)));
    return json({ error: e instanceof Error ? e.message : '사진을 올리지 못했어요.' }, 500);
  }
}

export const POST = audited('vehicles', handlePOST);
