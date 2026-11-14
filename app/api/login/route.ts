import { adminLoginId, checkAdminLogin, createSession, destroySession } from '@/lib/auth';
import { getDummyHash, verifyPassword } from '@/lib/accounts';
import { getMemberByLoginId } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { createMemberSession, destroyMemberSession } from '@/lib/member-session';

// 메인 화면 로그인 (아이디/비밀번호). .env.local 의 관리자 아이디면 내장 최고 관리자로, 아니면 회원으로 로그인한다.
// 로그인 뒤 어디로 갈지(관리자 화면 / 설문 / 내 정보 / 비밀번호 변경)는 서버가 메인 화면(/)에서 직급을 보고 정한다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  // 무차별 대입 방지: 10분에 10번까지
  if (limited(req, 'wlogin', 10, 10 * 60 * 1000)) return json({ error: '시도가 너무 많아요. 잠시 후 다시 해 주세요.' }, 429);

  const b = (await req.json().catch(() => null)) as { id?: unknown; password?: unknown } | null;
  const id = typeof b?.id === 'string' ? b.id.trim().slice(0, 40) : '';
  const pw = typeof b?.password === 'string' ? b.password : '';
  if (!id || !pw || pw.length > 64) return json({ error: '아이디와 비밀번호를 입력해 주세요.' }, 400);

  // 내장 최고 관리자
  if (id.toLowerCase() === adminLoginId()) {
    if (!checkAdminLogin(id, pw)) return json({ error: '아이디 또는 비밀번호가 맞지 않아요.' }, 401);
    await createSession();
    await destroyMemberSession(); // 한 브라우저에 두 로그인이 겹치지 않게
    return json({ ok: true });
  }

  // 회원
  const m = await getMemberByLoginId(id);
  // 없는 아이디여도 같은 시간이 걸리도록 항상 해시 비교를 한다
  const ok = await verifyPassword(pw, m?.passHash ?? (await getDummyHash()));
  if (!m || !m.passHash || !ok) return json({ error: '아이디 또는 비밀번호가 맞지 않아요.' }, 401);
  await createMemberSession(m);
  await destroySession();
  return json({ ok: true });
}
