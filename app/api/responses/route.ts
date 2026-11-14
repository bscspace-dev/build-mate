import { getProducts, getTrash, saveResponse } from '@/lib/db';
import { json, limited, sameOrigin } from '@/lib/guard';
import type { SurveyPayload } from '@/lib/types';
import { getSessionMember } from '@/lib/member-session';
import { canSurvey } from '@/lib/roles';

// 설문 제출 (현장작업자·현장관리자(PM)만). 로그인 세션으로 누군지 확인하고, 이름·공정은 등록된 값으로만 저장한다(보낸 값은 믿지 않음).
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);
  if (limited(req, 'resp', 30, 10 * 60 * 1000)) return json({ error: '잠시 후 다시 해 주세요.' }, 429);

  const raw = await req.text();
  if (raw.length > 300_000) return json({ error: '내용이 너무 커요.' }, 413);
  let b: Record<string, unknown>;
  try {
    b = JSON.parse(raw);
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const worker = await getSessionMember();
  if (!worker) return json({ error: '로그인이 필요해요. 다시 로그인해 주세요.' }, 401);
  if (!canSurvey(worker.role, worker.menus)) return json({ error: '설문 참여 권한이 없어요. 최고 관리자나 개발팀에 요청해 주세요.' }, 403);
  const trade = typeof b.trade === 'string' ? b.trade : '';
  if (b.v !== 1 || !worker.trades.includes(trade)) return json({ error: '등록된 공정이 아니에요.' }, 400);
  if (!Array.isArray(b.items) || b.items.length > 3000 || !b.items.every(k => typeof k === 'string')) return json({ error: 'bad items' }, 400);

  // 이 사이트 카탈로그(삭제된 것 포함)에 있는 코드만 인정
  const [products, trash] = await Promise.all([getProducts(), getTrash()]);
  const known = new Set([...products, ...trash].map(p => p.key));
  const items = [...new Set(b.items as string[])].filter(k => known.has(k));

  const custom: SurveyPayload['custom'] = [];
  if (Array.isArray(b.custom)) {
    for (const c of b.custom.slice(0, 50)) {
      const n = c && typeof (c as { n?: unknown }).n === 'string' ? (c as { n: string }).n.trim().slice(0, 80) : '';
      const m = c && typeof (c as { m?: unknown }).m === 'string' ? (c as { m: string }).m.trim().slice(0, 200) : '';
      if (n) custom.push({ n, m });
    }
  }
  if (!items.length && !custom.length) return json({ error: '선택한 자재가 없어요.' }, 400);

  const id = await saveResponse({ v: 1, workerId: worker.id, name: worker.name, trade, at: new Date().toISOString(), items, custom });
  return json({ ok: true, id });
}
