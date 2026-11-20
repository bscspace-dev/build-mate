// 외부 라이브러리 없이 .xlsx 파일을 읽는다 (브라우저의 DecompressionStream 사용). 시트마다 문자열 표를 돌려준다.
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const b = new Uint8Array(buf);
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("엑셀(.xlsx) 파일이 아니에요.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("파일이 손상됐어요.");
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
    const raw = b.subarray(start, start + csize);
    if (/^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$/.test(name)) {
      out.set(name, method === 0 ? raw : method === 8 ? await inflateRaw(raw) : (() => { throw new Error("지원하지 않는 압축 방식이에요."); })());
    }
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

export type SheetData = { name: string; rows: string[][] };

export async function readXlsx(file: File): Promise<SheetData[]> {
  const files = await unzip(await file.arrayBuffer());
  const dec = new TextDecoder();
  const parse = (name: string) => {
    const f = files.get(name);
    return f ? new DOMParser().parseFromString(dec.decode(f), "application/xml") : null;
  };
  const shared: string[] = [];
  parse("xl/sharedStrings.xml")?.querySelectorAll("si").forEach(si => {
    shared.push([...si.querySelectorAll("t")].map(t => t.textContent ?? "").join(""));
  });
  const wb = parse("xl/workbook.xml");
  const names = wb ? [...wb.querySelectorAll("sheet")].map(s => s.getAttribute("name") ?? "") : [];
  const sheetFiles = [...files.keys()].filter(k => k.startsWith("xl/worksheets/")).sort((a, b) => parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")));
  return sheetFiles.map((f, i) => {
    const rows: string[][] = [];
    parse(f)?.querySelectorAll("sheetData > row").forEach(row => {
      const r: string[] = [];
      row.querySelectorAll(":scope > c").forEach(c => {
        const t = c.getAttribute("t");
        let val = "";
        if (t === "inlineStr") val = [...c.querySelectorAll("t")].map(x => x.textContent ?? "").join("");
        else {
          const raw = c.querySelector("v")?.textContent ?? "";
          val = t === "s" ? shared[Number(raw)] ?? "" : raw;
        }
        r[colIndex(c.getAttribute("r") ?? "A1")] = val;
      });
      rows.push(Array.from(r, x => x ?? ""));
    });
    return { name: names[i] ?? `시트${i + 1}`, rows };
  });
}
