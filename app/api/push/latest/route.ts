import { hasRootSession } from '@/lib/auth';
import { getPushState } from '@/lib/db';
import { getSessionMember } from '@/lib/member-session';

// 알림 신호를 받은 기기가 보여 줄 내용: 이 사람에게 온 가장 최근 알림 (서비스 워커가 부른다)
export async function GET() {
  const me = (await hasRootSession()) ? 'root' : ((await getSessionMember())?.id ?? '');
  const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' };
  if (!me) return new Response(JSON.stringify({ item: null }), { headers });
  const feed = (await getPushState()).feed;
  const item = [...feed].reverse().find(x => x.to.includes(me)) ?? null;
  return new Response(JSON.stringify({ item: item && { id: item.id, title: item.title, body: item.body, url: item.url } }), { headers });
}
