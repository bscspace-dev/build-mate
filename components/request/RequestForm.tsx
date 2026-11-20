"use client";

import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { SurveyItem } from "@/lib/catalog";
import PasswordChangeButton from "@/components/PasswordChange";
import LoginIdChangeButton from "@/components/LoginIdChange";
import { Modal } from "@/components/Sheet";

const PAGE = 60;
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
        <span className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-white">재고 {item.q}</span>
        <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? "bg-blue-600 text-white" : "bg-black/55 text-white"}`}>{on ? "✓ 선택됨" : "+ 선택"}</span>
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
        {on && !!qty && qty > item.q && <p className="mt-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">재고 {item.q}개 · {qty - item.q}개 부족해도 요청돼요</p>}
      </div>
    </div>
  );
});

export default function RequestForm({
  items, allTrades, workerName, myTrades, otherLinks, idChange, temp,
}: {
  items: SurveyItem[];
  allTrades: string[]; // 자재의 공정 비트마스크 기준이 되는 전체 공정 목록
  workerName: string;
  myTrades: string[]; // 관리자가 등록한 공정 (1~3개)
  otherLinks: { label: string; href: string }[];
  idChange: false | "once" | "unlimited";
  temp: boolean;
}) {
  const router = useRouter();
  const [trade, setTrade] = useState(myTrades[0] ?? "");
  const [sels, setSels] = useState<Record<string, Sel>>({}); // 공정별 선택 (공정을 오가도 유지)
  const [customs, setCustoms] = useState<Record<string, Custom[]>>({}); // 공정별 직접 적은 품목
  const [cat, setCat] = useState("전체");
  const [onlyStar, setOnlyStar] = useState(false);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [siteOpen, setSiteOpen] = useState(false); // 현장 확인 창
  const [site, setSite] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [siteErr, setSiteErr] = useState("");
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
  const base = useMemo(() => (bit < 0 ? [] : items.filter(i => i.t & (1 << bit))), [items, bit]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    base.forEach(i => m.set(i.c, (m.get(i.c) ?? 0) + 1));
    return m;
  }, [base]);
  const activeCat = cat === "전체" || cats.has(cat) ? cat : "전체";
  const starCount = useMemo(() => base.filter(i => starSet.has(i.k)).length, [base, starSet]);
  const starOnly = onlyStar && starCount > 0;
  const list = useMemo(() => {
    const kw = q.trim().replace(/\s+/g, "").toLowerCase();
    return base.filter(i => (!starOnly || starSet.has(i.k)) && (activeCat === "전체" || i.c === activeCat) && (!kw || `${i.n}${i.b}${i.s}`.replace(/\s+/g, "").toLowerCase().includes(kw)));
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
    setShown(PAGE);
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
  const addCustom = () => setCustoms(prev => ({ ...prev, [trade]: [...(prev[trade] ?? []), { id: nextId(), n: "", q: 1 }] }));
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
    const r = readSites();
    setRecent(r);
    setSite(s => s || r[0] || "");
    setSiteOpen(true);
  }

  async function submit() {
    const name = site.trim().replace(/\s+/g, " ");
    if (!name) return setSiteErr("현장 이름을 적어 주세요.");
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

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  const totalQty = picked.reduce((n, k) => n + (sel[k] || 0), 0) + myCustoms.reduce((n, c) => n + (c.q || 0), 0);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-32">
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">{workerName}님, 자재 요청</h1>
        <button type="button" onClick={() => router.push("/")} className={`${chipBase} ${chipOff}`}>메뉴</button>
        {otherLinks.map(l => (
          <button key={l.href} type="button" onClick={() => router.push(l.href)} className={`${chipBase} ${chipOff}`}>{l.label}</button>
        ))}
        {idChange && <LoginIdChangeButton temp={temp} unlimited={idChange === "unlimited"} className={`${chipBase} ${chipOff}`} />}
        <PasswordChangeButton temp={temp} className={`${chipBase} ${chipOff}`} />
        <button type="button" onClick={logout} className={`${chipBase} ${chipOff}`}>로그아웃</button>
      </div>

      <p className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm leading-relaxed text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
        필요한 자재를 <b>눌러서 고르고</b>, 자재마다 <b>수량</b>을 적은 뒤 <b>요청하기</b>를 눌러 주세요. 재고가 모자라도 요청할 수 있고, 목록에 없는 자재는 <b>직접 적어서</b> 요청할 수 있어요. 요청은 관리자의 “현장요청”으로 전달돼요.
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
            onChange={e => { setQ(e.target.value); setShown(PAGE); }}
            placeholder="자재명 검색 (예: 합판, 피스)"
            aria-label="자재 검색"
            className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
          />

          <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
            <button type="button" aria-pressed={starOnly} onClick={() => { setOnlyStar(v => !v); setShown(PAGE); }} className={`${chipBase} text-[13px] ${starOnly ? "border-amber-400 bg-amber-400 font-semibold text-white" : chipOff}`}>
              ★ 별표<small className="ml-1 opacity-70">{starCount}</small>
            </button>
            {["전체", ...cats.keys()].map(c => (
              <button key={c} type="button" onClick={() => { setCat(c); setShown(PAGE); }} className={`${chipBase} text-[13px] ${activeCat === c ? chipOn : chipOff}`}>
                {c}<small className="ml-1 opacity-70">{c === "전체" ? base.length : cats.get(c)}</small>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {list.slice(0, shown).map(i => (
              <Card key={i.k} item={i} qty={sel[i.k]} starred={starSet.has(i.k)} onToggle={onToggle} onQty={onQty} onStar={onStar} />
            ))}
          </div>
          {list.length === 0 && <p className="py-10 text-center text-zinc-500">해당하는 자재가 없어요</p>}
          <section className="mt-6 rounded-2xl border border-dashed border-amber-400 bg-amber-50/60 p-4 dark:bg-amber-500/5" aria-label="목록에 없는 품목">
            <div className="flex flex-wrap items-center gap-2">
              <b className="mr-auto text-[15px]">필요한 품목이 목록에 없나요?</b>
              <button type="button" onClick={addCustom} className="rounded-xl bg-amber-500 px-3.5 py-2 text-sm font-bold text-white">+ 직접 적어서 요청</button>
            </div>
            {myCustoms.length === 0 && <p className="mt-1 text-sm text-zinc-500">품목 이름과 수량을 직접 적어 요청할 수 있어요.</p>}
            <div className="mt-3 space-y-2">
              {myCustoms.map(c => (
                <div key={c.id} className="flex items-center gap-1.5">
                  <input value={c.n} maxLength={100} onChange={e => setCustom(c.id, { n: e.target.value })} placeholder="품목 이름 (규격·용도도 같이 적어 주세요)" aria-label="품목 이름" className="h-10 min-w-0 flex-[3] rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
                  <button type="button" aria-label="수량 줄이기" onClick={() => setCustom(c.id, { q: Math.max(1, (c.q || 1) - 1) })} className="h-10 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">−</button>
                  <input inputMode="numeric" value={c.q ? String(c.q) : ""} placeholder="수량" aria-label="수량" onChange={e => setCustom(c.id, { q: Math.min(MAX_QTY, parseInt(e.target.value.replace(/\D/g, ""), 10) || 0) })} className={`h-10 w-14 shrink-0 rounded-lg border bg-white text-center text-base font-bold outline-none focus:border-blue-500 dark:bg-zinc-900 ${c.q ? "border-black/15 dark:border-white/15" : "border-red-400"}`} />
                  <button type="button" aria-label="수량 늘리기" onClick={() => setCustom(c.id, { q: Math.min(MAX_QTY, (c.q || 0) + 1) })} className="h-10 w-9 shrink-0 rounded-lg bg-zinc-100 text-lg font-bold dark:bg-zinc-800">+</button>
                  <button type="button" aria-label="이 품목 빼기" onClick={() => dropCustom(c.id)} className="h-10 w-9 shrink-0 rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15">✕</button>
                </div>
              ))}
            </div>
          </section>
          {list.length > shown && (
            <div className="py-6 text-center">
              <button type="button" onClick={() => setShown(s => s + PAGE)} className="rounded-xl bg-blue-50 px-5 py-3 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                더 보기 ({list.length - shown}개 남음)
              </button>
            </div>
          )}
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
          <div className="mr-auto min-w-0 text-sm">
            <b>{trade || "공정 없음"}</b> · 자재 {count}개{count > 0 && <> · 수량 합계 {totalQty}</>}
            {err && <p className="truncate text-xs text-red-500" role="alert">{err}</p>}
          </div>
          <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy || count === 0} onClick={askSite} className="shrink-0 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white disabled:opacity-40">
            요청하기
          </motion.button>
        </div>
      </div>

      <Modal open={siteOpen} onClose={() => !busy && setSiteOpen(false)}>
        <h2 className="text-lg font-bold">어떤 현장의 요청인가요?</h2>
        <p className="mt-1 text-sm text-zinc-500">{trade} 공정 · 자재 {count}개 · 수량 합계 {totalQty}</p>
        <label htmlFor="req-site" className="mt-4 block text-sm font-bold">현장 이름</label>
        <input
          id="req-site"
          autoFocus
          value={site}
          maxLength={50}
          onChange={e => setSite(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder="예: 강남 ○○빌딩 신축"
          autoComplete="off"
          className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15"
        />
        {recent.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {recent.map(s => (
              <button key={s} type="button" onClick={() => setSite(s)} className={`${chipBase} text-[13px] ${site === s ? chipOn : chipOff}`}>{s}</button>
            ))}
          </div>
        )}
        {siteErr && <p className="mt-3 text-sm text-red-500" role="alert">{siteErr}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => setSiteOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button type="button" disabled={busy || !site.trim()} onClick={submit} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-40">{busy ? "보내는 중…" : "요청 보내기"}</button>
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
