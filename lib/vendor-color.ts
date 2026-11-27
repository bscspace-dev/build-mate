// 같은 구매처는 같은 색으로 보여 준다 (이름에서 색을 정한다). 창고현황이 쓴다.
export const VENDOR_COLORS = [
  'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200',
];
export const vendorColor = (name: string): string => {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return VENDOR_COLORS[h % VENDOR_COLORS.length];
};
