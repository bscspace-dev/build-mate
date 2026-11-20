// 세부분류는 "공정>카테고리" 로 시작한다. 예) 구조>목공, 구조>목공>MDF
// 서버(저장)와 화면(즉시 반영)이 똑같은 규칙을 쓰도록 순수 함수로 둔다.
const norm = (s: string) => String(s ?? '').split('>').map(x => x.trim()).filter(Boolean).join('>');

/** 카테고리의 앞머리: 공정이 지정돼 있으면 "공정>카테고리", 아니면 카테고리 이름만 */
export function headOf(category: string, catTrades: Record<string, string>, trades: string[]): string {
  const t = catTrades[category] ?? '';
  return [trades.includes(t) ? t : '', category].filter(Boolean).join('>');
}

/** 세부분류를 새 앞머리로 바꾼다. 앞머리 뒤에 붙은 직접 입력 부분(MDF 등)은 그대로 둔다. */
export function rewriteSub(sub: string, oldHead: string, newHead: string): string {
  const cur = norm(sub);
  if (cur === oldHead) return newHead;
  if (oldHead && cur.startsWith(oldHead + '>')) return newHead + cur.slice(oldHead.length);
  if (cur === newHead || cur.startsWith(newHead + '>')) return cur;
  return cur ? `${newHead}>${cur}` : newHead;
}
