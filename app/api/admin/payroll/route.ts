import { getActor } from '@/lib/auth';
import { getActiveMembers, setPayrollPaidMany } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';

// 월급 지급 완료 표시 / 취소 (월급관리 메뉴 권한). 선택한 회원들을 한 번에, 어느 달분(ym)을 얼마(실지급)로 지급했는지 남긴다.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('payroll');
  if (!actor) return json({ error: '월급관리 권한이 없어요.' }, 401);
  if (limited(req, 'payroll', 200, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as { action?: unknown; ym?: unknown; items?: unknown } | null;
  if (!b || (b.action !== 'paid' && b.action !== 'unpaid') || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 500) return json({ error: 'bad request' }, 400);
  const ym = typeof b.ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.ym) ? b.ym : '';
  if (!ym) return json({ error: '지급할 달을 확인해 주세요.' }, 400);
  const active = new Set((await getActiveMembers()).map(m => m.id));
  const by = actor.kind === 'member' ? actor.member.name : '최고 관리자';
  const at = new Date().toISOString();
  const changes: [string, { at: string; amount: number; by: string } | null][] = [];
  for (const it of b.items as { memberId?: unknown; amount?: unknown }[]) {
    const id = typeof it?.memberId === 'string' ? it.memberId : '';
    if (!id || !active.has(id)) continue; // 재직 중인 회원만
    if (b.action === 'unpaid') { changes.push([id, null]); continue; }
    const amount = typeof it.amount === 'number' && Number.isFinite(it.amount) && it.amount >= 0 && it.amount <= 2_000_000_000 ? Math.round(it.amount) : NaN;
    if (Number.isNaN(amount)) return json({ error: '지급 금액을 확인해 주세요.' }, 400);
    changes.push([id, { at, amount, by }]);
  }
  if (changes.length === 0) return json({ error: '처리할 회원이 없어요.' }, 400);
  await setPayrollPaidMany(ym, changes);
  return json({ ok: true, count: changes.length });
}
