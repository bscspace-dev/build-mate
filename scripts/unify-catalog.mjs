// 사용법:
//   node scripts/unify-catalog.mjs --dry-run   (아무것도 바꾸지 않고 계획만 보여줌)
//   node scripts/unify-catalog.mjs             (실제로 통합)
//
// 자재를 출처 사이트(자재로·건축자재몰)로 구분하지 않고 하나로 통합한다. (한 번만 실행)
//  · 자재마다 사이트와 무관한 새 번호(p0001, p0002 …)를 붙인다.  새 번호 = 목록 순서(seq + 1)
//  · 이미지를 사이트별 하위 폴더 대신 폴더 하나에 p0001.webp 처럼 모은다.
//      - 사이트: public/catalog/z/…, public/catalog/g/…  →  public/catalog/p0001.webp
//      - 자재통합: images/자재로/<분류>/…, images/건축자재몰/<분류>/…  →  images/p0001.webp
//  · 출처(source)·상품 링크(page)·이미지 원본 주소(image_url)·사이트 상품번호(id)를 지운다.
//  · 휴지통 자재와 이미 저장된 설문 응답의 자재 코드도 새 번호로 바꾼다.
// 실행 전에 바뀔 JSON 파일은 임시 폴더에 백업한다. 서버를 끈 상태에서 실행할 것.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dry = process.argv.includes('--dry-run');
const root = path.resolve(import.meta.dirname, '..');
const SRC = path.resolve(root, '..', '자재통합');
const PREFIX = { 자재로: 'z', 건축자재몰: 'g' };
const die = msg => {
  console.error('✗ ' + msg);
  process.exit(1);
};
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const newKey = i => 'p' + String(i + 1).padStart(4, '0');

const srcJson = path.join(SRC, 'products.json');
if (!fs.existsSync(srcJson)) die('자재통합/products.json 이 없어요.');
const rows = readJson(srcJson);
if (rows[0]?.key && !rows[0]?.source) {
  console.log('이미 통합된 데이터예요. 할 일이 없어요.');
  process.exit(0);
}

// 1) 예전 코드(z:12245 / g:1000000427) → 새 번호
const oldKeyOf = r => `${PREFIX[r.source]}:${r.id}`;
const toNew = new Map(rows.map((r, i) => [oldKeyOf(r), newKey(i)]));
if (toNew.size !== rows.length) die('예전 코드가 겹치는 자재가 있어요.');

// 2) 사이트 데이터(products/trash)와 대조
const webFiles = ['products.json', 'trash.json'].map(f => path.join(root, 'data', f));
const web = webFiles.map(f => (fs.existsSync(f) ? readJson(f) : []));
for (const list of web) {
  for (const p of list) {
    const nk = toNew.get(p.key);
    if (!nk) die(`사이트 자재 ${p.key} 이(가) 자재통합에 없어요. 데이터가 서로 달라서 중단해요.`);
    if (newKey(p.seq) !== nk) die(`자재 ${p.key} 의 순서(seq)가 자재통합과 달라요. 중단해요.`);
  }
}

// 3) 이미지 이동 계획
const extOf = f => path.extname(f).toLowerCase() || '.jpg';
const moves = []; // [from, to]
for (const list of web) {
  for (const p of list) {
    if (!p.image) continue;
    moves.push([path.join(root, 'public', p.image), path.join(root, 'public', 'catalog', toNew.get(p.key) + extOf(p.image))]);
  }
}
rows.forEach((r, i) => {
  if (!r.image_file) return;
  moves.push([path.join(SRC, r.image_file), path.join(SRC, 'images', newKey(i) + extOf(r.image_file))]);
});
const missing = moves.filter(([from]) => !fs.existsSync(from));
if (missing.length) die(`옮길 이미지 ${missing.length}개를 찾을 수 없어요. 예: ${missing[0][0]}`);
const dsts = new Set(moves.map(m => m[1]));
if (dsts.size !== moves.length) die('옮길 이미지의 새 파일 이름이 겹쳐요.');

