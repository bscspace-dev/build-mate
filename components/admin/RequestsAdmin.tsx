"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import FillShortage from "@/components/admin/FillShortage";
import type { MaterialRequest } from "@/lib/types";

const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";

const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 현장 작업자가 보낸 자재 요청 목록. 요청마다 자재 카드(이미지·이름)와 수량이 보인다.
export default function RequestsAdmin({ initialRequests, canHandle }: { initialRequests: MaterialRequest[]; canHandle: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "pending" | "done">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const pendingCount = initialRequests.filter(r => !r.done).length;

  // 준비 완료 처리
  async function complete(id: string) {
    if (busy) return;
    setBusy(id);
    setErr("");
    try {
      const r = await fetch("/api/requests/done", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    }
    setBusy(null);
  }

  const [trade, setTrade] = useState("전체");
  const [q, setQ] = useState("");
  const trades = useMemo(() => {
    const m = new Map<string, number>();
    initialRequests.forEach(r => m.set(r.trade, (m.get(r.trade) ?? 0) + 1));
    return m;
  }, [initialRequests]);
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const shown = initialRequests.filter(
    r =>
      (status === "all" || (status === "pending" ? !r.done : r.done)) &&
      (trade === "전체" || r.trade === trade) &&
      (!kw || r.name.replace(/\s+/g, "").toLowerCase().includes(kw) || r.site.replace(/\s+/g, "").toLowerCase().includes(kw) || r.items.some(i => i.n.replace(/\s+/g, "").toLowerCase().includes(kw))),
  );

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">자재요청 현황</h1>
        <span className="text-sm text-zinc-500">총 {initialRequests.length}건</span>
      </header>

      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="현장·요청자·자재명으로 검색"
        aria-label="검색"
        className="w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
      />
      <div className="mt-3 flex gap-1.5">
        {([["all", `전체 ${initialRequests.length}`], ["pending", `준비 중 ${pendingCount}`], ["done", `완료 ${initialRequests.length - pendingCount}`]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setStatus(v)} className={`${chipBase} ${status === v ? chipOn : chipOff}`}>{label}</button>
        ))}
      </div>
      {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
        {["전체", ...trades.keys()].map(t => (
          <button key={t} type="button" onClick={() => setTrade(t)} className={`${chipBase} text-[13px] ${trade === t ? chipOn : chipOff}`}>
            {t}<small className="ml-1 opacity-70">{t === "전체" ? initialRequests.length : trades.get(t)}</small>
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="py-20 text-center text-zinc-500">{initialRequests.length === 0 ? "아직 들어온 요청이 없어요." : "해당하는 요청이 없어요."}</p>}

      <div className="mt-4 space-y-4">
        {shown.map((r, i) => (
          <motion.section
            key={r.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
            className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              {r.site && <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">🏗 {r.site}</span>}
              <b className="text-base">{r.name}</b>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{r.trade}</span>
              <span className="ml-auto text-xs text-zinc-500">{fmt(r.at)} · 자재 {r.items.length}개 · 수량 합계 {r.items.reduce((n, x) => n + x.q, 0)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.done ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓ 준비 완료{r.doneBy ? ` · ${r.doneBy}` : ""}{r.doneAt ? ` · ${fmt(r.doneAt)}` : ""}</span>
              ) : (
                <>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">준비 중</span>
                  {canHandle && (
                    <>
                      <button type="button" disabled={busy === r.id || r.items.some(x => (x.s ?? 0) > 0)} onClick={() => complete(r.id)} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy === r.id ? "처리 중…" : "준비 완료"}</button>
                      {r.items.some(x => (x.s ?? 0) > 0) && <span className="text-xs font-semibold text-red-600 dark:text-red-300">재고가 부족한 품목을 먼저 채워 주세요</span>}
                    </>
                  )}
                </>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {r.items.map(it => (
                <div key={it.k} className="relative overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
                  {it.x ? (
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                      <span className="text-3xl" aria-hidden>✏️</span>
                      <span className="text-xs font-bold">목록에 없는 품목</span>
                    </div>
                  ) : it.i ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.i} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
                  ) : (
                    <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-800" />
                  )}
                  <span className="absolute right-2 top-2 rounded-full bg-blue-600 px-2.5 py-1 text-sm font-extrabold text-white shadow">{it.q}개</span>
                  {it.s ? <span className="absolute left-2 top-2 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">재고 부족 {it.s}</span> : it.f ? <span className="absolute left-2 top-2 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow">채움 {it.f}</span> : null}
                  <div className="p-2.5">
                    <b className="line-clamp-3 text-[13px] font-semibold leading-snug break-keep">{it.n}</b>
                    {it.s && canHandle && !r.done ? <div className="mt-1.5"><FillShortage requestId={r.id} item={it} onFilled={() => router.refresh()} /></div> : null}
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        ))}
      </div>
    </div>
  );
}
