import { destroySession } from '@/lib/auth';
import { json, sameOrigin } from '@/lib/guard';
import { destroyMemberSession } from '@/lib/member-session';

// 어떤 로그인(내장 최고 관리자·회원)이든 모두 로그아웃
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  await destroyMemberSession();
  await destroySession();
  return json({ ok: true });
}
