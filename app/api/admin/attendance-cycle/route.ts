import { audited } from '@/lib/audit';
import { actorCan, getActor } from '@/lib/auth';
import { getAttendanceCycles, saveAttendanceCycles } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import { removeEntry, upsertEntry, validCycle, validFrom } from '@/lib/attendance-cycle';

// 출근 조회 기준(매달 며칠부터 며칠까지) 등록·수정·삭제 — 출근관리 메뉴의 '조회 기준 등록·수정'(등록) 권한이 있는 사람만.
// 기준마다 '적용 시작 월'을 같이 저장해서, 기준을 바꿔도 지난 달은 그때 기준 그대로 조회된다.
async function handlePOST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  const actor = await getActor('attendance');
  if (!actor) return json({ error: '출근관리 메뉴 권한이 필요해요.' }, 401);
  if (!(actorCan(actor, 'attendance', 'register') && actorCan(actor, 'attendance', 'edit'))) return json({ error: '조회 기준을 바꿀 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  if (limited(req, 'attendance-cycle', 60, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);
  const b = (await req.json().catch(() => null)) as { action?: unknown; startDay?: unknown; endDay?: unknown; from?: unknown } | null;
  if (!b || !validFrom(b.from)) return json({ error: '적용을 시작할 달을 골라 주세요.' }, 400);
  const cur = await getAttendanceCycles();
  if (b.action === 'remove') {
    await saveAttendanceCycles(removeEntry(cur, b.from));
    return json({ ok: true });
  }
  const c = { startDay: b.startDay, endDay: b.endDay };
  if (!validCycle(c)) return json({ error: '시작일과 종료일은 1~31 사이로 골라 주세요.' }, 400);
  await saveAttendanceCycles(upsertEntry(cur, { ...c, from: b.from }));
  return json({ ok: true });
}

export const POST = audited('attendance', handlePOST);
