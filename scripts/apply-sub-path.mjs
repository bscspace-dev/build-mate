// 사용법: node scripts/apply-sub-path.mjs          (미리보기만, 아무것도 바꾸지 않음)
//        node scripts/apply-sub-path.mjs --apply  (백업 파일을 만든 뒤 실제로 저장)
// 소모품의 세부분류를 "공정>카테고리" 형태로 채운다. 예) 목공 카테고리(공정: 구조) → "구조>목공"
// 이미 적힌 세부분류는 뒤에 이어 붙여서 보존한다. 예) "구조>목공>MDF"  (이미 "구조>목공"으로 시작하면 건너뜀)
import fs from 'node:fs';
import path from 'node:path';
import { connect, root } from './_supabase-env.mjs';

const apply = process.argv.includes('--apply');
const db = connect();

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('products').select('key,category,sub,deleted_at').range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}
const { data: cats, error: ce } = await db.from('categories').select('name,trade');
if (ce) throw new Error(ce.message);
const tradeOf = Object.fromEntries(cats.map(c => [c.name, c.trade || '']));

const norm = s => String(s ?? '').split('>').map(x => x.trim()).filter(Boolean).join('>');
const changes = [];
for (const r of rows) {
  const head = [tradeOf[r.category], r.category].filter(Boolean).join('>');
  const cur = norm(r.sub);
  if (cur === head || cur.startsWith(head + '>')) continue;
  const next = cur ? `${head}>${cur}` : head;
  if (next !== r.sub) changes.push({ key: r.key, before: r.sub ?? '', after: next, deleted: !!r.deleted_at });
}

const summary = {};
for (const c of changes) summary[`${c.before || '(빈값)'}  →  ${c.after}`] = (summary[`${c.before || '(빈값)'}  →  ${c.after}`] ?? 0) + 1;
console.log(`전체 ${rows.length}건 중 ${changes.length}건이 바뀌어요.\n`);
for (const [k, n] of Object.entries(summary).sort()) console.log(String(n).padStart(4), k);

if (!apply) {
  console.log('\n(미리보기입니다. 저장하려면 --apply 를 붙여 다시 실행하세요.)');
  process.exit(0);
}
const backup = path.join(root, `backup-sub-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(backup, JSON.stringify(changes.map(c => ({ key: c.key, sub: c.before })), null, 1));
console.log(`\n원래 세부분류를 ${backup} 에 백업했어요.`);
for (let i = 0; i < changes.length; i += 20) {
  await Promise.all(changes.slice(i, i + 20).map(async c => {
    const { error } = await db.from('products').update({ sub: c.after }).eq('key', c.key);
    if (error) throw new Error(`${c.key}: ${error.message}`);
  }));
}
console.log(`${changes.length}건 저장 완료.`);
