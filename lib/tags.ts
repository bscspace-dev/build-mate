/** 연장 태그: 배열 또는 쉼표·#·줄바꿈으로 나눈 글자를 정리한다 (공백 정리·중복 제거·최대 10개·각 20자) */
export const normTags = (v: unknown): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,#\n]/) : [];
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
};