console.log(`자재 ${rows.length}개 · 사이트 데이터 ${web[0].length}개 + 휴지통 ${web[1].length}개 · 옮길 이미지 ${moves.length}개`);
console.log(`예) ${path.basename(moves[0][0])} → ${path.basename(moves[0][1])}`);
if (dry) {
  console.log('(dry-run: 아무것도 바꾸지 않았어요)');
  process.exit(0);
}

// 4) 백업
const backup = path.join(os.tmpdir(), 'bm-unify-backup-' + Date.now());
fs.mkdirSync(backup, { recursive: true });
for (const f of [srcJson, path.join(SRC, 'products.csv'), ...webFiles]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backup, path.basename(path.dirname(f)) + '_' + path.basename(f)));
console.log('JSON 백업:', backup);

// 5) 이미지 이동
for (const [from, to] of moves) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

// 6) 데이터 다시 쓰기
const write = (f, data) => {
  fs.writeFileSync(f + '.tmp', typeof data === 'string' ? data : JSON.stringify(data));
  fs.renameSync(f + '.tmp', f);
};
web.forEach((list, k) => {
  for (const p of list) {
    const nk = toNew.get(p.key);
    p.key = nk;
    delete p.source;
    if (p.image) p.image = '/catalog/' + nk + extOf(p.image);
  }
  if (fs.existsSync(webFiles[k])) write(webFiles[k], list);
});

const unified = rows.map((r, i) => ({
  key: newKey(i), category: r.category, sub: r.sub || '', name: r.name, brand: r.brand || '',
  price: r.price, vat_basis: r.vat_basis, price_incl_vat: r.price_incl_vat ?? null, list_price: r.list_price ?? null,
  soldout: !!r.soldout, image_file: r.image_file ? 'images/' + newKey(i) + extOf(r.image_file) : '',
}));
write(srcJson, JSON.stringify(unified, null, 1));
const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
write(
  path.join(SRC, 'products.csv'),
  '﻿' + ['분류,세부분류,상품번호,자재명,브랜드,가격,부가세기준,가격(VAT포함),정가,품절,이미지파일', ...unified.map(u => [u.category, u.sub, u.key, u.name, u.brand, u.price, u.vat_basis, u.price_incl_vat, u.list_price, u.soldout ? 'Y' : '', u.image_file].map(q).join(','))].join('\n'),
);

// 7) 이미 저장된 설문 응답의 자재 코드도 새 번호로
const respDir = path.join(root, 'data', 'responses');
let respFixed = 0;
if (fs.existsSync(respDir)) {
  for (const f of fs.readdirSync(respDir).filter(x => x.endsWith('.json'))) {
    const r = readJson(path.join(respDir, f));
    if (Array.isArray(r.items)) {
      r.items = r.items.map(k => toNew.get(k) ?? k);
      write(path.join(respDir, f), r);
      respFixed++;
    }
  }
}

// 8) 비어 버린 사이트별 폴더 정리 (파일이 하나도 없는 폴더만)
function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return true;
  let empty = true;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() ? !removeEmptyDirs(path.join(dir, e.name)) : true) empty = false;
  }
  if (empty) fs.rmdirSync(dir);
  return empty;
}
for (const d of [path.join(root, 'public', 'catalog', 'z'), path.join(root, 'public', 'catalog', 'g'), path.join(SRC, 'images', '자재로'), path.join(SRC, 'images', '건축자재몰')]) {
  if (!removeEmptyDirs(d) && fs.existsSync(d)) console.warn('! 파일이 남아 있어 폴더를 지우지 않았어요:', d);
}
console.log(`완료: 자재 ${rows.length}개 통합, 이미지 ${moves.length}개 이동, 응답 ${respFixed}건 코드 변환`);
