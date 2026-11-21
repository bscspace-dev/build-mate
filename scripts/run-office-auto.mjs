// 사용법: node scripts/run-office-auto.mjs [주소]
// 겸직 인원의 빈 시간을 사무실로 자동 배치하는 주소(/api/cron/office-auto)를 한 번 부른다.
// Cloudflare 로 배포한 서버는 wrangler.jsonc 의 예약 작업이 알아서 부르니 필요 없고, PC 에서 직접 돌릴 때(start-local.bat)
// Windows '작업 스케줄러'로 매일 밤 12시 5분에 이 스크립트를 실행하도록 등록한다. (README 참고)
// 주소는 인자로 주거나, 없으면 http://127.0.0.1:3100 을 쓴다. CRON_SECRET 은 .env.local 에서 읽는다.
import { loadEnv } from './_supabase-env.mjs';

const env = { ...loadEnv(), ...process.env };
const secret = env.CRON_SECRET;
if (!secret || secret.length < 16) {
  console.error('CRON_SECRET 이 .env.local 에 없거나 16자보다 짧아요.');
  process.exit(1);
}
const base = (process.argv[2] || env.APP_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const res = await fetch(base + '/api/cron/office-auto', { method: 'POST', headers: { authorization: 'Bearer ' + secret } });
const text = await res.text();
console.log(res.status, text);
process.exit(res.ok ? 0 : 1);
