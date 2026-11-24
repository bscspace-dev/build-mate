"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { printElement } from "@/lib/print-client";
import { formatPhone } from "@/lib/member-utils";
import { embedPostcode, loadPostcode } from "@/lib/postcode-client";

export type SupplierLite = { id: string; name: string; handles: string; phone: string; address: string };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

const NONE = "취급품목 미등록";
const itemsOf = (handles: string): string[] => [...new Set(handles.split(/[,，、/·\n]+/).map(x => x.trim()).filter(Boolean))];
const telHref = (p: string) => "tel:" + p.replace(/[^\d+]/g, "");
// 등록된 주소를 네이버 지도에서 찾아 연다 (주소가 없으면 링크 없이 이름만)
const naverMap = (addr: string) => "https://map.naver.com/p/search/" + encodeURIComponent(addr);
function NameLink({ name, address, className }: { name: string; address: string; className?: string }) {
  if (!address.trim()) return <span className={className}>{name}</span>;
  return (
    <a href={naverMap(address)} target="_blank" rel="noreferrer" title={`${address} — 네이버 지도에서 열기`} className={`${className ?? ""} underline decoration-zinc-300 decoration-dotted underline-offset-4 hover:text-blue-600 hover:decoration-blue-600 dark:decoration-zinc-600`}>{name}</a>
  );
}

type Form = { name: string; handles: string; phone: string; address: string };

