import 'server-only';
import dns from 'node:dns/promises';
import net from 'node:net';

// 쇼핑몰 상품 링크를 서버가 열어서 가격을 읽는다 (공식 API가 아니라 페이지의 표준 가격 표기를 읽는 방식).
//  · JSON-LD(Product/Offer) → og:price / product:price 메타 → itemprop="price" 순으로 찾는다.
//  · 사이트가 봇을 막거나 가격을 나중에 자바스크립트로 채우면 읽지 못한다 (그때는 직접 입력).
//  · 서버가 사용자가 준 주소를 여는 기능이라, 내부망·로컬 주소는 막고 응답 크기·시간도 제한한다.
export type PageResult = { price: number; title: string; mall: string };
export type PageFail = 'bad-url' | 'blocked-host' | 'fetch' | 'no-price';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function hostOk(host: string): Promise<boolean> {
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (net.isIP(host)) return !privateIp(host);
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.length > 0 && addrs.every(a => !privateIp(a.address));
  } catch {
    return false;
  }
}

async function readHtml(start: string): Promise<{ ok: true; html: string; finalUrl: string } | { ok: false; reason: PageFail }> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { return { ok: false, reason: 'bad-url' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'bad-url' };
    if (!(await hostOk(u.hostname))) return { ok: false, reason: 'blocked-host' };
    let res: Response;
    try {
      res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ko-KR,ko;q=0.9' }, cache: 'no-store' });
    } catch {
      return { ok: false, reason: 'fetch' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { ok: false, reason: 'fetch' };
      url = new URL(loc, u).toString(); // 다음 바퀴에서 이 주소도 다시 검사한다
      continue;
    }
    if (!res.ok) return { ok: false, reason: 'fetch' };
    const type = res.headers.get('content-type') ?? '';
    if (type && !/html|xml/i.test(type)) return { ok: false, reason: 'no-price' };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: 'fetch' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > MAX_BYTES) { await reader.cancel(); break; } // 너무 크면 앞부분만 본다
      }
    } catch {
      return { ok: false, reason: 'fetch' };
    }
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(Buffer.concat(chunks)); } catch { html = Buffer.concat(chunks).toString('utf8'); }
    return { ok: true, html, finalUrl: u.toString() };
  }
  return { ok: false, reason: 'fetch' };
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const toPrice = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n >= 100 && n <= 99_999_999 ? Math.round(n) : 0; // 100원 미만은 가격이 아닌 값으로 본다
};

function metaOf(html: string, key: string): string {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  return tag ? decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '') : '';
}

/** JSON-LD 안에서 Product 의 가격(여러 판매자면 가장 낮은 값)을 찾는다 */
function jsonLd(html: string): { price: number; name: string } {
  let price = 0, name = '';
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const walk = (n: unknown, inProduct: boolean): void => {
    if (Array.isArray(n)) { n.forEach(x => walk(x, inProduct)); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const t = ([] as unknown[]).concat(o['@type'] ?? []).map(String);
    const prod = inProduct || t.includes('Product') || t.includes('ProductGroup');
    if (t.includes('Product') && !name && typeof o.name === 'string') name = o.name;
    if (prod) {
      for (const k of ['price', 'lowPrice']) {
        const p = toPrice(o[k]);
        if (p && (!price || p < price)) price = p;
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, prod);
  };
  for (const s of scripts) {
    try { walk(JSON.parse(decode(s[1]).replace(/^﻿/, '')), false); } catch { /* 깨진 JSON-LD는 건너뛴다 */ }
  }
  return { price, name };
}

export function parsePrice(html: string): { price: number; title: string } {
  const ld = jsonLd(html);
  const title = ld.name || metaOf(html, 'og:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  if (ld.price) return { price: ld.price, title };
  for (const k of ['product:price:amount', 'og:price:amount', 'product:sale_price:amount', 'twitter:data1']) {
    const p = toPrice(metaOf(html, k));
    if (p) return { price: p, title };
  }
  const item = /itemprop=["']price["'][^>]*?(?:content=["']([^"']+)["'])/i.exec(html)?.[1];
  const p = toPrice(item);
  return { price: p, title };
}

/** 상품 링크에서 가격을 읽는다 */
export async function priceFromUrl(url: string): Promise<{ ok: true; result: PageResult } | { ok: false; reason: PageFail }> {
  const page = await readHtml(url);
  if (!page.ok) return page;
  const { price, title } = parsePrice(page.html);
  if (!price) return { ok: false, reason: 'no-price' };
  const host = new URL(page.finalUrl).hostname.replace(/^(www|m|mobile)\./, '');
  return { ok: true, result: { price, title: title.slice(0, 120), mall: host } };
}

export const FAIL_TEXT: Record<PageFail, string> = {
  'bad-url': '링크 주소가 올바르지 않아요. http:// 또는 https:// 로 시작하는 상품 주소를 넣어 주세요.',
  'blocked-host': '이 주소는 열 수 없어요. 인터넷의 쇼핑몰 상품 주소를 넣어 주세요.',
  fetch: '쇼핑몰에서 페이지를 가져오지 못했어요. 사이트가 자동 접속을 막았을 수 있어요. 가격을 직접 적어 주세요.',
  'no-price': '페이지에서 가격을 찾지 못했어요. 상품 상세 주소가 맞는지 확인하고, 안 되면 가격을 직접 적어 주세요.',
};
