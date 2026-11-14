// 사용법: npm run supabase:check
// .env.local 의 Supabase 설정으로 실제 연결하고, 테이블이 만들어져 있는지·몇 건 들어 있는지 보여준다.
import { connect, TABLES } from './_supabase-env.mjs';

const db = connect();
let bad = 0;
for (const t of TABLES) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    bad++;
    const missing = error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message);
    console.log(`✗ ${t.padEnd(12)} ${missing ? '테이블이 없어요 → supabase/schema.sql 을 SQL Editor 에서 실행하세요' : error.message}`);
  } else {
    console.log(`✓ ${t.padEnd(12)} ${count}건`);
  }
}
if (bad) {
  console.log(`\n${bad}개 테이블에 문제가 있어요.`);
  process.exit(1);
}
console.log('\n연결 정상. 다음: npm run supabase:migrate');
