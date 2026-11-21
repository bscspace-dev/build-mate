"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";

export type SupplierLite = { id: string; name: string; handles: string; phone: string; address: string };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

type Form = { name: string; handles: string; phone: string; address: string };

// 거래처(현장관리 메뉴 아래): 목록 보기 + (권한에 따라) 등록·수정·삭제.
export default function SuppliersView({
  suppliers, canRegister, canEdit, canDelete,
}: {
  suppliers: SupplierLite[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const empty: Form = { name: "", handles: "", phone: "", address: "" };
  const [q, setQ] = useState("");
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; s: SupplierLite } | null>(null);
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  const kwDigits = kw.replace(/\D/g, "");
  const shown = suppliers.filter(s => (!kw || norm(s.name).includes(kw) || norm(s.handles).includes(kw) || norm(s.address).includes(kw) || (kwDigits !== "" && s.phone.replace(/\D/g, "").includes(kwDigits))));

  async function call(body: Record<string, unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(done);
      setTimeout(() => setToast(""), 2500);
      setDlg(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  const openForm = (s: SupplierLite | null) => {
    setErr("");
    setF(s ? { name: s.name, handles: s.handles, phone: s.phone, address: s.address } : empty);
    setDlg({ t: "form", id: s?.id ?? null });
  };
  const close = () => { if (!busy) setDlg(null); };
  const formId = dlg?.t === "form" ? dlg.id : null;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">거래처</h1>
        <span className="text-sm text-zinc-500">총 {suppliers.length}곳</span>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 거래처 등록</button>}
      </header>
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="거래처 이름·취급품목·주소·전화 검색" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 sm:max-w-md dark:border-white/15 dark:bg-zinc-900" />
      {suppliers.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 거래처가 없어요.</p>}
      {suppliers.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">검색 결과가 없어요.</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {shown.map(s => (
          <li key={s.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-center gap-2">
              <b className="min-w-0 flex-1 truncate text-base">{s.name}</b>
              {s.phone && <a href={"tel:" + s.phone.replace(/[^d+]/g, "")} aria-label={s.name + " 전화 걸기"} title={s.phone} className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white active:scale-95 hover:bg-emerald-700">📞 전화</a>}
            </div>
            {s.handles && <p className="mt-2 text-sm"><span className="mr-1.5 text-xs font-bold text-zinc-500">취급품목</span>{s.handles}</p>}
            {s.phone && (
              <p className="mt-1.5 text-sm">
                <span className="mr-1.5 text-xs font-bold text-zinc-500">연락처</span>
                <a href={"tel:" + s.phone.replace(/[^\d+]/g, "")} className="font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-300">📞 {s.phone}</a>
              </p>
            )}
            {s.address && <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300"><span className="mr-1.5 text-xs font-bold text-zinc-500">주소</span>{s.address}</p>}
            {!s.handles && !s.phone && !s.address && <p className="mt-2 text-xs text-zinc-400">등록된 상세 정보가 없어요.</p>}
            {(canEdit || canDelete) && (
              <div className="mt-3 flex justify-end gap-1.5">
                {canEdit && <button type="button" onClick={() => openForm(s)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>}
                {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s }); }} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
              </div>
            )}
          </li>
        ))}
      </ul>

      <Modal open={dlg?.t === "form"} onClose={close}>
        <form onSubmit={e => { e.preventDefault(); void call(formId ? { action: "update", id: formId, ...f } : { action: "add", ...f }, formId ? "거래처 정보를 수정했어요" : "“" + f.name.trim() + "” 거래처를 등록했어요"); }}>
          <h2 className="text-lg font-bold">{formId ? "거래처 수정" : "거래처 등록"}</h2>
          <p className="mt-1 text-sm text-zinc-500">거래처 이름만 있으면 등록돼요. 취급품목·연락처·주소는 알고 있는 것만 적어 주세요.</p>
          <label htmlFor="sp-name" className="mt-4 block text-sm font-bold">거래처 이름</label>
          <input id="sp-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="예: 가나다 철물 (같은 이름이 있으면 구분)" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-handles" className="mt-4 block text-sm font-bold">취급품목 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-handles" value={f.handles} onChange={e => setF({ ...f, handles: e.target.value })} maxLength={100} placeholder="예: 합판, 각재, 방부목" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-phone" className="mt-4 block text-sm font-bold">연락처 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} maxLength={30} placeholder="예: 010-1234-5678" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-addr" className="mt-4 block text-sm font-bold">주소 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="예: 경기도 ○○시 ○○로 12" autoComplete="off" className={inputCls} />
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "등록"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={dlg?.t === "del"} onClose={close}>
        {dlg?.t === "del" && (
          <div>
            <h2 className="text-lg font-bold">“{dlg.s.name}” 거래처를 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">삭제하면 되돌릴 수 없어요. 이 거래처에 로그인 아이디가 있다면 함께 사라져요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "delete", id: dlg.s.id }, "거래처를 삭제했어요")} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