// 거래처(운영관리 메뉴 아래): 목록 보기 + (권한에 따라) 등록·수정·삭제.
export default function SuppliersView({
  suppliers, canRegister, canEdit, canDelete,
}: {
  suppliers: SupplierLite[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const empty: Form = { name: "", handles: "", phone: "", address: "" };
  const [q, setQ] = useState("");
  const [grouped, setGrouped] = useState(true); // 취급품목별로 묶어 보기
  const [itemSel, setItemSel] = useState(""); // 이 품목을 취급하는 거래처만
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; s: SupplierLite } | null>(null);
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [addrOpen, setAddrOpen] = useState(false); // 도로명 주소 찾기 창
  const [addrErr, setAddrErr] = useState("");
  const addrBox = useRef<HTMLDivElement>(null);

  // 주소 찾기 창이 열리면 검색 화면을 불러와 넣는다. 주소를 고르면 입력칸에 채운다.
  useEffect(() => {
    if (!addrOpen) return;
    let dead = false;
    loadPostcode()
      .then(() => {
        requestAnimationFrame(() => {
          const box = addrBox.current;
          if (dead || !box) return;
          embedPostcode(box, addr => {
            setF(prev => ({ ...prev, address: addr }));
            setAddrOpen(false);
          });
        });
      })
      .catch(e => setAddrErr(e instanceof Error ? e.message : "주소 검색을 불러오지 못했어요."));
    return () => { dead = true; };
  }, [addrOpen]);

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  const kwDigits = kw.replace(/\D/g, "");
  const shown = [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "ko")).filter(s => (!itemSel || itemsOf(s.handles).includes(itemSel))).filter(s => (!kw || norm(s.name).includes(kw) || norm(s.handles).includes(kw) || norm(s.address).includes(kw) || (kwDigits !== "" && s.phone.replace(/\D/g, "").includes(kwDigits))));

  // 등록된 품목과 거래처 수 (많은 순). 칩과 묶음의 기준이 된다.
  const allItems = (() => { const m = new Map<string, number>(); suppliers.forEach(x => itemsOf(x.handles).forEach(i => m.set(i, (m.get(i) ?? 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")); })();
  // 품목별 묶음: 거래처가 여러 품목을 취급하면 각 묶음에 모두 나온다. 품목이 없는 거래처는 맨 아래.
  const groups: [string, SupplierLite[]][] = (() => {
    const m = new Map<string, SupplierLite[]>();
    for (const x of shown) {
      const its = itemsOf(x.handles);
      for (const i of its.length ? its : [NONE]) m.set(i, [...(m.get(i) ?? []), x]);
    }
    return [...m.entries()].filter(([k]) => !itemSel || k === itemSel).sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, "ko")));
  })();

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

  // 거래처 목록(표 + 휴대폰 카드) 한 덩어리
  const renderList = (rows: SupplierLite[]) => (
          <>
            {/* 넓은 화면: 한 줄에 거래처 한 곳 */}
            <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-black/10 bg-white md:block dark:border-white/10 dark:bg-zinc-900">
              <table className="w-full min-w-[40rem] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[24%]" />
                  <col className="w-[17%]" />
                  <col />
                  {(canEdit || canDelete) && <col className="w-36" />}
                </colgroup>
                <thead className="bg-zinc-50 text-xs font-bold text-zinc-500 dark:bg-zinc-800/60">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2.5">거래처</th>
                    <th className="whitespace-nowrap px-3 py-2.5">취급품목</th>
                    <th className="whitespace-nowrap px-3 py-2.5">연락처</th>
                    <th className="whitespace-nowrap px-3 py-2.5">주소</th>
                    {(canEdit || canDelete) && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.id} className="border-t border-black/10 align-middle hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-800/50">
                      <td className="break-words px-4 py-3 text-base font-extrabold"><NameLink name={s.name} address={s.address} /></td>
                      <td className="break-words px-3 py-3">{s.handles || <span className="text-zinc-400">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3">{s.phone ? <a href={telHref(s.phone)} aria-label={s.name + " 연락하기 (전화 걸기)"} className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">📞 연락하기</a> : <span className="text-zinc-400">-</span>}</td>
                      <td className="break-words px-3 py-3 text-zinc-700 dark:text-zinc-300">{s.address || <span className="text-zinc-400">-</span>}</td>
                      {(canEdit || canDelete) && (
                        <td className="px-3 py-3">
                          <span className="flex justify-end gap-1.5">
                            {canEdit && <button type="button" onClick={() => openForm(s)} className="whitespace-nowrap rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>}
                            {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s }); }} className="whitespace-nowrap rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
  
            {/* 좁은 화면(휴대폰): 한 줄 요약 카드 — 연락하기 버튼은 오른쪽에 크게 (번호는 화면에 보이지 않는다) */}
            <ul className="mt-4 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-white md:hidden dark:divide-white/10 dark:border-white/10 dark:bg-zinc-900">
              {rows.map(s => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-base"><NameLink name={s.name} address={s.address} /></b>
                    {s.handles && <span className="block truncate text-sm text-zinc-600 dark:text-zinc-300">{s.handles}</span>}
                    {s.address && <span className="block truncate text-xs text-zinc-500">{s.address}</span>}
                    {(canEdit || canDelete) && (
                      <span className="mt-1.5 flex gap-1.5">
                        {canEdit && <button type="button" onClick={() => openForm(s)} className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-bold dark:bg-zinc-800">수정</button>}
                        {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s }); }} className="rounded-lg bg-red-50 px-3 py-1 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                      </span>
                    )}
                  </div>
                  {s.phone && <a href={telHref(s.phone)} aria-label={s.name + " 전화 걸기"} className="shrink-0 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white">📞 연락하기</a>}
                </li>
              ))}
            </ul>
          </>
  );

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">거래처관리</h1>
        <span className="text-sm text-zinc-500">총 {suppliers.length}곳</span>
        <button type="button" onClick={() => void printElement(document.getElementById("supplier-ledger"), { title: "거래처 목록", heading: "거래처 목록" })} disabled={shown.length === 0} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15">🖨 인쇄</button>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 거래처 등록</button>}
      </header>
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="거래처 이름·취급품목·주소·전화 검색" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 sm:max-w-md dark:border-white/15 dark:bg-zinc-900" />
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([[true, "품목별 묶음"], [false, "전체 목록"]] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={grouped === v} onClick={() => setGrouped(v)} className={`px-3.5 py-2.5 ${grouped === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
          ))}
        </div>
      </div>
      {allItems.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="취급품목">
          <span className="text-xs font-bold text-zinc-500">품목</span>
          {allItems.map(([name, n]) => <button key={name} type="button" aria-pressed={itemSel === name} onClick={() => setItemSel(itemSel === name ? "" : name)} className={`rounded-full px-2.5 py-1 text-xs font-bold ${itemSel === name ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200"}`}>{name}<small className="ml-1 opacity-70">{n}</small></button>)}
          {itemSel && <button type="button" onClick={() => setItemSel("")} className="text-xs font-bold text-zinc-500 underline">품목 해제</button>}
        </div>
      )}
      {suppliers.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 거래처가 없어요.</p>}
      {suppliers.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">검색 결과가 없어요.</p>}
      {/* 인쇄 전용 목록: 화면에는 보이지 않는다. 종이에서는 바로 전화할 수 없으니 연락처를 적는다. */}
      <div id="supplier-ledger" className="hidden">
        {(grouped ? groups : ([["", shown]] as [string, SupplierLite[]][])).map(([name, rows]) => (
          <div key={name || "all"} style={{ marginBottom: "14px", breakInside: "avoid" }}>
            {name && <h2 style={{ fontSize: "14px", fontWeight: 800, margin: "0 0 4px" }}>{name} <span style={{ fontWeight: 400, fontSize: "11px" }}>{rows.length}곳</span></h2>}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr>{["거래처", "취급품목", "연락처", "주소"].map(h => <th key={h} style={{ border: "1px solid #999", background: "#eee", padding: "5px 6px", textAlign: "left" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id}>
                    {[s.name, s.handles, s.phone, s.address].map((c, i) => <td key={i} style={{ border: "1px solid #999", padding: "5px 6px", verticalAlign: "top", fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {shown.length > 0 && (grouped ? (
        <div className="mt-4 space-y-6">
          {groups.map(([name, rows]) => (
            <section key={name} aria-label={name}>
              <h2 className="flex items-center gap-2 text-base font-extrabold"><span className={name === NONE ? "text-zinc-500" : "rounded-full bg-blue-50 px-3 py-0.5 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"}>{name}</span><span className="text-sm font-semibold text-zinc-500">{rows.length}곳</span></h2>
              {renderList(rows)}
            </section>
          ))}
        </div>
      ) : renderList(shown))}

      <Modal open={dlg?.t === "form"} onClose={close}>
        <form onSubmit={e => { e.preventDefault(); void call(formId ? { action: "update", id: formId, ...f } : { action: "add", ...f }, formId ? "거래처 정보를 수정했어요" : "“" + f.name.trim() + "” 거래처를 등록했어요"); }}>
          <h2 className="text-lg font-bold">{formId ? "거래처 수정" : "거래처 등록"}</h2>
          <p className="mt-1 text-sm text-zinc-500">거래처 이름만 있으면 등록돼요. 취급품목·연락처·주소는 알고 있는 것만 적어 주세요.</p>
          <label htmlFor="sp-name" className="mt-4 block text-sm font-bold">거래처 이름</label>
          <input id="sp-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="예: 가나다 철물 (같은 이름이 있으면 구분)" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-handles" className="mt-4 block text-sm font-bold">취급품목 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-handles" value={f.handles} onChange={e => setF({ ...f, handles: e.target.value })} maxLength={100} placeholder="예: 합판, 각재, 방부목 (여러 개는 쉼표로)" autoComplete="off" className={inputCls} />
          <p className="mt-1 text-xs text-zinc-500">쉼표(,)로 나눠 적으면 품목마다 묶어서 볼 수 있어요.</p>
          <label htmlFor="sp-phone" className="mt-4 block text-sm font-bold">연락처 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: formatPhone(e.target.value) })} maxLength={13} placeholder="예: 010-1234-5678" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-addr" className="mt-4 block text-sm font-bold">주소 <span className="font-normal text-zinc-500">(선택)</span></label>
          <div className="mt-2 flex gap-2">
            <input id="sp-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="주소 찾기로 도로명 주소를 골라요" autoComplete="off" className={inputCls.replace("mt-1.5 w-full ", "") + " min-w-0 flex-1"} />
            <button type="button" onClick={() => { setAddrErr(""); setAddrOpen(true); }} className="shrink-0 rounded-xl bg-zinc-100 px-4 text-sm font-bold dark:bg-zinc-800">주소 찾기</button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">고른 뒤 동·호수 같은 상세 주소는 이어서 적어요.</p>
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "등록"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={addrOpen} onClose={() => setAddrOpen(false)} wide>
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">도로명 주소 찾기</h2>
          <button type="button" onClick={() => setAddrOpen(false)} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">도로명·건물명·지번으로 검색해 고르세요.</p>
        {addrErr ? <p className="mt-3 text-sm text-red-500" role="alert">{addrErr}</p> : <div ref={addrBox} className="mt-3 h-[28rem] max-h-[60vh] overflow-hidden rounded-xl border border-black/10 dark:border-white/10" />}
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
