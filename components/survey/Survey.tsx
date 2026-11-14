"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { SurveyItem } from "@/lib/catalog";
import { Sheet } from "@/components/Sheet";

const PAGE = 120;

type Custom = { n: string; m: string };
// flip = 기본값에서 뒤집은 자재 코드. 공정에 해당하는 자재는 기본이 "필요", 그 밖의 자재는 기본이 "아님".
type Draft = { flip: string[]; customs: Custom[]; reviewed: string[] };
type Store = Record<string, Draft>;
const OFF = "__off__"; // "필요없는 품목" 분류(제외한 자재가 모이는 곳)
// 0 필요(누르면 제외) · 1 제외함(누르면 되돌림) · 2 추가함(누르면 취소) · 3 다른 공정 자재(누르면 추가)
type CardState = 0 | 1 | 2 | 3;

const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";


const pill: Record<CardState, { t: string; c: string }> = {
  0: { t: "✕ 제외", c: "bg-black/55 text-white" },
  1: { t: "↩ 되돌리기", c: "bg-blue-600 text-white" },
  2: { t: "추가됨 ✕", c: "bg-emerald-500 text-white" },
  3: { t: "+ 추가", c: "bg-blue-600 text-white" },
};

const Card = memo(function Card({ item, state, onToggle, showCat }: { item: SurveyItem; state: CardState; onToggle: (k: string) => void; showCat: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={() => onToggle(item.k)}
      whileTap={{ scale: 0.96 }}
      className={`relative block w-full overflow-hidden rounded-2xl border-2 text-left transition-colors ${
        state === 2
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
          : state === 1
            ? "border-dashed border-black/20 bg-zinc-100 dark:border-white/20 dark:bg-zinc-800/60"
            : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"
      }`}
    >
      <div className={state === 3 ? "opacity-70" : ""}>
        {item.i ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.i} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
        ) : (
          <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-800" />
        )}
        <div className="p-2.5">
          <b className="line-clamp-3 min-h-[3.9em] text-[13px] font-semibold leading-snug break-keep">{item.n}</b>
          <i className="mt-0.5 block min-h-[1.1em] text-[11px] not-italic text-zinc-500">{showCat ? item.c : item.b || item.s}</i>
        </div>
      </div>
      <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${pill[state].c}`}>{pill[state].t}</span>
    </motion.button>
  );
});

export default function Survey({
  items, allTrades, workerId, workerName, myTrades, submitted, otherLinks,
}: {
  items: SurveyItem[];
  allTrades: string[]; // 자재의 공정 비트마스크 기준이 되는 전체 공정 목록
  workerId: string; // 이 기기에 작성 중인 내용을 저장할 때 구분하는 값
  workerName: string; // 관리자가 등록한 이름
  myTrades: string[]; // 관리자가 등록한 공정 (1~3개)
  submitted: string[]; // 이미 제출한 공정
  otherLinks: { label: string; href: string }[]; // 이 회원이 쓸 수 있는 다른 메뉴(소모품·회원 관리) 바로 가기
}) {
  const router = useRouter();
  const STORE_KEY = `bm_survey_v4_${workerId}`;
  const [step, setStep] = useState<"intro" | "pick" | "done">("intro");
  const [trade, setTrade] = useState("");
  const [flip, setFlip] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [customs, setCustoms] = useState<Custom[]>([]);
  const [cat, setCat] = useState("전체");
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [panel, setPanel] = useState<null | "add" | "submit">(null);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Set<string>>(new Set(submitted));
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [undo, setUndo] = useState<{ id: number; text: string; prev: Set<string>; prevReviewed: Set<string> } | null>(null);
  const store = useRef<Store>({});

  const tIdx = allTrades.indexOf(trade);
  const inPool = (i: SurveyItem) => tIdx < 0 || ((i.t >> tIdx) & 1) === 1;
  const isOn = (i: SurveyItem) => (inPool(i) ? !flip.has(i.k) : flip.has(i.k));
  const stateOf = (i: SurveyItem): CardState => (inPool(i) ? (flip.has(i.k) ? 1 : 0) : flip.has(i.k) ? 2 : 3);

  const hasDraft = (d: Draft) => d.flip.length > 0 || d.customs.some(c => c.n.trim()) || d.reviewed.length > 0;

  // 이전에 작성하던 내용 복원 (저장소를 못 쓰는 환경에서도 동작은 한다)
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null") as Store | null;
      if (s) {
        store.current = s;
        setDrafts(Object.fromEntries(Object.entries(s).map(([t, v]) => [t, hasDraft(v)])));
      }
    } catch {}
  }, [STORE_KEY]);

  // 작성 중 내용을 이 기기에 자동 저장
  useEffect(() => {
    if (step !== "pick" || !trade) return;
    store.current = { ...store.current, [trade]: { flip: [...flip], customs, reviewed: [...reviewed] } };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store.current));
    } catch {}
  }, [STORE_KEY, step, trade, flip, customs, reviewed]);

  // 되돌리기 알림은 8초 뒤 사라진다
  const undoId = undo?.id;
  useEffect(() => {
    if (undoId == null) return;
    const t = window.setTimeout(() => setUndo(cur => (cur?.id === undoId ? null : cur)), 8000);
    return () => window.clearTimeout(t);
  }, [undoId]);

  // 지금 "필요"로 보이는 자재: 이 공정 자재 중 제외하지 않은 것 + 직접 추가한 다른 공정 자재(+ 전체 보기를 켜면 다른 공정 자재도)
  const visibleBase = useMemo(
    () =>
      items.filter(i => {
        const p = tIdx < 0 || ((i.t >> tIdx) & 1) === 1;
        const f = flip.has(i.k);
        return p ? !f : f || showAll;
      }),
    [items, flip, showAll, tIdx],
  );
  // "필요없는 품목": 이 공정 자재 중 제외한 것
  const excludedItems = useMemo(() => items.filter(i => ((tIdx < 0 || ((i.t >> tIdx) & 1) === 1) && flip.has(i.k))), [items, flip, tIdx]);
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    visibleBase.forEach(i => m.set(i.c, (m.get(i.c) ?? 0) + 1));
    return m;
  }, [visibleBase]);
  const myCats = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => {
      if (tIdx < 0 || ((i.t >> tIdx) & 1) === 1) s.add(i.c);
    });
    return [...s];
  }, [items, tIdx]);
  const stats = useMemo(() => {
    let on = 0, outside = 0;
    for (const i of items) {
      const p = tIdx < 0 || ((i.t >> tIdx) & 1) === 1;
      const f = flip.has(i.k);
      if (p) {
        if (!f) on++;
      } else if (f) on++;
      else outside++;
    }
    return { on, off: excludedItems.length, outside };
  }, [items, flip, tIdx, excludedItems]);

  const isOffTab = cat === OFF;
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const src = isOffTab ? excludedItems : visibleBase;
    return src.filter(i => (isOffTab || cat === "전체" || i.c === cat) && (!kw || `${i.n} ${i.b} ${i.s}`.toLowerCase().includes(kw)));
  }, [isOffTab, excludedItems, visibleBase, cat, q]);

  const activeCat = cat === OFF || cat === "전체" || catCounts.has(cat) ? cat : "전체";
  const customCount = customs.filter(c => c.n.trim()).length;
  const remaining = myTrades.filter(t => !done.has(t));
  const unreviewed = myCats.filter(c => !reviewed.has(c));

  function start(t: string) {
    const st = store.current[t];
    setTrade(t);
    setFlip(new Set(st?.flip ?? []));
    setReviewed(new Set(st?.reviewed ?? []));
    setCustoms(st?.customs ?? []);
    setCat("전체");
    setQ("");
    setShowAll(false);
    setShown(PAGE);
    setErr("");
    setUndo(null);
    setStep("pick");
    window.scrollTo(0, 0);
  }
  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    router.refresh();
  }
  function backToIntro() {
    setDrafts(Object.fromEntries(Object.entries(store.current).map(([t, v]) => [t, hasDraft(v)])));
    setStep("intro");
    window.scrollTo(0, 0);
  }

  function markReviewed(cats: string[]) {
    setReviewed(prev => {
      if (cats.every(c => prev.has(c))) return prev;
      const n = new Set(prev);
      cats.forEach(c => n.add(c));
      return n;
    });
  }
  function toggle(k: string, c: string) {
    setFlip(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
    markReviewed([c]);
  }
  const catOf = useMemo(() => new Map(items.map(i => [i.k, i.c])), [items]);
  const toggleRef = useRef((k: string) => toggle(k, catOf.get(k) ?? ""));
  toggleRef.current = (k: string) => toggle(k, catOf.get(k) ?? "");
  const onToggle = useRef((k: string) => toggleRef.current(k)).current;

  // 현재 목록 전체를 한 번에 "필요없는 품목"으로 보내기 / (필요없는 품목 탭에서) 모두 되돌리기
  function bulk(toOff: boolean) {
    const target = toOff ? list : list.filter(i => (tIdx < 0 || ((i.t >> tIdx) & 1) === 1));
    const changed = target.filter(i => (toOff ? isOn(i) : !isOn(i)));
    if (!changed.length) return;
    const prev = new Set(flip);
    const prevReviewed = new Set(reviewed);
    setFlip(p => {
      const n = new Set(p);
      for (const i of changed) {
        if (n.has(i.k)) n.delete(i.k);
        else n.add(i.k);
      }
      return n;
    });
    if (toOff) markReviewed([...new Set(changed.map(i => i.c))]);
    setUndo({ id: Date.now(), text: toOff ? `${changed.length}개를 필요없는 품목으로 보냈어요` : `${changed.length}개를 필요로 되돌렸어요`, prev, prevReviewed });
  }
  function doUndo() {
    if (!undo) return;
    setFlip(undo.prev);
    setReviewed(undo.prevReviewed);
    setUndo(null);
  }

  // 이름·공정은 서버가 등록 정보로 채운다. 보내는 건 링크 코드·공정·최종으로 필요한 자재뿐.
  const payload = () => ({
    v: 1 as const,
    trade,
    items: items.filter(isOn).map(i => i.k),
    custom: customs.filter(c => c.n.trim()).map(c => ({ n: c.n.trim(), m: c.m.trim() })),
  });

  function openSubmit() {
    setCustoms(c => c.filter(x => x.n.trim() || x.m.trim()));
    setErr("");
    setCopied(false);
    if (!stats.on && !customCount) {
      setErr("필요한 자재가 하나도 없어요. 제외한 자재를 다시 눌러 되돌리거나, 목록에 없는 자재를 추가해 주세요.");
      return;
    }
    setPanel("submit");
  }

  async function send() {
    setSending(true);
    setErr("");
    try {
      const r = await fetch("/api/responses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
      if (r.status === 401) {
        setErr("로그인이 만료됐어요. 다시 로그인해 주세요.");
        router.refresh();
      } else if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? "제출하지 못했어요. 다시 시도해 주세요.");
      } else {
        const next = { ...store.current };
        delete next[trade];
        store.current = next;
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch {}
        setDone(d => new Set(d).add(trade));
        setDrafts(Object.fromEntries(Object.entries(next).map(([t, v]) => [t, hasDraft(v)])));
        setPanel(null);
        setStep("done");
        window.scrollTo(0, 0);
      }
    } catch {
      setErr("인터넷 연결을 확인하고 다시 시도해 주세요.");
    }
    setSending(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...payload(), name: workerName, at: new Date().toISOString() }));
      setCopied(true);
    } catch {
      setErr("복사하지 못했어요.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-28">
      <AnimatePresence mode="wait">
        {step === "intro" && (
          <motion.section key="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
            <div className="mt-8 flex flex-wrap items-center gap-2">
              <h1 className="mr-auto text-2xl font-extrabold">{workerName}님, 안녕하세요</h1>
              <button type="button" onClick={() => router.push("/")} className={`${chipBase} ${chipOff}`}>메뉴</button>
              {otherLinks.map(l => (
                <button key={l.href} type="button" onClick={() => router.push(l.href)} className={`${chipBase} ${chipOff}`}>{l.label}</button>
              ))}
              <button type="button" onClick={() => router.push("/me")} className={`${chipBase} ${chipOff}`}>내 정보</button>
              <button type="button" onClick={logout} className={`${chipBase} ${chipOff}`}>로그아웃</button>
            </div>
            <div className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm leading-relaxed text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
              <b>쓰지 않는 자재만 빼 주세요.</b>
              <br />
              내 공정에서 쓸 만한 자재가 처음부터 <b>모두 “필요”</b>로 들어 있어요. 현장에서 쓰지 않는 자재를 누르면 <b>“필요없는 품목”</b>으로 옮겨져요. 잘못 눌렀다면 그 분류에서 다시 눌러 되돌릴 수 있어요. 목록에 없는 자재는 직접 적을 수 있어요.
            </div>

            <p className="mt-7 text-sm font-bold">내 공정 {myTrades.length > 1 && <span className="font-normal text-zinc-500">· 공정마다 한 번씩 답해 주세요</span>}</p>
            <div className="mt-3 grid gap-3">
              {myTrades.map((t, i) => {
                const isDone = done.has(t);
                const d = drafts[t];
                return (
                  <motion.button
                    key={t}
                    type="button"
                    onClick={() => start(t)}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 + i * 0.07, type: "spring", stiffness: 280, damping: 26 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-4 text-left shadow-sm dark:border-white/10 dark:bg-zinc-900"
                  >
                    <span className="text-lg font-bold">{t}</span>
                    <span className="ml-auto text-sm">
                      {isDone ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">제출 완료 ✓</span>
                      ) : d ? (
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">작성 중</span>
                      ) : (
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">시작하기</span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </div>
            {done.size > 0 && <p className="mt-4 text-xs text-zinc-500">제출한 공정도 다시 열어 고치고 제출하면 마지막 응답으로 바뀌어요.</p>}
          </motion.section>
        )}

        {step === "pick" && (
          <motion.section key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="sticky top-0 z-20 -mx-4 border-b border-black/10 bg-background/95 px-4 pb-2 pt-3 backdrop-blur dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="mr-auto text-[15px] font-bold">
                  {workerName} · {trade} <span className="text-sm font-normal text-zinc-500">공정</span>
                </div>
                <button type="button" onClick={backToIntro} className={`${chipBase} ${chipOff}`}>{myTrades.length > 1 ? "공정 목록" : "처음으로"}</button>
              </div>
              <p className="mt-1 text-xs text-zinc-500">쓰지 않는 자재를 누르면 맨 끝 <b>필요없는 품목</b>으로 옮겨져요. 남아 있는 자재는 모두 필요한 것으로 제출돼요.</p>
              {tIdx >= 0 && (
                <button
                  type="button"
                  onClick={() => { setShowAll(v => !v); if (cat !== OFF) setCat("전체"); setShown(PAGE); }}
                  className={`mt-2 ${chipBase} ${showAll ? chipOn : chipOff}`}
                >
                  {showAll ? "내 공정 자재만 보기" : `다른 공정 자재 추가하기 (${stats.outside})`}
                </button>
              )}
              <input
                value={q}
                onChange={e => { setQ(e.target.value); setShown(PAGE); }}
                placeholder="자재명 검색 (예: 실리콘, 합판, 피스)"
                className="mt-2 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
              />
              <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
                {["전체", ...[...catCounts.keys()].sort((a, b) => Number(a === "공통 소모품") - Number(b === "공통 소모품"))].map(c => (
                  <button key={c} type="button" onClick={() => { setCat(c); setShown(PAGE); }} className={`${chipBase} text-[13px] ${activeCat === c ? chipOn : chipOff}`}>
                    {c !== "전체" && reviewed.has(c) && <span className="mr-0.5">✓</span>}
                    {c}
                    <small className="ml-1 opacity-70">{c === "전체" ? visibleBase.length : catCounts.get(c)}</small>
                  </button>
                ))}
                {/* 제외한 자재가 모이는 분류 */}
                <button
                  type="button"
                  onClick={() => { setCat(OFF); setShown(PAGE); }}
                  className={`${chipBase} text-[13px] ${activeCat === OFF ? "border-zinc-700 bg-zinc-700 font-semibold text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900" : "border-dashed border-zinc-400 bg-transparent text-zinc-600 dark:text-zinc-300"}`}
                >
                  필요없는 품목
                  <motion.small key={stats.off} initial={{ scale: 1.7 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className="ml-1 inline-block font-bold">
                    {stats.off}
                  </motion.small>
                </button>
              </div>
            </div>

            {/* 한 번에 처리 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm text-zinc-500">{isOffTab ? `필요없다고 한 자재 ${list.length}개` : `${list.length}개 표시 중`}</span>
              {!isOffTab && activeCat !== "전체" && myCats.includes(activeCat) && (
                <button
                  type="button"
                  onClick={() => (reviewed.has(activeCat) ? setReviewed(p => { const n = new Set(p); n.delete(activeCat); return n; }) : markReviewed([activeCat]))}
                  className={`${chipBase} ${reviewed.has(activeCat) ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : chipOff}`}
                >
                  {reviewed.has(activeCat) ? "✓ 이 분류 확인함" : "이 분류 확인 완료"}
                </button>
              )}
              {isOffTab ? (
                <button type="button" disabled={!list.length} onClick={() => bulk(false)} className="rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-600 disabled:opacity-40 dark:bg-blue-500/15 dark:text-blue-300">
                  이 목록 모두 필요로 되돌리기
                </button>
              ) : (
                <button type="button" disabled={!list.length} onClick={() => bulk(true)} className="rounded-xl bg-zinc-200 px-3 py-1.5 text-sm font-bold text-zinc-800 disabled:opacity-40 dark:bg-zinc-700 dark:text-zinc-100">
                  이 목록 {list.length}개 모두 필요없음
                </button>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              <AnimatePresence mode="popLayout" initial={false}>
                {list.slice(0, shown).map(i => (
                  <motion.div
                    key={i.k}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.16 } }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  >
                    <Card item={i} state={stateOf(i)} onToggle={onToggle} showCat={isOffTab} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {list.length === 0 && <p className="py-16 text-center text-zinc-500">{isOffTab ? "아직 필요없다고 한 자재가 없어요" : "해당하는 자재가 없어요"}</p>}
            {list.length > shown && (
              <div className="py-6 text-center">
                <button type="button" onClick={() => setShown(s => s + PAGE)} className="rounded-xl bg-blue-50 px-5 py-3 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                  더 보기 ({list.length - shown}개 남음)
                </button>
              </div>
            )}
          </motion.section>
        )}

        {step === "done" && (
          <motion.section key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="pt-24 text-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.1 }} className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl text-white">
              ✓
            </motion.div>
            <h2 className="mt-5 text-xl font-bold">{trade} 공정 제출 완료! 감사합니다</h2>
            {remaining.length > 0 ? (
              <>
                <p className="mt-2 text-sm text-zinc-500">아직 답하지 않은 공정이 있어요: {remaining.join(", ")}</p>
                <button type="button" onClick={backToIntro} className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-bold text-white">다음 공정 답하기</button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-500">등록된 모든 공정에 답하셨어요. 수고하셨습니다.</p>
                <button type="button" onClick={backToIntro} className="mt-6 rounded-xl bg-zinc-100 px-6 py-3 font-bold dark:bg-zinc-800">처음 화면으로</button>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {/* 되돌리기 알림 */}
      <AnimatePresence>
        {undo && step === "pick" && (
          <motion.div
            key={undo.id}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
            role="status"
          >
            <span>{undo.text}</span>
            <button type="button" onClick={doUndo} className="font-bold text-blue-300 dark:text-blue-600">되돌리기</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 하단 고정 바 */}
      <AnimatePresence>
        {step === "pick" && (
          <motion.div
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-black/10 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-zinc-900/95"
          >
            <div className="mx-auto flex max-w-4xl items-center gap-2">
              <span className="mr-auto text-sm font-medium">
                필요 {stats.on}개 · 필요없음 {stats.off}개{customCount ? ` · 직접 ${customCount}개` : ""}
              </span>
              <button type="button" onClick={() => { if (!customs.length) setCustoms([{ n: "", m: "" }]); setPanel("add"); }} className="rounded-xl bg-blue-50 px-3.5 py-3 text-sm font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                + 목록에 없는 자재
              </button>
              <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={openSubmit} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white">제출</motion.button>
            </div>
            {err && panel === null && <p className="mx-auto mt-2 max-w-4xl text-sm text-red-500">{err}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 직접 추가 */}
      <Sheet open={panel === "add"} onClose={() => setPanel(null)}>
        <h2 className="text-lg font-bold">목록에 없는 자재 추가</h2>
        <p className="mt-1 text-sm text-zinc-500">이 공정에서 쓰는데 목록에서 못 찾은 자재를 적어 주세요. 규격이나 용도를 메모에 적으면 더 좋아요.</p>
        <div className="mt-4 space-y-2">
          {customs.map((c, i) => (
            <div key={i} className="flex gap-1.5">
              <input
                value={c.n}
                onChange={e => setCustoms(a => a.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)))}
                placeholder="자재명"
                className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15"
              />
              <input
                value={c.m}
                onChange={e => setCustoms(a => a.map((x, j) => (j === i ? { ...x, m: e.target.value } : x)))}
                placeholder="메모 (규격·용도)"
                className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15"
              />
              <button type="button" aria-label="삭제" onClick={() => setCustoms(a => a.filter((_, j) => j !== i))} className="px-2 text-xl text-zinc-400">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCustoms(a => [...a, { n: "", m: "" }])} className="mt-3 w-full rounded-xl bg-blue-50 py-3 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">+ 한 줄 더 추가</button>
        <button type="button" onClick={() => { setCustoms(a => a.filter(x => x.n.trim() || x.m.trim())); setPanel(null); }} className="mt-2 w-full rounded-xl bg-blue-600 py-3 font-bold text-white">확인</button>
      </Sheet>

      {/* 제출 */}
      <Sheet open={panel === "submit"} onClose={() => setPanel(null)}>
        <h2 className="text-lg font-bold">제출하기</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {workerName} · {trade} 공정 · 필요 {stats.on}개 · 필요없음 {stats.off}개{customCount ? ` · 직접 입력 ${customCount}개` : ""}
        </p>
        {unreviewed.length > 0 && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <b>아직 확인하지 않은 분류가 {unreviewed.length}개 있어요.</b>
            <br />
            {unreviewed.join(", ")}
            <br />
            <span className="text-xs">확인하지 않은 분류의 자재는 모두 “필요”로 제출돼요.</span>
          </div>
        )}
        <motion.button whileTap={{ scale: 0.98 }} disabled={sending} onClick={send} className="mt-5 w-full rounded-xl bg-blue-600 py-3.5 text-base font-bold text-white disabled:opacity-50">
          {sending ? "제출 중…" : unreviewed.length ? "그대로 제출하기" : "제출하기"}
        </motion.button>
        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        {err && (
          <button type="button" onClick={copy} className="mt-3 w-full rounded-xl bg-blue-50 py-3 text-sm font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
            {copied ? "복사했어요 — 카톡으로 보내 주세요" : "제출이 안 되면: 내용 복사해서 카톡으로 보내기"}
          </button>
        )}
        <button type="button" onClick={() => setPanel(null)} className="mt-2 w-full rounded-xl py-3 text-sm text-zinc-500">{unreviewed.length ? "돌아가서 확인하기" : "돌아가서 더 고르기"}</button>
      </Sheet>
    </div>
  );
}
