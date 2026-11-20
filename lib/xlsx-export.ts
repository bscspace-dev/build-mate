// 외부 라이브러리 없이 간단한 .xlsx 파일(시트 1장)을 만든다. 압축 없는 zip(store)으로 묶는다.
type Cell = string | number | null;

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 파일명
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.data.length, true);
    c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// images: 데이터 행(머리글 제외)마다 첫 열에 넣을 JPEG 바이트 (없으면 null). 있으면 행 높이를 키운다
export type Sheet = { name: string; header: string[]; rows: Cell[][]; widths?: number[]; images?: (Uint8Array | null)[] };
export const PHOTO_PX = 56;
const ROW_PT = 46;

// 시트 이름: 엑셀 규칙(31자 이하, \ / ? * [ ] : 금지)에 맞추고 중복이면 번호를 붙인다
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map(n => {
    const base = (n.replace(/[\\/?*[\]:]/g, " ").trim() || "시트").slice(0, 31);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = base.slice(0, 31 - String(i).length - 1) + "_" + i;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(header: string[], rows: Cell[][], widths: number[] = [], tall = false, drawing = false): string {
  const all: Cell[][] = [header, ...rows];
  const sheetRows = all.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = colName(c) + (r + 1);
      const style = r === 0 ? ' s="1"' : "";
      if (v === null || v === "") return `<c r="${ref}"${style}/>`;
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    });
    return `<row r="${r + 1}"${tall && r > 0 ? ` ht="${ROW_PT}" customHeight="1"` : ""}>${cells.join("")}</row>`;
  });
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sheetRows.join("")}</sheetData>${drawing ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
}

export function buildXlsx(sheets: Sheet[]): Blob {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const names = sheetNames(sheets.map(s => s.name));
  const n = sheets.length;
  const idx = sheets.map((_, i) => i + 1);
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  // 사진이 있는 시트: 그림 파일(drawing)과 이미지(media)를 따로 만든다
  const extra: { name: string; data: Uint8Array }[] = [];
  const drawingOf = new Set<number>();
  let imgNo = 0;
  sheets.forEach((s, i) => {
    const pics = (s.images ?? []).map((img, r) => ({ img, r })).filter(x => x.img);
    if (pics.length === 0) return;
    drawingOf.add(i + 1);
    const px = (v: number) => Math.round(v * 9525);
    const anchors: string[] = [];
    const rels: string[] = [];
    pics.forEach((x, k) => {
      imgNo++;
      extra.push({ name: `xl/media/image${imgNo}.jpeg`, data: x.img! });
      rels.push(`<Relationship Id="rId${k + 1}" Type="${R}/image" Target="../media/image${imgNo}.jpeg"/>`);
      anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${px(3)}</xdr:colOff><xdr:row>${x.r + 1}</xdr:row><xdr:rowOff>${px(2)}</xdr:rowOff></xdr:from><xdr:ext cx="${px(PHOTO_PX)}" cy="${px(PHOTO_PX)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="사진${k + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(PHOTO_PX)}" cy="${px(PHOTO_PX)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
    });
    extra.push({ name: `xl/drawings/drawing${i + 1}.xml`, data: enc.encode(`${X}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}">${anchors.join("")}</xdr:wsDr>`) });
    extra.push({ name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`, data: enc.encode(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`) });
    extra.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: enc.encode(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`) });
  });
  const files = [
    { name: "[Content_Types].xml", text: `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>${[...drawingOf].map(i => `<Override PartName="/xl/drawings/drawing${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join("")}<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${idx.map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", text: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", text: `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${idx.map(i => `<sheet name="${esc(names[i - 1])}" sheetId="${i}" r:id="rId${i}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map(i => `<Relationship Id="rId${i}" Type="${R}/worksheet" Target="worksheets/sheet${i}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", text: `${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Malgun Gothic"/></font><font><b/><sz val="11"/><name val="Malgun Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5EDFF"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.header, s.rows, s.widths, !!s.images, drawingOf.has(i + 1)) })),
  ];
  const bytes = zip([...files.map(f => ({ name: f.name, data: enc.encode(f.text) })), ...extra]);
  return new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
