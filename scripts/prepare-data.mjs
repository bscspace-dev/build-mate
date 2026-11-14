// 사용법: node scripts/prepare-data.mjs
// ../자재통합/products.json + ./현장설문/trade_map.js  →  data/products.json, public/catalog/*
// 자재는 출처 사이트 구분 없이 하나로 통합돼 있다: 자재 번호 p0001…, 이미지는 폴더 하나(public/catalog/p0001.webp).
// 이미 data/products.json 이 있으면(관리자에서 삭제한 내용이 있으므로) 덮어쓰지 않는다. --force 로 강제 초기화.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const src = path.resolve(root, '..');
const force = process.argv.includes('--force');
const outJson = path.join(root, 'data', 'products.json');

if (fs.existsSync(outJson) && !force) {
  console.log('data/products.json 이 이미 있어 건너뜀 (초기화하려면 --force)');
  process.exit(0);
}
const { TRADES, assignTrades } = require(path.join(root, '현장설문', 'trade_map.js'));
const rows = JSON.parse(fs.readFileSync(path.join(src, '자재통합', 'products.json'), 'utf8'));
if (rows[0]?.source) {
  console.error('자재통합 데이터가 아직 통합 전 형식이에요. 먼저 node scripts/unify-catalog.mjs 를 실행하세요.');
  process.exit(1);
}

// 파일 내용(앞 12바이트)으로 실제 이미지 형식을 판별한다. 확장자와 실제 형식이 다른 파일이 있을 수 있다.
function realExt(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(12);
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
  if (b[0] === 0x89 && b[1] === 0x50) return '.png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return '.webp';
  if (b.subarray(0, 3).toString() === 'GIF') return '.gif';
  return path.extname(file).toLowerCase() || '.jpg';
}

fs.mkdirSync(path.join(root, 'public', 'catalog'), { recursive: true });
let copied = 0, missing = 0;
const products = rows.map((r, seq) => {
  const trades = assignTrades(r);
  const common = trades.length === TRADES.length; // 모든 공정에 나오는 공통 소모품(보양지·장갑 등)은 따로 모은다
  let image = '';
  const from = path.join(src, '자재통합', r.image_file || '');
  if (r.image_file && fs.existsSync(from)) {
    const rel = `catalog/${r.key}${realExt(from)}`; // 이미지는 폴더 하나에 자재 번호 이름으로
    fs.copyFileSync(from, path.join(root, 'public', rel));
    image = '/' + rel;
    copied++;
  } else missing++;
  return {
    seq, key: r.key, category: common ? '공통 소모품' : r.category, sub: common ? r.category : r.sub || '', name: r.name, brand: r.brand || '',
    price: r.price, priceInclVat: r.price_incl_vat ?? null, vatBasis: r.vat_basis, soldout: !!r.soldout,
    image, trades,
  };
});
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify(products), 'utf8');
fs.writeFileSync(path.join(root, 'data', 'trash.json'), '[]', 'utf8');
fs.writeFileSync(path.join(root, 'data', 'meta.json'), JSON.stringify({ trades: TRADES }), 'utf8');
console.log(`상품 ${products.length}개, 이미지 복사 ${copied}개, 이미지 없음 ${missing}개`);
