"use client";

import { useState } from "react";
import type { MaterialRequest, RequestItem } from "@/lib/types";

// 재고가 모자랐던 품목을 채운다: 입고한 수량을 적으면 재고에 들어가고, 이 요청의 부족분이 바로 채워진다.
// 부족한 수량 이상을 적어야 하고, 남는 수량은 재고에 그대로 남는다. 부족분을 모두 채워야 '준비 완료'를 누를 수 있다.
export default function FillShortage({ requestId, item, onFilled }: { requestId: string; item: RequestItem; onFilled: (r: MaterialRequest) => void }) {
  const need = item.s ?? 0;
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(String(need));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (need <= 0) return null;

  async function fill() {
    const received = parseInt(qty, 10);
    if (!received || received < need) return setErr(`부족한 ${need}개 이상 적어 주세요.`);
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/requests/fill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestId, k: item.k, received }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; request?: MaterialRequest };
      if (!r.ok || !j.request) throw new Error(j.error ?? "채우지 못했어요.");
      onFilled(j.request);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "채우지 못했어요.");
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setQty(String(need)); setErr(""); setOpen(true); }} className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">
        재고 채우기
      </button>
    );
  }
  return (
    <div className="mt-1 w-full rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
      <p className="text-[11px] text-amber-800 dark:text-amber-200">입고한 수량 ({need}개 이상 · 남는 수량은 재고에 들어가요)</p>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          inputMode="numeric"
          autoFocus
          value={qty}
          aria-label="입고 수량"
          onChange={e => setQty(e.target.value.replace(/\D/g, "").slice(0, 7))}
          onKeyDown={e => { if (e.key === "Enter") fill(); }}
          className="h-8 min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-2 text-center text-sm font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
        />
        <button type="button" disabled={busy} onClick={fill} className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-50">{busy ? "…" : "채우기"}</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="h-8 rounded-lg bg-zinc-100 px-2.5 text-xs font-bold dark:bg-zinc-800">취소</button>
      </div>
      {err && <p className="mt-1 text-[11px] text-red-600" role="alert">{err}</p>}
    </div>
  );
}
