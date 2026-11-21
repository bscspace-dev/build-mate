import crypto from 'node:crypto';
import { json } from '@/lib/guard';
import { todayKst } from '@/lib/kst';
import { ensureOfficeDefaults } from '@/lib/office-auto';

// 예약 작업(스케줄러)이 매일 밤 12시(한국 시간) 직후에 부르는 주소:
// 사무실·현장 팀을 모두 가진 겸직 인원 중 그날 현장에 배치되지 않은 사람을 자동으로 사무실에 배치한다.
// 로그인한 사람이 아니라 예약 작업만 부를 수 있도록 CRON_SECRET 값을 'Authorization: Bearer <값>' 으로 보내야 한다.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < 16) return false; // 비밀 값이 없거나 너무 짧으면 아무도 부를 수 없다
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function run(req: Request) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16) return json({ error: 'CRON_SECRET 이 설정되지 않았어요 (16자 이상).' }, 503);
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);
  const today = todayKst();
  const filled = await ensureOfficeDefaults(today);
  return json({ ok: true, today, filled });
}

export const POST = run;
export const GET = run;
