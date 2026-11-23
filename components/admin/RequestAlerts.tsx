"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import FillShortage from "@/components/admin/FillShortage";
import type { MaterialRequest } from "@/lib/types";

const POLL_MS = 8000;
const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 새 현장 요청 알림. '자재요청 현황'의 처리 권한이 있는 사람 화면 아래에, 아직 '준비 완료'를 누르지 않은 요청이 팝업으로 쌓인다.
// 준비해서 '준비 완료'를 누를 때까지 새로고침하거나 다른 화면으로 가도 계속 남는다 (서버에 저장된 처리 상태를 주기적으로 확인한다).
export default function RequestAlerts() {
  const router = useRouter();
  const [list, setList] = useState<MaterialRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    async function load() {
      if (!document.hidden) {
        try {
          const r = await fetch("/api/requests/pending", { cache: "no-store" });
          if (r.status === 401 || r.status === 403) return; // 권한이 없으면 알림을 쓰지 않는다
          if (r.ok) {
            const j = (await r.json()) as { requests: MaterialRequest[] };
            if (alive) setList(j.requests);
          }
        } catch {
          // 연결이 잠깐 끊겨도 다음 주기에 다시 시도한다
        }
      }
      if (alive) timer = window.setTimeout(load, POLL_MS);
    }
    load();
    const onVisible = () => { if (!document.hidden) { window.clearTimeout(timer); load(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function complete(id: string) {
    if (busy) return;
    setBusy(id);
    setErr("");
    try {
      const r = await fetch("/api/requests/done", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setList(prev => prev.filter(x => x.id !== id));
      router.refresh(); // 자재요청 현황 화면이 열려 있으면 완료 표시도 바꾼다
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    }
    setBusy(null);
  }

  if (list.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[55] flex max-h-[70vh] flex-col gap-2 sm:left-auto sm:right-4 sm:w-[24rem]" aria-live="polite">
      {list.length > 1 && (
        <div className="pointer-events-auto self-end rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white shadow-lg">준비할 요청 {list.length}건</div>
      )}
      {err && <p className="pointer-events-auto rounded-xl bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg" role="alert">{err}</p>}
      <div className="pointer-events-auto flex flex-col gap-2 overflow-y-auto pr-0.5">
        <AnimatePresence initial={false}>
          {list.map(r => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }}
              className="rounded-2xl border border-blue-200 bg-white p-3.5 shadow-xl dark:border-blue-500/40 dark:bg-zinc-900"
              role="alert"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">새 요청</span>
                {r.site && <b className="text-sm">🏗 {r.site}</b>}
                <span className="ml-auto text-[11px] text-zinc-500">{fmt(r.at)}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{r.name} · {r.trade} 공정</p>
              <ul className="mt-2 space-y-0.5 text-[13px]">
                {r.items.slice(0, 4).map(it => (
                  <li key={it.k} className="flex flex-wrap items-baseline gap-1.5">
                    <span className="min-w-0 flex-1 truncate">{it.x ? "✏️ " : ""}{it.n}</span>
                    <b className="shrink-0">{it.q}개</b>
                    {it.s ? <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-300">부족 {it.s}</span> : null}
                    {it.f ? <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">채움 {it.f}</span> : null}
                    {it.s ? <FillShortage requestId={r.id} item={it} onFilled={nr => setList(prev => prev.map(x => (x.id === nr.id ? nr : x)))} /> : null}
                  </li>
                ))}
                {r.items.length > 4 && <li className="text-xs text-zinc-500">외 {r.items.length - 4}개</li>}
              </ul>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy === r.id || r.items.some(x => (x.s ?? 0) > 0)} onClick={() => complete(r.id)} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                  {busy === r.id ? "처리 중…" : r.items.some(x => (x.s ?? 0) > 0) ? "부족한 품목을 채워 주세요" : "준비 완료"}
                </button>
                <Link href="/admin/requests" className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold dark:bg-zinc-800">자세히</Link>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
