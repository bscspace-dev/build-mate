// 사용법:
//   npm run supabase:migrate -- --dry-run   (Supabase 없이, 옮길 내용만 확인)
//   npm run supabase:migrate                (data/*.json → Supabase 로 복사)
// 여러 번 실행해도 안전하다(같은 키는 덮어쓰기). 로컬 파일은 지우지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { connect, root } from './_supabase-env.mjs';

const dry = process.argv.includes('--dry-run');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));

const products = read('products.json');
const trash = read('trash.json');
// 회원: members.json 이 있으면 그대로, 없으면(예전 데이터) workers.json 을 '현장작업자' 회원으로 바꿔서
function loadMembers() {
  if (fs.existsSync(path.join(root, 'data/members.json'))) return read('members.json').map(m => ({ ...m, menus: m.menus ?? [], actions: m.actions ?? {} }));
  if (fs.existsSync(path.join(root, 'data/workers.json'))) {
    return read('workers.json').map(w => ({
      id: w.id, name: w.name, role: 'worker', trades: w.trades, menus: [], actions: {}, loginId: w.loginId, passHash: w.passHash,
      mustChangePassword: false, idChanged: false, createdAt: w.createdAt,
    }));
  }
  return [];
}
const members = loadMembers();
// 팀: data/teams.json 이 있으면 그대로(사이트가 한 번이라도 실행됐다면 만들어져 있다), 없으면 기본 팀. roles.ts 의 DEFAULT_TEAMS 와 같게 유지.
const DEFAULT_TEAMS = [
  { key: 'design', label: '디자인팀', group: 'office', locked: false },
  { key: 'marketing', label: '마케팅팀', group: 'office', locked: false },
  { key: 'super', label: '최고 관리자', group: 'office', locked: true },
  { key: 'dev', label: '개발팀', group: 'office', locked: true },
  { key: 'sales', label: '영업팀', group: 'office', locked: false },
  { key: 'worker', label: '현장작업자(정)', group: 'field', locked: true },
  { key: 'worker_sub', label: '현장작업자(부)', group: 'field', locked: true },
  { key: 'pm', label: '현장관리자(PM)', group: 'field', locked: true },
  { key: 'partner', label: '협력업체', group: 'outsource', locked: false },
];
const teams = fs.existsSync(path.join(root, 'data/teams.json')) ? read('teams.json') : DEFAULT_TEAMS;
const trades = read('meta.json').trades;
const respDir = path.join(root, 'data/responses');
const respFiles = fs.existsSync(respDir) ? fs.readdirSync(respDir).filter(f => f.endsWith('.json')) : [];

const productRow = (p, deletedAt) => ({
  key: p.key, seq: p.seq, category: p.category, sub: p.sub ?? '', name: p.name, brand: p.brand ?? '',
  price: p.price ?? null, price_incl_vat: p.priceInclVat ?? null, vat_basis: p.vatBasis ?? null, soldout: !!p.soldout,
  image: p.image ?? '', trades: p.trades ?? [], deleted_at: deletedAt,
});
const rows = {
  products: [...products.map(p => productRow(p, null)), ...trash.map(p => productRow(p, p.deletedAt ?? new Date().toISOString()))],
  teams: teams.map((t, i) => ({ key: t.key, label: t.label, grp: t.group, locked: !!t.locked, sort: i + 1 })),
  members: members.map(m => ({
    id: m.id, name: m.name, role: m.role, trades: m.trades ?? [], menus: m.menus ?? [], actions: m.actions ?? {}, login_id: m.loginId ?? null, pass_hash: m.passHash ?? null,
    must_change_password: !!m.mustChangePassword, id_changed: !!m.idChanged, created_at: m.createdAt,
  })),
  responses: respFiles.map(f => {
    const r = JSON.parse(fs.readFileSync(path.join(respDir, f), 'utf8'));
    return { worker_id: r.workerId ?? null, name: r.name, trade: r.trade, at: r.at, items: r.items ?? [], custom: r.custom ?? [], legacy_file: f };
  }),
  app_settings: [{ key: 'trades', value: trades }],
};

console.log('옮길 내용:', { 자재: products.length, 휴지통: trash.length, 팀: teams.length, 회원: members.length, 설문응답: respFiles.length, 공정목록: trades.length });
if (dry) {
  console.log('(dry-run: 실제로는 아무것도 보내지 않았어요)');
  process.exit(0);
}

const db = connect();
async function upsert(table, list, onConflict) {
  for (let i = 0; i < list.length; i += 500) {
    const { error } = await db.from(table).upsert(list.slice(i, i + 500), { onConflict });
    if (error) {
      console.error(`✗ ${table} 실패: ${error.message}${error.code === 'PGRST205' ? ' (테이블이 없어요 → supabase/schema.sql 먼저 실행)' : ''}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${table.padEnd(12)} ${list.length}건 전송`);
}
await upsert('products', rows.products, 'key');
await upsert('teams', rows.teams, 'key'); // 회원이 팀을 참조하므로 먼저
await upsert('members', rows.members, 'id');
if (rows.responses.length) await upsert('responses', rows.responses, 'legacy_file');
await upsert('app_settings', rows.app_settings, 'key');

// 전송 결과 검증: 개수가 로컬과 같은지
const count = async (table, f) => {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  return (await q).count;
};
const check = [
  ['자재(사용 중)', await count('products', q => q.is('deleted_at', null)), products.length],
  ['휴지통', await count('products', q => q.not('deleted_at', 'is', null)), trash.length],
  ['팀', await count('teams'), teams.length],
  ['회원', await count('members'), members.length],
];
let ok = true;
for (const [label, got, want] of check) {
  const same = got === want;
  if (!same) ok = false;
  console.log(`${same ? '✓' : '✗'} ${label}: Supabase ${got} / 로컬 ${want}`);
}
console.log(
  ok
    ? '\n이관 완료. 로컬 파일은 그대로 남아 있어요.\n사이트에서 Supabase 를 쓰려면 .env.local 의 DATA_STORE=file 을 DATA_STORE=supabase 로 바꾸고 서버를 다시 시작하세요.'
    : '\n개수가 달라요. 위 항목을 확인해 주세요.',
);
process.exit(ok ? 0 : 1);
