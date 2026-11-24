import { hasRootSession } from '@/lib/auth';
import { updatePushState } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { getSessionMember } from '@/lib/member-session';
import { pushReady } from '@/lib/push';

// 이 기기에서 알림을 켠다 / 끈다. 로그인한 사람(회원·최고 관리자)만.
async function who(): Promise<string | null> {
  if (await hasRootSession()) return 'root';
  return (await getSessionMember())?.id ?? null;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const me = await who();
  if (!me) return json({ error: '로그인이 필요해요.' }, 401);
  if (!pushReady()) return json({ error: '서버에 알림 키가 아직 없어요.' }, 503);
  if (limited(req, 'push-sub', 60, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as { endpoint?: unknown; off?: unknown } | null;
  const endpoint = typeof b?.endpoint === 'string' ? b.endpoint : '';
  if (!/^https:\/\/[^\s]{10,600}$/.test(endpoint)) return json({ error: 'bad subscription' }, 400);
  await updatePushState(s => {
    const rest = s.subs.filter(x => x.endpoint !== endpoint);
    return { ...s, subs: b?.off === true ? rest : [...rest, { endpoint, memberId: me, at: new Date().toISOString() }].slice(-500) };
  });
  return json({ ok: true });
}
