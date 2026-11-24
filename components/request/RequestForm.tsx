"use client";

import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { SurveyItem } from "@/lib/catalog";
import { Modal, Sheet } from "@/components/Sheet";
import { sitePeriod } from "@/lib/site-period";

const PAGE = 18; // 한 페이지 품목 수 (2열·3열 모두 줄이 딱 떨어지는 수)
const MAX_QTY = 99999;
const SITES_KEY = "bm_recent_sites";

// 최근에 쓴 현장 이름 (이 기기에만 저장)
function readSites(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(SITES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}
function writeSites(site: string) {
  try {
    window.localStorage.setItem(SITES_KEY, JSON.stringify([site, ...readSites().filter(s => s !== site)].slice(0, 5)));
  } catch {
    // 저장 못 해도 요청에는 문제없다
  }
}

// 별표(즐겨찾기)한 자재 (이 기기에만, 이름별로 저장)
const starKey = (who: string) => `bm_stars_${who}`;
const STAR_EVENT = "bm-stars-change";
function subscribeStars(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(STAR_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(STAR_EVENT, cb); };
}
function readStarsRaw(who: string): string {
  try {
    return window.localStorage.getItem(starKey(who)) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseStars(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeStars(who: string, keys: string[]) {
  try {
    window.localStorage.setItem(starKey(who), JSON.stringify(keys));
  } catch {
    // 저장 못 해도 요청에는 문제없다
  }
  window.dispatchEvent(new Event(STAR_EVENT));
}

const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";

type Sel = Record<string, number>; // 자재 코드 → 수량 (0 = 아직 안 적음)
type Custom = { id: number; n: string; q: number }; // 목록에 없어서 직접 적는 품목

const Card = memo(function Card({ item, qty, starred, onToggle, onQty, onStar }: { item: SurveyItem; qty: number | undefined; starred: boolean; onToggle: (k: string) => void; onQty: (k: string, q: number) => void; onStar: (k: string) => void }) {
  const on = qty !== undefined;
  return (
    <div className={`relative overflow-hidden rounded-2xl border-2 bg-white transition-colors dark:bg-zinc-900 ${on ? "border-blue-600 ring-2 ring-blue-600/20" : "border-black/10 dark:border-white/10"}`}>
      <button type="button" onClick={() => onToggle(item.k)} aria-pressed={on} className="relative block w-full text-left">
        {item.i ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.i} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
        ) : (
          <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-800" />
        )}
        <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? "bg-blue-600 text-white" : "bg-black/55 text-white"}`}>{on ? "✓ 담김" : "🛒 담기"}</span>
        <div className="p-2.5 pb-1.5">
          <b className="line-clamp-3 min-h-[3.9em] text-[13px] font-semibold leading-snug break-keep">{item.n}</b>
        </div>
      </button>
      <button type="button" onClick={() => onStar(item.k)} aria-pressed={starred} aria-label={`${item.n} 별표 ${starred ? "해제" : "등록"}`} className={`absolute right-1 top-9 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none drop-shadow ${starred ? "text-amber-400" : "text-zinc-300 hover:text-amber-300"}`}>
        {starred ? "★" : "☆"}
      </button>
      <div className="px-2.5 pb-2.5">
        {on ? (
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="수량 줄이기" onClick={() => onQty(item.k, Math.max(1, (qty || 1) - 1))} className="h-9 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">−</button>
            <input
              type="text"
              inputMode="numeric"
              aria-label={`${item.n} 수량`}
              value={qty ? String(qty) : ""}
              placeholder="수량"
              onChange={e => onQty(item.k, Math.min(MAX_QTY, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0))}
              className={`h-9 min-w-0 flex-1 rounded-lg border bg-transparent text-center text-base font-bold outline-none focus:border-blue-500 ${qty ? "border-black/15 dark:border-white/15" : "border-red-400"}`}
            />
            <button type="button" aria-label="수량 늘리기" onClick={() => onQty(item.k, Math.min(MAX_QTY, (qty || 0) + 1))} className="h-9 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">+</button>
          </div>
        ) : (
          <div className="h-9" aria-hidden />
        )}
      </div>
    </div>
  );
});

export default function RequestForm({
  items, sites, allTrades, workerName, myTrades, myCategories,
}: {
  items: SurveyItem[];
  sites: { name: string; startDate: string; endDate: string }[]; // 관리자가 등록한 현장 (요청할 때 이 중에서 고른다)
  allTrades: string[]; // 자재의 공정 비트마스크 기준이 되는 전체 공정 목록
  workerName: string;
  myTrades: string[]; // 관리자가 등록한 공정 (1~3개)
  myCategories: string[]; // 관리자가 정해 준 내 카테고리 (이 순서대로 먼저 보인다)
}) {
  const router = useRouter();
  const [trade, setTrade] = useState(myTrades[0] ?? "");
  const [sels, setSels] = useState<Record<string, Sel>>({}); // 공정별 선택 (공정을 오가도 유지)
  const [customs, setCustoms] = useState<Record<string, Custom[]>>({}); // 공정별 직접 적은 품목
  const [cat, setCat] = useState("전체");
  const [onlyStar, setOnlyStar] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [cartOpen, setCartOpen] = useState(false); // 장바구니
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [siteOpen, setSiteOpen] = useState(false); // 현장 확인 창
  const [site, setSite] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [siteErr, setSiteErr] = useState("");
  const [siteQ, setSiteQ] = useState(""); // 현장 목록이 길 때 찾기
  const siteNames = useMemo(() => sites.map(s => s.name), [sites]);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const toastId = toast?.id;
  useEffect(() => {
    if (toastId == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastId ? null : cur)), 3500);
    return () => window.clearTimeout(t);
  }, [toastId]);

  const starsRaw = useSyncExternalStore(subscribeStars, () => readStarsRaw(workerName), () => "[]");
  const stars = useMemo(() => parseStars(starsRaw), [starsRaw]);
  const starSet = useMemo(() => new Set(stars), [stars]);
  const onStar = useCallback((k: string) => {
    const cur = parseStars(readStarsRaw(workerName));
    writeStars(workerName, cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]);
  }, [workerName]);

  const bit = allTrades.indexOf(trade);
  // 내 카테고리(관리자가 정한 순서)의 품목과 칩이 먼저 나오고, 나머지는 원래 순서대로 뒤에 붙는다
  const catRank = useMemo(() => new Map(myCategories.map((c, i) => [c, i])), [myCategories]);
  const base = useMemo(() => (bit < 0 ? [] : items.filter(i => i.t & (1 << bit)).sort((a, b) => (catRank.get(a.c) ?? 1e6) - (catRank.get(b.c) ?? 1e6))), [items, bit, catRank]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach(i => m.set(i.c, (m.get(i.c) ?? 0) + 1));
    return m;
  }, [base]);
  // "전체" 탭은 없다: 고른 카테고리가 없거나 이 공정에 없으면 첫 번째(내 카테고리가 있으면 그것부터) 카테고리가 열린다
  const activeCat = cats.has(cat) ? cat : (cats.keys().next().value ?? "");
  const starCount = useMemo(() => base.filter(i => starSet.has(i.k)).length, [base, starSet]);
  const starOnly = onlyStar && starCount > 0;
  const list = useMemo(() => {
    const kw = q.trim().replace(/\s+/g, "").toLowerCase();
    const r = base.filter(i => (!starOnly || starSet.has(i.k)) && (kw !== "" || starOnly || i.c === activeCat) && (!kw || `${i.n}${i.b}${i.s}`.replace(/\s+/g, "").toLowerCase().includes(kw)));
    return r.sort((x, y) => Number(starSet.has(y.k)) - Number(starSet.has(x.k))); // 별표한 품목은 항상 맨 앞 (나머지는 그대로의 순서)
  }, [base, activeCat, q, starOnly, starSet]);

  const sel = sels[trade] ?? {};
  const picked = Object.keys(sel);
  const myCustoms = customs[trade] ?? [];
  const count = picked.length + myCustoms.length;
  const byKey = useMemo(() => new Map(items.map(i => [i.k, i])), [items]);

  function pickTrade(t: string) {
    setTrade(t);
    setCat("전체");
    setQ("");
    setPage(1);
    setErr("");
  }
  const onToggle = (k: string) =>
    setSels(prev => {
      const cur = { ...(prev[trade] ?? {}) };
      if (k in cur) delete cur[k];
      else cur[k] = 1;
      return { ...prev, [trade]: cur };
    });
  const onQty = (k: string, n: number) => setSels(prev => ({ ...prev, [trade]: { ...(prev[trade] ?? {}), [k]: n } }));
  const nextId = () => Math.max(0, ...Object.values(customs).flat().map(c => c.id)) + 1;
  const [draftN, setDraftN] = useState(""); // 목록에 없는 품목: 이름·수량을 적고 '담기'
  const [draftQ, setDraftQ] = useState(1);
  function addDraft() {
    const n = draftN.trim().replace(/\s+/g, " ");
    if (!n) return setErr("담을 품목의 이름을 적어 주세요.");
    if (draftQ < 1) return setErr("수량을 적어 주세요.");
    setErr("");
    setCustoms(prev => ({ ...prev, [trade]: [...(prev[trade] ?? []), { id: nextId(), n, q: draftQ }] }));
    setDraftN("");
    setDraftQ(1);
    setToast(prev => ({ id: (prev?.id ?? 0) + 1, text: `“${n}” ${draftQ}개를 장바구니에 담았어요` }));
  }
  const setCustom = (id: number, patch: Partial<Custom>) => setCustoms(prev => ({ ...prev, [trade]: (prev[trade] ?? []).map(c => (c.id === id ? { ...c, ...patch } : c)) }));
  const dropCustom = (id: number) => setCustoms(prev => ({ ...prev, [trade]: (prev[trade] ?? []).filter(c => c.id !== id) }));

  // 요청하기를 누르면 먼저 어떤 현장의 요청인지 확인한다
  function askSite() {
    if (busy || !count) return;
    const bad = picked.find(k => !sel[k] || sel[k] < 1);
    if (bad) return setErr(`“${byKey.get(bad)?.n ?? ""}”의 수량을 적어 주세요.`);
    const badCustom = myCustoms.find(c => !c.n.trim() || c.q < 1);
    if (badCustom) return setErr(!badCustom.n.trim() ? "직접 적는 품목의 이름을 적어 주세요." : `“${badCustom.n.trim()}”의 수량을 적어 주세요.`);
    setErr("");
    setSiteErr("");
    const r = readSites().filter(x => siteNames.includes(x)); // 최근에 쓴 현장 중 아직 등록돼 있는 것만
    setRecent(r);
    setSite(s => (siteNames.includes(s) ? s : r[0] ?? ""));
    setSiteQ("");
    setSiteOpen(true);
  }

  async function submit() {
    const name = site;
    if (!name || !siteNames.includes(name)) return setSiteErr("요청할 현장을 골라 주세요.");
    if (busy || !count) return;
    setBusy(true);
    setSiteErr("");
    setErr("");
    try {
      const r = await fetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trade, site: name, items: picked.map(k => ({ k, q: sel[k] })), customs: myCustoms.map(c => ({ n: c.n.trim(), q: c.q })) }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; count?: number };
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) setSiteErr(j.error ?? "요청을 보내지 못했어요.");
      else {
        writeSites(name);
        setSiteOpen(false);
        setSels(prev => ({ ...prev, [trade]: {} }));
        setCustoms(prev => ({ ...prev, [trade]: [] }));
        setToast(prev => ({ id: (prev?.id ?? 0) + 1, text: `${trade} 공정 자재 ${j.count ?? count}개를 요청했어요` }));
      }
    } catch {
      setSiteErr("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  // 페이지 나누기
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE));
  const curPage = Math.min(page, totalPages);
  const visible = list.slice((curPage - 1) * PAGE, curPage * PAGE);
  const goPage = (n: number) => { setPage(Math.max(1, Math.min(totalPages, n))); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1).filter(n => n === 1 || n === totalPages || Math.abs(n - curPage) <= 2);
  const totalQty = picked.reduce((n, k) => n + (sel[k] || 0), 0) + myCustoms.reduce((n, c) => n + (c.q || 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32">
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">{workerName}님, 자재 요청</h1>
      </div>

      <p className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm leading-relaxed text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
        필요한 자재를 <b>눌러서 고르고</b>, 자재마다 <b>수량</b>을 적은 뒤 <b>요청하기</b>를 눌러 주세요. 목록에 없는 자재는 <b>직접 적어서</b> 요청할 수 있어요. 요청은 관리자의 “자재요청 현황”으로 전달돼요.
      </p>

      {myTrades.length === 0 ? (
        <p className="py-20 text-center text-zinc-500">등록된 공정이 없어요. 관리자에게 공정 등록을 요청해 주세요.</p>
      ) : (
        <>
          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto" role="tablist" aria-label="내 공정">
            {myTrades.map(t => {
              const n = Object.keys(sels[t] ?? {}).length + (customs[t] ?? []).length;
              return (
                <button key={t} type="button" role="tab" aria-selected={trade === t} onClick={() => pickTrade(t)} className={`${chipBase} px-4 py-2 text-[15px] ${trade === t ? chipOn : chipOff}`}>
                  {t}
                  {n > 0 && <small className="ml-1.5 rounded-full bg-white/25 px-1.5 text-xs">{n}</small>}
                </button>
              );
            })}
          </div>

          <input
            type="search"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
            placeholder="자재명 검색 (예: 합판, 피스)"
            aria-label="자재 검색"
            className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
          />

          <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
            <button type="button" aria-pressed={starOnly} onClick={() => { setOnlyStar(v => !v); setPage(1); }} className={`${chipBase} text-[13px] ${starOnly ? "border-amber-400 bg-amber-400 font-semibold text-white" : chipOff}`}>
              ★ 별표<small className="ml-1 opacity-70">{starCount}</small>
            </button>
            {[...cats.keys()].map(c => (
              <button key={c} type="button" onClick={() => { setCat(c); setPage(1); }} className={`${chipBase} text-[13px] ${activeCat === c && !starOnly && !q.trim() ? chipOn : chipOff}`}>
                {catRank.has(c) && <span aria-hidden className="mr-1">📌</span>}{c}<small className="ml-1 opacity-70">{cats.get(c)}</small>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {visible.map(i => (
              <Card key={i.k} item={i} qty={sel[i.k]} starred={starSet.has(i.k)} onToggle={onToggle} onQty={onQty} onStar={onStar} />
            ))}
          </div>
          {list.length === 0 && <p className="py-10 text-center text-zinc-500">해당하는 자재가 없어요</p>}
          {totalPages > 1 && (
            <nav className="mt-4 flex flex-wrap items-center justify-center gap-1.5" aria-label="페이지">
              <button type="button" disabled={curPage <= 1} onClick={() => goPage(curPage - 1)} className={`${chipBase} ${chipOff} disabled:opacity-30`}>‹ 이전</button>
              {pageNums.map((n, i) => (
                <span key={n} className="flex items-center gap-1.5">
                  {i > 0 && n - pageNums[i - 1] > 1 && <span className="text-zinc-400" aria-hidden>…</span>}
                  <button type="button" aria-current={n === curPage ? "page" : undefined} onClick={() => goPage(n)} className={`${chipBase} min-w-9 px-2.5 ${n === curPage ? chipOn : chipOff}`}>{n}</button>
                </span>
              ))}
              <button type="button" disabled={curPage >= totalPages} onClick={() => goPage(curPage + 1)} className={`${chipBase} ${chipOff} disabled:opacity-30`}>다음 ›</button>
              <span className="w-full text-center text-xs text-zinc-500">{list.length}개 중 {(curPage - 1) * PAGE + 1}–{Math.min(curPage * PAGE, list.length)}번</span>
            </nav>
          )}
          <section className="mt-6 rounded-2xl border border-dashed border-amber-400 bg-amber-50/60 p-4 dark:bg-amber-500/5" aria-label="목록에 없는 품목">
            <b className="text-[15px]">필요한 품목이 목록에 없나요?</b>
            <p className="mt-1 text-sm text-zinc-500">품목 이름(규격·용도 포함)과 수량을 적고 <b>🛒 담기</b>를 누르면 장바구니에 들어가요.</p>
            <form className="mt-3 flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); addDraft(); }}>
              <input value={draftN} maxLength={100} onChange={e => setDraftN(e.target.value)} placeholder="품목 이름 (규격·용도도 같이)" aria-label="품목 이름" className="h-10 min-w-0 flex-[3] rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
              <button type="button" aria-label="수량 줄이기" onClick={() => setDraftQ(q => Math.max(1, q - 1))} className="h-10 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">−</button>
              <input inputMode="numeric" value={draftQ ? String(draftQ) : ""} placeholder="수량" aria-label="수량" onChange={e => setDraftQ(Math.min(MAX_QTY, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0))} className={`h-10 w-14 shrink-0 rounded-lg border bg-white text-center text-base font-bold outline-none focus:border-blue-500 dark:bg-zinc-900 ${draftQ ? "border-black/15 dark:border-white/15" : "border-red-400"}`} />
              <button type="button" aria-label="수량 늘리기" onClick={() => setDraftQ(q => Math.min(MAX_QTY, q + 1))} className="h-10 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">+</button>
              <button className="h-10 shrink-0 rounded-lg bg-amber-500 px-3.5 text-sm font-bold text-white">🛒 담기</button>
            </form>
            {myCustoms.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="담은 직접 적은 품목">
                {myCustoms.map(c => (
                  <span key={c.id} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm shadow-sm dark:bg-zinc-900">
                    ✏️ {c.n} <b>×{c.q}</b>
                    <button type="button" aria-label={`${c.n} 빼기`} onClick={() => dropCustom(c.id)} className="ml-0.5 text-zinc-400 hover:text-red-600">✕</button>
                  </span>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="mr-auto min-w-0 text-sm">
            <b>{trade || "공정 없음"}</b> · 자재 {count}개{count > 0 && <> · 수량 합계 {totalQty}</>}
            {err && <p className="truncate text-xs text-red-500" role="alert">{err}</p>}
          </div>
          <button type="button" onClick={() => setCartOpen(true)} className="relative shrink-0 rounded-xl border border-black/15 bg-white px-3.5 py-3 text-base font-bold dark:border-white/15 dark:bg-zinc-900" aria-label={`장바구니 ${count}개`}>
            🛒 장바구니
            {count > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[11px] font-bold text-white">{count}</span>}
          </button>
          <motion.button type="button" disabled={busy || count === 0} onClick={askSite} className="shrink-0 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:opacity-40">
            요청하기
          </motion.button>
        </div>
      </div>

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)}>
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">🛒 장바구니 <span className="text-sm font-semibold text-zinc-500">· {trade} 공정</span></h2>
          <button type="button" onClick={() => setCartOpen(false)} className="rounded-lg px-2 py-1 text-sm text-zinc-500">닫기</button>
        </div>
        {count === 0 ? (
          <p className="py-10 text-center text-zinc-500">담은 자재가 없어요. 자재 카드를 눌러 담아 주세요.</p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-black/5 dark:divide-white/10">
              {picked.map(k => {
                const it = byKey.get(k);
                const q2 = sel[k];
                return (
                  <li key={k} className="flex items-center gap-2 py-2.5">
                    {it?.i ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.i} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain" />
                    ) : <span className="h-12 w-12 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold leading-snug break-keep">{it?.n ?? k}</span>
                    </span>
                    <button type="button" aria-label="수량 줄이기" onClick={() => onQty(k, Math.max(1, (q2 || 1) - 1))} className="h-9 w-8 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">−</button>
                    <input inputMode="numeric" aria-label={`${it?.n ?? k} 수량`} value={q2 ? String(q2) : ""} placeholder="수량" onChange={e => onQty(k, Math.min(MAX_QTY, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0))} className={`h-9 w-12 shrink-0 rounded-lg border bg-transparent text-center text-base font-bold outline-none focus:border-blue-500 ${q2 ? "border-black/15 dark:border-white/15" : "border-red-400"}`} />
                    <button type="button" aria-label="수량 늘리기" onClick={() => onQty(k, Math.min(MAX_QTY, (q2 || 0) + 1))} className="h-9 w-8 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">+</button>
                    <button type="button" aria-label="장바구니에서 빼기" onClick={() => onToggle(k)} className="h-9 w-8 shrink-0 rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15">✕</button>
                  </li>
                );
              })}
              {myCustoms.map(c => (
                <li key={c.id} className="flex items-center gap-2 py-2.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xl dark:bg-amber-500/20" aria-hidden>✏️</span>
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-snug break-keep">{c.n}<small className="block text-[11px] font-normal text-zinc-500">직접 적은 품목</small></span>
                  <button type="button" aria-label="수량 줄이기" onClick={() => setCustom(c.id, { q: Math.max(1, (c.q || 1) - 1) })} className="h-9 w-8 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">−</button>
                  <input inputMode="numeric" aria-label={`${c.n} 수량`} value={c.q ? String(c.q) : ""} placeholder="수량" onChange={e => setCustom(c.id, { q: Math.min(MAX_QTY, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0) })} className={`h-9 w-12 shrink-0 rounded-lg border bg-transparent text-center text-base font-bold outline-none focus:border-blue-500 ${c.q ? "border-black/15 dark:border-white/15" : "border-red-400"}`} />
                  <button type="button" aria-label="수량 늘리기" onClick={() => setCustom(c.id, { q: Math.min(MAX_QTY, (c.q || 0) + 1) })} className="h-9 w-8 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">+</button>
                  <button type="button" aria-label="장바구니에서 빼기" onClick={() => dropCustom(c.id)} className="h-9 w-8 shrink-0 rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15">✕</button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-right text-sm">자재 <b>{count}개</b> · 수량 합계 <b>{totalQty}</b></p>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setCartOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">계속 담기</button>
          <button type="button" disabled={busy || count === 0} onClick={() => { setCartOpen(false); askSite(); }} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">요청하기</button>
        </div>
      </Sheet>

      <Modal open={siteOpen} onClose={() => !busy && setSiteOpen(false)}>
        <h2 className="text-lg font-bold">어떤 현장의 요청인가요?</h2>
        <p className="mt-1 text-sm text-zinc-500">{trade} 공정 · 자재 {count}개 · 수량 합계 {totalQty}</p>
        {sites.length === 0 ? (
          <p className="mt-4 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">등록된 현장이 없어요. 관리자에게 현장 등록을 요청해 주세요.</p>
        ) : (
          <>
            <div className="mt-4 text-sm font-bold">현장 선택</div>
            {sites.length > 6 && <input value={siteQ} onChange={e => setSiteQ(e.target.value)} placeholder="현장 찾기" aria-label="현장 찾기" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />}
            <div className="mt-2 max-h-[40vh] space-y-1.5 overflow-y-auto pr-0.5" role="radiogroup" aria-label="현장">
              {sites.filter(x => !siteQ.trim() || x.name.replace(/\s+/g, "").toLowerCase().includes(siteQ.trim().replace(/\s+/g, "").toLowerCase())).map(x => {
                const p = sitePeriod(x.startDate, x.endDate);
                const on = site === x.name;
                return (
                  <button key={x.name} type="button" role="radio" aria-checked={on} onClick={() => setSite(x.name)} className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-[15px] ${on ? "border-blue-600 bg-blue-50 font-bold ring-2 ring-blue-600/30 dark:bg-blue-500/15" : p.urgent ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] text-white ${on ? "border-blue-600 bg-blue-600" : "border-zinc-300 dark:border-zinc-600"}`} aria-hidden>{on ? "✓" : ""}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{x.name}</span>
                      {(x.startDate || x.endDate) && <small className={`block text-xs font-normal ${p.urgent ? "font-bold text-red-600 dark:text-red-300" : "text-zinc-500"}`}>{p.text}</small>}
                    </span>
                    {p.urgent && p.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${p.badge.cls}`}>{p.badge.label}</span>}
                    {recent[0] === x.name && <small className="shrink-0 text-xs font-normal text-zinc-500">최근 사용</small>}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {siteErr && <p className="mt-3 text-sm text-red-500" role="alert">{siteErr}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => setSiteOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button type="button" disabled={busy || !siteNames.includes(site)} onClick={submit} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-40">{busy ? "보내는 중…" : "요청 보내기"}</button>
        </div>
      </Modal>

      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900" role="status">
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
