import { actorCan, getActor } from '@/lib/auth';
import type { Actor } from '@/lib/member-utils';
import { addSitePost, getActiveMembers, getPlacementNotes, getPlacements, getSitePost, getSitePosts, getSites, getTeams, removeSitePost } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeImage, saveImage } from '@/lib/images';
import { memberHasGroup } from '@/lib/roles';
import { slotLabel, type Slot } from '@/lib/types';
import { notifySitePost } from '@/lib/push';
import { isSitePostKind } from '@/lib/types';

// 작업일보: 그날의 변경사항·발주·작업내용·사진을 현장마다 올려 공유한다.
//  · 열람: 현장정보 메뉴를 쓸 수 있는 사람 (사내 팀은 기본으로 가능)
//  · 작성: 현장팀(PM·사수·부사수 등 현장 부서) 또는 현장정보 '등록' 권한자
//  · 삭제: 쓴 사람 본인 또는 현장정보 '삭제' 권한자
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PHOTOS = 6;
const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

async function powers(actor: Actor) {
  const meId = actor.kind === 'member' ? actor.member.id : '';
  const teams = await getTeams();
  const canPost = actor.kind === 'root' || actorCan(actor, 'sites', 'register') || memberHasGroup(teams, actor.member, 'field');
  const canModerate = actorCan(actor, 'sites', 'delete');
  return { meId, canPost, canModerate };
}

export async function GET(req: Request) {
  const actor = await getActor('sites');
  if (!actor) return json({ error: '현장정보 메뉴 권한이 필요해요.' }, 401);
  const siteId = new URL(req.url).searchParams.get('siteId') ?? '';
  if (!siteId) return json({ error: 'bad siteId' }, 400);
  // 그날 이 현장에 배치된 인원 (현장배치 메뉴를 볼 수 있는 사람에게만)
  const crewDate = new URL(req.url).searchParams.get('crewDate') ?? '';
  if (crewDate) {
    if (!isDate(crewDate)) return json({ error: 'bad date' }, 400);
    if (!actorCan(actor, 'placements', 'view')) return json({ ok: true, shown: false, crew: [], note: '' });
    const [placements, notes, members] = await Promise.all([getPlacements(crewDate, crewDate), getPlacementNotes(crewDate, crewDate), getActiveMembers()]);
    const nameOf = new Map(members.map(m => [m.id, m.name]));
    const byMember = new Map<string, Set<Slot>>();
    for (const p of placements) {
      if (p.siteId !== siteId || !nameOf.has(p.memberId)) continue;
      byMember.set(p.memberId, (byMember.get(p.memberId) ?? new Set<Slot>()).add(p.slot));
    }
    const crew = [...byMember.entries()]
      .map(([id, sl]) => {
        // 오전·오후를 모두 하면 표시 없음, 반나절만이면 (오전)/(오후), 야간·심야는 덧붙인다
        const half = sl.has('am') && sl.has('pm') ? '' : sl.has('am') ? slotLabel('am') : sl.has('pm') ? slotLabel('pm') : '';
        const extra = sl.has('nt') ? slotLabel('nt') : sl.has('ot') ? slotLabel('ot') : '';
        return { name: nameOf.get(id) ?? '', tag: [half, extra].filter(Boolean).join('+') };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return json({ ok: true, shown: true, crew, note: notes.find(n => n.siteId === siteId)?.note ?? '' });
  }
  return json({ ok: true, posts: await getSitePosts(siteId), ...(await powers(actor)) });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('sites');
  if (!actor) return json({ error: '현장정보 메뉴 권한이 필요해요.' }, 401);
  if (limited(req, 'site-posts', 120, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const pw = await powers(actor);

  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    // 삭제
    const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
    if (!b || b.action !== 'delete' || typeof b.id !== 'string') return json({ error: 'bad request' }, 400);
    const cur = await getSitePost(b.id);
    if (!cur) return json({ error: '없는 글이에요.' }, 404);
    if (!(pw.canModerate || (pw.meId && cur.authorId === pw.meId))) return json({ error: '이 글을 지울 권한이 없어요.' }, 403);
    const gone = await removeSitePost(b.id);
    await Promise.all((gone?.photos ?? []).map(p => removeImage(p).catch(() => undefined))); // 사진 파일도 정리한다
    return json({ ok: true });
  }

  // 등록 (글 + 사진)
  if (!pw.canPost) return json({ error: '작업일보를 올릴 권한이 없어요. 현장팀이거나 현장정보 등록 권한이 필요해요.' }, 403);
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: 'bad request' }, 400);
  const siteId = clip(form.get('siteId'), 64);
  if (!siteId || !(await getSites()).some(s => s.id === siteId)) return json({ error: '없는 현장이에요.' }, 400);
  const date = clip(form.get('date'), 10);
  const kind = form.get('kind');
  const body = clip(form.get('body'), 2000);
  if (!isDate(date) || !isSitePostKind(kind)) return json({ error: '날짜와 구분을 확인해 주세요.' }, 400);
  const files = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
  if (!body && files.length === 0) return json({ error: '내용이나 사진을 올려 주세요.' }, 400);
  if (files.length > MAX_PHOTOS) return json({ error: `사진은 한 번에 ${MAX_PHOTOS}장까지 올릴 수 있어요.` }, 400);
  for (const f of files) {
    if (!TYPES.includes(f.type)) return json({ error: '사진은 webp·jpg·png 파일만 올릴 수 있어요.' }, 400);
    if (f.size > MAX_IMAGE) return json({ error: '사진이 너무 커요. 한 장에 3MB 이하로 올려 주세요.' }, 413);
  }
  const saved: string[] = [];
  const dropSaved = () => Promise.all(saved.map(p => removeImage(p).catch(() => undefined)));
  try {
    for (const f of files) saved.push(await saveImage('sitepost-' + Math.random().toString(36).slice(2, 10), new Uint8Array(await f.arrayBuffer()), f.type));
    const post = await addSitePost({ siteId, date, kind, body, photos: saved, authorId: pw.meId, authorName: actor.kind === 'member' ? actor.member.name : '최고 관리자' });
    // 전체 푸시: 작업일보를 볼 수 있는 모든 사람(알림을 켠 기기)에게 알린다
    const site = (await getSites()).find(s => s.id === siteId);
    const who = post.authorName || '누군가';
    await notifySitePost({ title: `📋 ${site?.name ?? '현장'} 작업일보`, body: `${who}: ${body ? body.replace(/\s+/g, ' ').slice(0, 60) : '사진을 올렸어요'}`, url: `/admin/sites/${siteId}?tab=report`, authorId: pw.meId, origin: new URL(req.url).origin });
    return json({ ok: true, post });
  } catch (e) {
    await dropSaved();
    throw e;
  }
}
