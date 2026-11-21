"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import type { PurchaseItem, PurchaseStatus } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const STATUS: { v: PurchaseStatus; label: string; cls: string }[] = [
  { v: "want", label: "구매 예정", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" },
  { v: "ordered", label: "주문함", cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200" },
  { v: "done", label: "구매 완료", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" },
];
const won = (n: number) => n.toLocaleString("ko-KR") + "원";
const total = (p: { price: number; qty: number }) => p.price * p.qty;
// 링크에서 쇼핑몰 이름(도메인)만 뽑아 보여 준다. 예: https://www.coupang.com/vp/... → coupang.com
const shopOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, ""); } catch { return ""; } };
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : "");

type Form = { name: string; url: string; price: string; qty: string; memo: string; status: PurchaseStatus };
const EMPTY: Form = { name: "", url: "", price: "", qty: "1", memo: "", status: "want" };

// 구매관리: 구매하려는 품목의 링크와 가격을 정리한다. 구매 예정 → 주문함 → 구매 완료로 상태를 바꾸고, 금액 합계를 본다.
export default function PurchasesAdmin({ items, canRegister, canEdit, canDelete }: { items: PurchaseItem[]; canRegister: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | PurchaseStatus>("want");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "high" | "low" | "name">("new");
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; p: PurchaseItem } | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  const sums = (st?: PurchaseStatus) => items.filter(p => !st || p.status === st).reduce((n, p) => n + total(p), 0);
  const count = (st?: PurchaseStatus) => items.filter(p => !st || p.status === st).length;
  const shown = items
    .filter(p => (tab === "all" || p.status === tab) && (!kw || norm(`${p.name}${p.memo}${shopOf(p.url)}${p.createdBy}`).includes(kw)))
    .sort((a, b) => (sort === "high" ? total(b) - total(a) : sort === "low" ? total(a) - total(b) : sort === "name" ? a.name.localeCompare(b.name, "ko") : b.createdAt.localeCompare(a.createdAt)));
  const shownSum = shown.reduce((n, p) => n + total(p), 0);

  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(done);
      setTimeout(() => setToast(""), 2500);
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const openForm = (p: PurchaseItem | null) => {
    setErr("");
    setF(p ? { name: p.name, url: p.url, price: p.price ? String(p.price) : "", qty: String(p.qty), memo: p.memo, status: p.status } : { ...EMPTY, status: tab === "all" ? "want" : tab });
    setDlg({ t: "form", id: p?.id ?? null });
  };
  const close = () => { if (!busy) setDlg(null); };
  const formId = dlg?.t === "form" ? dlg.id : null;
  const body = () => ({ name: f.name, url: f.url, price: Number(f.price || 0), qty: Number(f.qty || 1), memo: f.memo, status: f.status });
  const setStatus = (p: PurchaseItem, status: PurchaseStatus) => call({ action: "status", id: p.id, name: p.name, url: p.url, price: p.price, qty: p.qty, memo: p.memo, status }, `“${p.name}” ${STATUS.find(s => s.v === status)!.label}(으)로 바꿨어요`);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">구매관리</h1>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 구매 품목 추가</button>}
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">구매하려는 품목의 <b>링크</b>와 <b>가격</b>을 정리해 두는 곳이에요. 상태를 <b>구매 예정 → 주문함 → 구매 완료</b>로 바꾸면서 금액 합계를 확인해요.</p>

      <div className="grid grid-cols-3 gap-2 text-center">
        {STATUS.map(s => (
          <div key={s.v} className="rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${s.cls}`}>{s.label}</span>
            <div className="mt-1.5 text-lg font-extrabold">{won(sums(s.v))}</div>
            <div className="text-xs text-zinc-500">{count(s.v)}개</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="상태">
          {([["all", "전체"], ...STATUS.map(s => [s.v, s.label] as const)] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v as "all" | PurchaseStatus)} className={`rounded-full border px-3 py-1.5 text-sm ${tab === v ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-black/10 bg-white hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900"}`}>{l}<small className="ml-1 opacity-70">{count(v === "all" ? undefined : (v as PurchaseStatus))}</small></button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="품목·쇼핑몰·메모 검색" className="ml-auto min-w-[10rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900" />
        <select aria-label="정렬" value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
          <option value="new">최근 등록순</option>
          <option value="high">합계 높은순</option>
          <option value="low">합계 낮은순</option>
          <option value="name">이름순</option>
        </select>
      </div>
      {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && !dlg && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
      <p className="mt-3 text-sm text-zinc-500">{shown.length}개 · 합계 <b className="text-zinc-900 dark:text-zinc-100">{won(shownSum)}</b></p>

      {items.length === 0 && <p className="mt-3 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">정리한 구매 품목이 없어요.{canRegister ? " 위의 “구매 품목 추가”로 링크와 가격을 적어 두세요." : ""}</p>}
      {items.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">해당하는 품목이 없어요.</p>}
      <ul className="mt-2 space-y-2">
        {shown.map(p => {
          const st = STATUS.find(s => s.v === p.status)!;
          const href = safeHref(p.url);
          return (
            <li key={p.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <b className="block break-words text-base">{p.name}</b>
                  <span className="text-xs text-zinc-500">{p.createdBy} · {new Date(p.createdAt).toLocaleDateString("ko-KR")}</span>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-sm">개당 <b>{won(p.price)}</b> × {p.qty}개 = <b className="text-lg font-extrabold text-blue-700 dark:text-blue-300">{won(total(p))}</b></span>
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 dark:bg-zinc-800 dark:text-blue-300" title={p.url}>🔗 {shopOf(p.url) || "링크"} 열기</a>}
              </div>
              {p.memo && <p className="mt-2 whitespace-pre-line rounded-lg bg-zinc-50 px-3 py-1.5 text-sm dark:bg-zinc-800/60">{p.memo}</p>}
              {(canEdit || canDelete) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {canEdit && STATUS.filter(s => s.v !== p.status).map(s => <button key={s.v} type="button" disabled={busy} onClick={() => void setStatus(p, s.v)} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-xs font-bold disabled:opacity-50 dark:border-white/15">→ {s.label}</button>)}
                  <span className="ml-auto flex gap-1.5">
                    {canEdit && <button type="button" onClick={() => openForm(p)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>}
                    {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", p }); }} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Modal open={dlg?.t === "form"} onClose={close}>
        <form onSubmit={e => { e.preventDefault(); void call(formId ? { action: "update", id: formId, ...body() } : { action: "add", ...body() }, formId ? "품목을 수정했어요" : "구매 품목을 추가했어요").then(ok => { if (ok) setDlg(null); }); }}>
          <h2 className="text-lg font-bold">{formId ? "구매 품목 수정" : "구매 품목 추가"}</h2>
          <label htmlFor="pc-name" className="mt-4 block text-sm font-bold">품목명</label>
          <input id="pc-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={100} placeholder="예: 충전 드릴 18V" autoComplete="off" className={inputCls} />
          <label htmlFor="pc-url" className="mt-4 block text-sm font-bold">구매 링크 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="pc-url" inputMode="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://… 상품 페이지 주소를 붙여 넣으세요" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputCls} />
          {shopOf(/^[a-z][a-z0-9+.-]*:/i.test(f.url.trim()) ? f.url.trim() : f.url.trim() ? "https://" + f.url.trim() : "") && <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-300">🔗 {shopOf(/^[a-z][a-z0-9+.-]*:/i.test(f.url.trim()) ? f.url.trim() : "https://" + f.url.trim())}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pc-price" className="mt-4 block text-sm font-bold">개당 가격 <span className="font-normal text-zinc-500">(원)</span></label>
              <input id="pc-price" inputMode="numeric" value={f.price ? Number(f.price).toLocaleString("ko-KR") : ""} onChange={e => setF({ ...f, price: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="0" autoComplete="off" className={inputCls + " text-right"} />
            </div>
            <div>
              <label htmlFor="pc-qty" className="mt-4 block text-sm font-bold">수량</label>
              <input id="pc-qty" inputMode="numeric" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value.replace(/\D/g, "").slice(0, 4) })} onFocus={e => e.target.select()} autoComplete="off" className={inputCls + " text-right"} />
            </div>
          </div>
          <p className="mt-1.5 text-sm font-bold text-blue-700 dark:text-blue-300">합계 {won(Number(f.price || 0) * Math.max(1, Number(f.qty || 1)))}</p>
          <div className="mt-3 flex gap-1.5" role="radiogroup" aria-label="상태">
            {STATUS.map(s => <button key={s.v} type="button" role="radio" aria-checked={f.status === s.v} onClick={() => setF({ ...f, status: s.v })} className={`flex-1 rounded-xl border py-2 text-sm font-extrabold ${f.status === s.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{s.label}</button>)}
          </div>
          <label htmlFor="pc-memo" className="mt-4 block text-sm font-bold">메모 <span className="font-normal text-zinc-500">(선택)</span></label>
          <textarea id="pc-memo" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} maxLength={300} rows={2} placeholder="예: 배터리 2개 포함, 현장 A용" className={inputCls + " resize-none"} />
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "추가"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={dlg?.t === "del"} onClose={close}>
        {dlg?.t === "del" && (
          <div>
            <h2 className="text-lg font-bold">“{dlg.p.name}” 품목을 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">삭제하면 되돌릴 수 없어요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "delete", id: dlg.p.id }, "품목을 삭제했어요").then(ok => { if (ok) setDlg(null); })} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
