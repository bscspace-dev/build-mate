// 사용법: node aggregate.js
// responses/ 폴더 안의 응답(.json / .txt)을 모두 읽어 현장설문_결과.xlsx 를 만든다.
// - .json : 작업자가 '파일로 저장'해서 보낸 파일
// - .txt  : 카톡으로 받은 '내용 복사' 텍스트를 붙여넣어 저장한 파일 (한 파일에 여러 건 붙여넣어도 됨)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const RESP_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'data', 'responses');
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, '현장설문_결과.xlsx');
const TRADE_ORDER = require('./trade_map.js').TRADES;

// ---- 카탈로그 ----
// 자재는 출처 사이트 구분 없이 하나로 통합돼 있고 자재 번호(p0001…)로 구분한다.
// 사이트의 현재 자재(휴지통 포함 — 지운 자재가 응답에 있어도 이름을 알 수 있게)를 우선 쓰고, 없으면 자재통합 파일을 쓴다.
const catalog = new Map();
const webData = path.join(__dirname, '..', 'data');
if (fs.existsSync(path.join(webData, 'products.json'))) {
  for (const f of ['products.json', 'trash.json']) {
    const p = path.join(webData, f);
    if (!fs.existsSync(p)) continue;
    for (const r of JSON.parse(fs.readFileSync(p, 'utf8'))) catalog.set(r.key, { ...r, vat_basis: r.vatBasis });
  }
} else {
  for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '자재통합', 'products.json'), 'utf8'))) catalog.set(r.key, r);
}

// ---- 응답 읽기 (텍스트 안의 최상위 { } 를 전부 추출) ----
function extractObjects(text) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (e) {} } }
  }
  return out;
}
fs.mkdirSync(RESP_DIR, { recursive: true });
const files = fs.readdirSync(RESP_DIR).filter(f => /\.(json|txt)$/i.test(f));
let raw = [], skipped = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(RESP_DIR, f), 'utf8').replace(/^﻿/, '');
  for (const o of extractObjects(text)) {
    if (o && o.v === 1 && typeof o.trade === 'string' && Array.isArray(o.items)) raw.push({ ...o, file: f });
    else skipped++;
  }
}
// 같은 사람(이름 있음)이 같은 공정을 다시 제출하면 최신 것만 사용, 완전히 같은 제출은 한 번만
const latest = new Map();
for (const r of raw.sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
  const name = (r.name || '').trim();
  latest.set(name ? `${name}|${r.trade}` : `${r.trade}|${r.at}|${r.items.length}`, r);
}
const responses = [...latest.values()];
if (!responses.length) { console.log('읽은 응답이 없습니다. responses/ 폴더에 파일을 넣어 주세요.'); process.exit(0); }

// ---- 집계 ----
const trades = [...new Set(responses.map(r => r.trade))].sort((a, b) => {
  const ia = TRADE_ORDER.indexOf(a), ib = TRADE_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'ko');
});
const byTrade = {};
for (const t of trades) byTrade[t] = { resp: responses.filter(r => r.trade === t), items: new Map(), customs: new Map() };
let unknownKeys = 0;
for (const r of responses) {
  const T = byTrade[r.trade];
  for (const k of new Set(r.items)) {
    if (!catalog.has(k)) { unknownKeys++; continue; }
    T.items.set(k, (T.items.get(k) || 0) + 1);
  }
  for (const c of r.custom || []) {
    const key = c.n.replace(/\s+/g, '').toLowerCase();
    if (!T.customs.has(key)) T.customs.set(key, { n: c.n, memos: new Set(), who: new Set(), cnt: 0 });
    const e = T.customs.get(key); e.cnt++; if (c.m) e.memos.add(c.m); e.who.add(r.name || '익명');
  }
}

// ---- 엑셀 ----
const wb = new ExcelJS.Workbook();
const HEAD = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CFF' } }, alignment: { vertical: 'middle', horizontal: 'center' } };
function sheet(name, cols, rows, opts = {}) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w }));
  ws.getRow(1).eachCell(c => Object.assign(c, HEAD)); ws.getRow(1).height = 22;
  rows.forEach(r => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  (opts.link || []).forEach(k => ws.getColumn(k).eachCell({ includeEmpty: false }, (c, n) => { if (n > 1 && c.value) { c.value = { text: '열기', hyperlink: String(c.value) }; c.font = { color: { argb: 'FF2B6CFF' }, underline: true }; } }));
  (opts.num || []).forEach(k => ws.getColumn(k).numFmt = '#,##0');
  (opts.pct || []).forEach(k => ws.getColumn(k).numFmt = '0%');
  return ws;
}

