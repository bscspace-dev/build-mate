import 'server-only';
import { NextResponse } from 'next/server';

/** 다른 사이트에서 몰래 보내는 요청(CSRF) 차단: Origin 이 있으면 우리 host 와 같아야 한다. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // 같은 출처의 단순 요청은 Origin 이 없을 수 있음 (쿠키는 sameSite=strict 로 보호)
  try {
    return new URL(origin).host === req.headers.get('host');
  } catch {
    return false;
  }
}

const hits = new Map<string, number[]>();
/** 메모리 기반 간단한 요청 제한. 초과하면 true. */
export function limited(req: Request, bucket: string, max: number, windowMs: number): boolean {
  // x-forwarded-for 는 누구나 마음대로 써서 보낼 수 있는 헤더라, 프록시 뒤에서 돌 때(TRUST_PROXY=true)만 믿는다.
  // 믿지 않을 때는 모든 요청을 한 묶음으로 센다 (이 PC에서만 쓸 때는 문제없다).
  const ip = (process.env.TRUST_PROXY === 'true' && req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()) || 'local';
  const k = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(k) ?? []).filter(t => now - t < windowMs);
  if (list.length >= max) {
    hits.set(k, list);
    return true;
  }
  list.push(now);
  hits.set(k, list);
  return false;
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
