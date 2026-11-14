// 사용법: node scripts/create-member.mjs <아이디> <비밀번호> <이름> [팀키=super]
// .env.local 의 Supabase 로 연결해 회원을 바로 만든다 (앱의 비밀번호 규칙·임시 비밀번호 단계를 거치지 않는다).
import crypto from 'node:crypto';
import { connect } from './_supabase-env.mjs';

const [loginId, password, name, role = 'super'] = process.argv.slice(2);
if (!loginId || !password || !name) {
  console.error('사용법: node scripts/create-member.mjs <아이디> <비밀번호> <이름> [팀키=super]');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32);
const passHash = `s1$${salt.toString('base64')}$${hash.toString('base64')}`; // lib/accounts.ts 의 hashPassword 와 같은 형식

const db = connect();
const row = {
  id: crypto.randomBytes(9).toString('base64url'), name, role, trades: [], menus: [], actions: {},
  login_id: loginId.trim().toLowerCase(), pass_hash: passHash, must_change_password: false, id_changed: false,
};
const { error } = await db.from('members').insert(row);
if (error) {
  console.error('✗ ' + error.message);
  process.exit(1);
}
console.log(`✓ 회원 생성: ${name} (아이디 ${row.login_id}, 팀 ${role})`);
