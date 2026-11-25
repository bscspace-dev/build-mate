import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { getMember, patchMember } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeImage, saveImage } from '@/lib/images';
import { toPublic } from '@/lib/member-utils';

// 회원 프로필 사진: 올리기(file) / 지우기(remove=1). 최고 관리자·개발팀 전용 (회원 수정 권한).
const MAX_IMAGE = 3 * 1024 * 1024;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];

async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('members');
  if (!actor) return json({ error: '회원 관리 권한이 없어요.' }, 401);
  if (!actorCan(actor, 'members', 'edit')) return json({ error: '이 작업을 할 권한이 없어요.' }, 403);
  if (limited(req, 'member-photo', 60, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad request' }, 400);
  const id = typeof form.get('id') === 'string' ? (form.get('id') as string).slice(0, 64) : '';
  const kind: 'photo' | 'bankbook' = form.get('kind') === 'bankbook' ? 'bankbook' : 'photo'; // 프로필 사진 / 급여 통장 사본
  const member = id ? await getMember(id) : null;
  if (!member) return json({ error: '회원을 찾을 수 없어요.' }, 404);

  if (form.get('remove') === '1') {
    const r = await patchMember(id, { [kind]: '' });
    if (!('member' in r)) return json({ error: '회원을 찾을 수 없어요.' }, 404);
    if (member[kind]) await removeImage(member[kind]).catch(() => undefined);
    return json({ ok: true, member: toPublic(r.member) });
  }

  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0) return json({ error: '사진을 골라 주세요.' }, 400);
  if (!TYPES.includes(file.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
  if (file.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 3MB 이하로 올려 주세요.' }, 413);

  const url = await saveImage((kind === 'bankbook' ? 'bankbook-' : 'member-') + Math.random().toString(36).slice(2, 10), new Uint8Array(await file.arrayBuffer()), file.type);
  const r = await patchMember(id, { [kind]: url });
  if (!('member' in r)) {
    await removeImage(url).catch(() => undefined);
    return json({ error: '회원을 찾을 수 없어요.' }, 404);
  }
  if (member[kind]) await removeImage(member[kind]).catch(() => undefined); // 이전 사진 파일 정리
  return json({ ok: true, member: toPublic(r.member) });
}

export const POST = audited('members', handlePOST);
