import { actorCan, getActor } from '@/lib/auth';
import { savePayDefaults } from '@/lib/db';
import { json, sameOrigin } from '@/lib/guard';

// 기본 급여 설정 (최고 관리자·개발팀): 새 회원을 등록할 때 급여 칸에 미리 들어가는 금액 — 일수제는 일당, 사무직 기준은 월급
const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : 0);

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('members');
  if (!actor) return json({ error: '회원등록 권한이 없어요.' }, 401);
  if (!actorCan(actor, 'members', 'edit')) return json({ error: '이 작업을 할 권한이 없어요.' }, 403);
  const b = (await req.json().catch(() => null)) as { daily?: unknown; monthly?: unknown } | null;
  const daily = num(b?.daily);
  const monthly = num(b?.monthly);
  if (![daily, monthly].every(n => Number.isFinite(n) && n >= 0 && n <= 100_000_000)) return json({ error: '금액은 0~100,000,000원으로 적어 주세요.' }, 400);
  const out = { daily: Math.round(daily), monthly: Math.round(monthly) };
  await savePayDefaults(out);
  return json({ ok: true, ...out });
}