// 요약
sheet('요약', [
  { h: '공정', k: 'trade', w: 14 }, { h: '응답자 수', k: 'n', w: 11 }, { h: '선택된 품목 수(중복 제외)', k: 'u', w: 22 },
  { h: '품목당 평균 응답 수', k: 'avg', w: 18 }, { h: '직접 입력 품목 수', k: 'c', w: 16 },
], trades.map(t => {
  const T = byTrade[t]; const sum = [...T.items.values()].reduce((a, b) => a + b, 0);
  return { trade: t, n: T.resp.length, u: T.items.size, avg: T.items.size ? +(sum / T.items.size).toFixed(1) : 0, c: T.customs.size };
}));

// 공정별 시트
for (const t of trades) {
  const T = byTrade[t], n = T.resp.length;
  const rows = [...T.items.entries()].map(([k, cnt]) => ({ k, cnt, r: catalog.get(k) }))
    .sort((a, b) => b.cnt - a.cnt || a.r.category.localeCompare(b.r.category, 'ko') || a.r.name.localeCompare(b.r.name, 'ko'))
    .map((x, i) => ({
      rank: i + 1, cat: x.r.category, sub: x.r.sub, name: x.r.name, brand: x.r.brand, cnt: x.cnt, rate: x.cnt / n,
      price: x.r.price, vat: x.r.vat_basis,
    }));
  sheet(t, [
    { h: '순위', k: 'rank', w: 7 }, { h: '분류', k: 'cat', w: 16 }, { h: '세부분류', k: 'sub', w: 18 }, { h: '자재명', k: 'name', w: 48 },
    { h: '브랜드', k: 'brand', w: 16 }, { h: '응답 수', k: 'cnt', w: 9 }, { h: '선택률', k: 'rate', w: 9 },
    { h: '참고가격(원)', k: 'price', w: 13 }, { h: '가격 기준', k: 'vat', w: 11 },
  ], rows, { num: ['price'], pct: ['rate'] });
}

// 공정 × 품목 매트릭스
const all = new Set(); trades.forEach(t => byTrade[t].items.forEach((_, k) => all.add(k)));
const mrows = [...all].map(k => {
  const r = catalog.get(k); const row = { cat: r.category, sub: r.sub, name: r.name, brand: r.brand, total: 0 };
  trades.forEach((t, i) => { const v = byTrade[t].items.get(k) || 0; row['t' + i] = v || ''; row.total += v; });
  return row;
}).sort((a, b) => b.total - a.total || a.cat.localeCompare(b.cat, 'ko'));
sheet('공정×품목', [
  { h: '분류', k: 'cat', w: 16 }, { h: '세부분류', k: 'sub', w: 18 }, { h: '자재명', k: 'name', w: 48 }, { h: '브랜드', k: 'brand', w: 16 },
  ...trades.map((t, i) => ({ h: t, k: 't' + i, w: 9 })), { h: '합계', k: 'total', w: 9 },
], mrows);

// 직접 입력
const crow = [];
for (const t of trades) for (const e of byTrade[t].customs.values()) crow.push({ trade: t, n: e.n, cnt: e.cnt, memo: [...e.memos].join(' / '), who: [...e.who].join(', ') });
crow.sort((a, b) => TRADE_ORDER.indexOf(a.trade) - TRADE_ORDER.indexOf(b.trade) || b.cnt - a.cnt);
sheet('직접입력 품목', [
  { h: '공정', k: 'trade', w: 12 }, { h: '품목명', k: 'n', w: 34 }, { h: '언급 수', k: 'cnt', w: 9 }, { h: '메모(규격·용도)', k: 'memo', w: 44 }, { h: '입력한 사람', k: 'who', w: 24 },
], crow);

// 응답 원본
sheet('응답 목록', [
  { h: '이름', k: 'name', w: 18 }, { h: '공정', k: 'trade', w: 12 }, { h: '제출 시각', k: 'at', w: 20 },
  { h: '선택 수', k: 'n', w: 9 }, { h: '직접 입력 수', k: 'c', w: 12 }, { h: '파일', k: 'file', w: 36 },
], responses.map(r => ({ name: r.name || '(익명)', trade: r.trade, at: r.at ? new Date(r.at).toLocaleString('ko-KR') : '', n: new Set(r.items).size, c: (r.custom || []).length, file: r.file })));

wb.xlsx.writeFile(OUT).then(() => {
  console.log(`엑셀 생성: ${OUT}`);
  console.log(`응답 ${responses.length}건 (공정 ${trades.length}개: ${trades.join(', ')}) / 직접입력 ${crow.length}종`);
  if (skipped) console.log(`형식이 맞지 않아 건너뜀: ${skipped}건`);
  if (unknownKeys) console.log(`카탈로그에 없는 품목 코드 무시: ${unknownKeys}건`);
});
