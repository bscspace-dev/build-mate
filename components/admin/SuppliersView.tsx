"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { printElement } from "@/lib/print-client";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-export";
import { formatPhone } from "@/lib/member-utils";
import { embedPostcode, loadPostcode } from "@/lib/postcode-client";

export type SupplierLite = { id: string; name: string; handles: string; phone: string; address: string; note: string };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

const TAB_SHOW = 10; // 품목 탭은 많은 순으로 이만큼만 보이고, 나머지는 「더보기」
const PAGE = 20; // 한 쪽에 보여 줄 거래처 수
const STAR = "★ 즐겨찾기";
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

type Form = { name: string; handles: string; phone: string; address: string; note: string };

// 거래처(운영관리 메뉴 아래): 목록 보기 + (권한에 따라) 등록·수정·삭제.
export default function SuppliersView({
  suppliers, stars, canRegister, canEdit, canDelete,
}: {
  suppliers: SupplierLite[]; stars: string[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const empty: Form = { name: "", handles: "", phone: "", address: "", note: "" };
  const [q, setQ] = useState("");
  const [grouped, setGrouped] = useState(true); // 취급품목별로 묶어 보기
  // 즐겨찾기(별표): 계정마다 따로 저장되어 나에게만 적용되고, 별표한 거래처는 맨 위에 모아 보여 준다
  const [starIds, setStarIds] = useState<string[]>(stars);
  useEffect(() => setStarIds(stars), [stars]);
  const starSet = new Set(starIds);
  async function toggleStar(id: string) {
    const on = !starSet.has(id);
    setStarIds(k => (on ? [...k, id] : k.filter(x => x !== id)));
    try {
      const r = await fetch("/api/admin/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "star", ids: [id], on }) });
      if (!r.ok) throw new Error();
    } catch {
      setStarIds(k => (on ? k.filter(x => x !== id) : [...k, id])); // 저장하지 못하면 되돌린다
      setErr("즐겨찾기를 저장하지 못했어요.");
    }
  }
  const starBtn = (s: SupplierLite) => (
    <span className="ml-1 align-middle" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={() => void toggleStar(s.id)} aria-pressed={starSet.has(s.id)} aria-label={`${s.name} 즐겨찾기 ${starSet.has(s.id) ? "해제" : "등록"}`} title="즐겨찾기 (나에게만 적용돼요)" className={`shrink-0 cursor-pointer text-lg leading-none ${starSet.has(s.id) ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}>{starSet.has(s.id) ? "★" : "☆"}</button>
    </span>
  );
  const [tabsOpen, setTabsOpen] = useState(false); // 품목 탭 전체 펼치기
  const [itemSel, setItemSel] = useState(""); // 이 품목을 취급하는 거래처만
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; s: SupplierLite } | null>(null);
  const [f, setF] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [addrOpen, setAddrOpen] = useState(false); // 도로명 주소 찾기 창
  const [addrErr, setAddrErr] = useState("");
  const addrBox = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false); // 「편집하기」를 눌러야 등록·수정·삭제가 보인다
  const [draft, setDraft] = useState<(Form & { id: string; focus: keyof Form }) | null>(null); // 지금 고치고 있는 줄 (「저장」을 눌러야 반영된다)
  const addrCell = useRef(false); // 주소 찾기를 누른 곳이 고치는 줄이면 true (아니면 새 거래처 줄)

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
            if (addrCell.current) setDraft(d => (d ? { ...d, address: addr } : d));
            else setF(prev => ({ ...prev, address: addr }));
            addrCell.current = false;
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
  const shown = [...suppliers].sort((a, b) => a.name.localeCompare(b.name, "ko")).sort((a, b) => Number(starSet.has(b.id)) - Number(starSet.has(a.id))).filter(s => (!itemSel || itemsOf(s.handles).includes(itemSel))).filter(s => (!kw || norm(s.name).includes(kw) || norm(s.handles).includes(kw) || norm(s.address).includes(kw) || norm(s.note).includes(kw) || (kwDigits !== "" && s.phone.replace(/\D/g, "").includes(kwDigits))));

  // 등록된 품목과 거래처 수 (많은 순). 칩과 묶음의 기준이 된다.
  const allItems = (() => { const m = new Map<string, number>(); suppliers.forEach(x => itemsOf(x.handles).forEach(i => m.set(i, (m.get(i) ?? 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")); })();
  // 품목별 묶음: 거래처가 여러 품목을 취급하면 각 묶음에 모두 나온다. 품목이 없는 거래처는 맨 아래.
  const groups: [string, SupplierLite[]][] = (() => {
    const m = new Map<string, SupplierLite[]>();
    for (const x of shown) {
      const its = starSet.has(x.id) ? [STAR] : itemsOf(x.handles); // 별표한 거래처는 맨 위 「즐겨찾기」 묶음에만
      for (const i of its.length ? its : [NONE]) m.set(i, [...(m.get(i) ?? []), x]);
    }
    return [...m.entries()].filter(([k]) => !itemSel || k === itemSel || k === STAR).sort(([a], [b]) => (a === STAR ? -1 : b === STAR ? 1 : a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, "ko")));
  })();

  const sig = `${q}|${itemSel}|${grouped}`;
  const [pg, setPg] = useState({ sig, page: 1 });
  const entries = grouped ? groups.flatMap(([g, rows]) => rows.map((r, idx) => ({ g, r, idx }))) : shown.map((r, idx) => ({ g: "", r, idx }));
  const pages = Math.max(1, Math.ceil(entries.length / PAGE));
  const page = Math.min(pg.sig === sig ? pg.page : 1, pages);
  const goPage = (n: number) => setPg({ sig, page: Math.min(Math.max(n, 1), pages) });
  const pagedGroups: { g: string; start: number; rows: SupplierLite[] }[] = [];
  for (const e of entries.slice((page - 1) * PAGE, page * PAGE)) {
    const last = pagedGroups[pagedGroups.length - 1];
    if (last && last.g === e.g) last.rows.push(e.r);
    else pagedGroups.push({ g: e.g, start: e.idx, rows: [e.r] });
  }
  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(done);
      setTimeout(() => setToast(""), 2500);
      setDlg(null);
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  // 고친 줄을 「저장」 (바뀐 게 없으면 그냥 닫는다)
  async function saveRow(orig: SupplierLite) {
    if (!draft || draft.id !== orig.id) return;
    const v = { name: draft.name.trim(), handles: draft.handles.trim(), phone: draft.phone.trim(), address: draft.address.trim(), note: draft.note.trim() };
    if (!v.name) { setErr("거래처 이름을 적어 주세요."); return; }
    if (v.name === orig.name && v.handles === orig.handles && v.phone === orig.phone && v.address === orig.address && v.note === orig.note) { setDraft(null); return; }
    if (await call({ action: "update", id: orig.id, ...v }, "저장했어요")) setDraft(null);
  }
  async function addRow() {
    if (!f.name.trim()) return;
    if (await call({ action: "add", ...f }, "“" + f.name.trim() + "” 거래처를 등록했어요")) setF(empty);
  }
  const FIELD_MAX: Record<keyof Form, number> = { name: 40, handles: 100, phone: 14, address: 200, note: 200 };
  const editCell = (s: SupplierLite, field: keyof Form, cls: string, show: React.ReactNode) => {
    const on = editing && canEdit;
    const cur = draft && draft.id === s.id ? draft : null; // 이 줄을 고치는 중이면 칸마다 입력칸
    return (
      <td className={`${cls} ${on && !cur ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={on && !cur ? "눌러서 수정" : undefined} onClick={on && !cur ? () => { setErr(""); setDraft({ id: s.id, name: s.name, handles: s.handles, phone: s.phone, address: s.address, note: s.note, focus: field }); } : undefined}>
        {cur ? (
          <div className="flex items-center gap-1">
            <input autoFocus={cur.focus === field} value={cur[field]} maxLength={FIELD_MAX[field]} aria-label={s.name + " " + field}
              onChange={e => setDraft({ ...cur, [field]: field === "phone" ? formatPhone(e.target.value) : e.target.value })}
              onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveRow(s); if (e.key === "Escape") setDraft(null); }}
              className="w-full min-w-0 rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
            {field === "address" && <button type="button" onClick={() => { addrCell.current = true; setAddrErr(""); setAddrOpen(true); }} className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-bold dark:bg-zinc-800">찾기</button>}
          </div>
        ) : show}
      </td>
    );
  };
  // 엑셀 내보내기: 지금 검색·품목으로 걸러진 거래처 목록을 엑셀 파일로 받는다
  function exportXlsx() {
    downloadBlob(buildXlsx([{ name: "거래처", header: ["#", "거래처", "취급품목", "연락처", "주소", "비고"], widths: [5, 20, 28, 16, 44, 30], rows: shown.map((s, i) => [i + 1, s.name, s.handles, s.phone, s.address, s.note]) }]), `거래처_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}.xlsx`);
  }
  const openForm = (s: SupplierLite | null) => {
    setErr("");
    setF(s ? { name: s.name, handles: s.handles, phone: s.phone, address: s.address, note: s.note } : empty);
    setDlg({ t: "form", id: s?.id ?? null });
  };
  const close = () => { if (!busy) setDlg(null); };
  const formId = dlg?.t === "form" ? dlg.id : null;

  // 거래처 목록(표 + 휴대폰 카드) 한 덩어리
  const renderList = (rows: SupplierLite[], offset = 0) => (
          <>
            {/* 넓은 화면: 엑셀 시트처럼 칸마다 선이 있는 표 — 「편집하기」 중에는 칸을 눌러 바로 고친다 */}
            <div className="mt-4 hidden max-h-[75vh] overflow-auto rounded-lg border border-black/15 bg-white md:block dark:border-white/15 dark:bg-zinc-900">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[20%]" />
                  <col className="w-[22%]" />
                  <col className="w-36" />
                  <col />
                  <col className="w-[16%]" />
                  {editing && (canDelete || canEdit) && <col className="w-32" />}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-zinc-100 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  <tr>
                    <th className="whitespace-nowrap border border-black/15 px-2 py-1.5 text-center dark:border-white/15">#</th>
                    <th className="whitespace-nowrap border border-black/15 px-2.5 py-1.5 dark:border-white/15">거래처</th>
                    <th className="whitespace-nowrap border border-black/15 px-2.5 py-1.5 dark:border-white/15">취급품목</th>
                    <th className="whitespace-nowrap border border-black/15 px-2.5 py-1.5 dark:border-white/15">연락처</th>
                    <th className="whitespace-nowrap border border-black/15 px-2.5 py-1.5 dark:border-white/15">주소</th>
                    <th className="whitespace-nowrap border border-black/15 px-2.5 py-1.5 dark:border-white/15">비고</th>
                    {editing && (canDelete || canEdit) && <th className="border border-black/15 px-2 py-1.5 dark:border-white/15" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => {
                    const ed = editing && canEdit; // 편집 중에는 글자를 눌러도 링크로 넘어가지 않는다
                    return (
                      <tr key={s.id} className="odd:bg-white even:bg-zinc-50/60 hover:bg-blue-50 dark:odd:bg-zinc-900 dark:even:bg-zinc-800/30 dark:hover:bg-blue-500/10">
                        <td className="border border-black/10 px-2 py-1.5 text-center text-xs text-zinc-400 dark:border-white/10">{offset + i + 1}</td>
                        {editCell(s, "name", "border border-black/10 px-2.5 py-1.5 dark:border-white/10 break-words font-bold", <>{ed ? s.name : <NameLink name={s.name} address={s.address} />}{starBtn(s)}</>)}
                        {editCell(s, "handles", "border border-black/10 px-2.5 py-1.5 dark:border-white/10 break-words", s.handles || <span className="text-zinc-400">{ed ? "눌러서 입력" : "-"}</span>)}
                        {editCell(s, "phone", "border border-black/10 px-2.5 py-1.5 dark:border-white/10 whitespace-nowrap tabular-nums", s.phone ? (ed ? s.phone : <a href={telHref(s.phone)} aria-label={s.name + " 연락하기 (전화 걸기)"} title="눌러서 전화 걸기" className="font-semibold text-emerald-700 hover:underline dark:text-emerald-300">{s.phone}</a>) : <span className="text-zinc-400">{ed ? "눌러서 입력" : "-"}</span>)}
                        {editCell(s, "address", "border border-black/10 px-2.5 py-1.5 dark:border-white/10 break-words text-zinc-700 dark:text-zinc-300", s.address || <span className="text-zinc-400">{ed ? "눌러서 입력" : "-"}</span>)}
                        {editCell(s, "note", "border border-black/10 px-2.5 py-1.5 dark:border-white/10 break-words text-zinc-700 dark:text-zinc-300", s.note || <span className="text-zinc-400">{ed ? "눌러서 입력" : "-"}</span>)}
                        {editing && (canDelete || canEdit) && (
                          <td className="border border-black/10 px-2 py-1.5 text-center dark:border-white/10">
                            {draft?.id === s.id ? (
                              <span className="flex justify-center gap-1">
                                <button type="button" disabled={busy} onClick={() => void saveRow(s)} className="whitespace-nowrap rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
                                <button type="button" disabled={busy} onClick={() => setDraft(null)} className="whitespace-nowrap rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">취소</button>
                              </span>
                            ) : (
                              <span className="flex justify-center gap-1">
                                {canEdit && <button type="button" onClick={() => { setErr(""); setDraft({ id: s.id, name: s.name, handles: s.handles, phone: s.phone, address: s.address, note: s.note, focus: "name" }); }} className="whitespace-nowrap rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">수정</button>}
                                {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s }); }} className="whitespace-nowrap rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 좁은 화면(휴대폰): 한 줄 요약 카드 — 연락하기 버튼은 오른쪽에 크게 (번호는 화면에 보이지 않는다) */}
            <ul className="mt-4 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-white md:hidden dark:divide-white/10 dark:border-white/10 dark:bg-zinc-900">
              {rows.map(s => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-base"><NameLink name={s.name} address={s.address} />{starBtn(s)}</b>
                    {s.handles && <span className="block truncate text-sm text-zinc-600 dark:text-zinc-300">{s.handles}</span>}
                    {s.address && <span className="block truncate text-xs text-zinc-500">{s.address}</span>}
                    {s.note && <span className="block truncate text-xs text-amber-700 dark:text-amber-300">비고: {s.note}</span>}
                    {editing && (canEdit || canDelete) && (
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
        <button type="button" onClick={() => void printElement(document.getElementById("supplier-ledger"), { title: "거래처 목록", heading: "거래처 목록" })} disabled={shown.length === 0} className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200">🖨 인쇄</button>
        <button type="button" onClick={exportXlsx} disabled={shown.length === 0} className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-200">📥 엑셀 내보내기</button>
        {editing && canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white md:hidden">+ 거래처 등록</button>}
      </header>
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && !dlg && !addrOpen && <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="거래처 이름·취급품목·주소·전화 검색" className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 sm:max-w-md dark:border-white/15 dark:bg-zinc-900" />
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([[true, "품목별 묶음"], [false, "전체 목록"]] as const).map(([v, label]) => (
            <button key={label} type="button" aria-pressed={grouped === v} onClick={() => setGrouped(v)} className={`px-3.5 py-2.5 ${grouped === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
          ))}
        </div>
      </div>
      {allItems.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-1 border-b border-black/15 dark:border-white/15" role="tablist" aria-label="취급품목">
          <button type="button" role="tab" aria-selected={!itemSel} onClick={() => setItemSel("")} className={`rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${!itemSel ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>전체<small className="ml-1 opacity-70">{suppliers.length}</small></button>
          {allItems.filter(([name], i) => tabsOpen || i < TAB_SHOW || name === itemSel).map(([name, n]) => <button key={name} type="button" role="tab" aria-selected={itemSel === name} onClick={() => setItemSel(itemSel === name ? "" : name)} className={`rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${itemSel === name ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{name}<small className="ml-1 opacity-70">{n}</small></button>)}
          {allItems.length > TAB_SHOW && <button type="button" onClick={() => setTabsOpen(v => !v)} aria-expanded={tabsOpen} className="mb-px ml-1 rounded-t-lg px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10">{tabsOpen ? "접기 ▲" : `더보기 +${allItems.length - TAB_SHOW} ▼`}</button>}
        </div>
      )}
      {editing && canRegister && (
        <div className="mt-4 hidden items-center gap-2 rounded-lg border border-blue-300 bg-blue-50/60 p-2 text-sm md:flex dark:border-blue-500/40 dark:bg-blue-500/10">
          <span className="shrink-0 px-1 text-xs font-extrabold text-blue-700 dark:text-blue-300">＋ 새 거래처</span>
          {([["name", "거래처 이름 (필수)", "w-[18%]"], ["handles", "취급품목 (쉼표로)", "w-[20%]"], ["phone", "연락처", "w-32"], ["address", "주소", "min-w-0 flex-1"], ["note", "비고", "w-[14%]"]] as const).map(([k, ph, w]) => (
            <input key={k} value={f[k]} maxLength={FIELD_MAX[k]} placeholder={ph} aria-label={ph} onChange={e => setF({ ...f, [k]: k === "phone" ? formatPhone(e.target.value) : e.target.value })} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void addRow(); }} className={`${w} rounded-md border border-black/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900`} />
          ))}
          <button type="button" onClick={() => { addrCell.current = false; setAddrErr(""); setAddrOpen(true); }} className="shrink-0 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-bold dark:bg-zinc-800">주소 찾기</button>
          <button type="button" disabled={busy || !f.name.trim()} onClick={() => void addRow()} className="shrink-0 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-bold text-white disabled:opacity-50">추가</button>
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
                <tr>{["거래처", "취급품목", "연락처", "주소", "비고"].map(h => <th key={h} style={{ border: "1px solid #999", background: "#eee", padding: "5px 6px", textAlign: "left" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id}>
                    {[s.name, s.handles, s.phone, s.address, s.note].map((c, i) => <td key={i} style={{ border: "1px solid #999", padding: "5px 6px", verticalAlign: "top", fontWeight: i === 0 ? 700 : 400 }}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {shown.length > 0 && (grouped ? (
        <div className="mt-4 space-y-6">
          {pagedGroups.map(({ g: name, start, rows }) => (
            <section key={name} aria-label={name}>
              <h2 className="flex items-center gap-2 text-base font-extrabold"><span className={name === STAR ? "rounded-full bg-amber-50 px-3 py-0.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200" : name === NONE ? "text-zinc-500" : "rounded-full bg-blue-50 px-3 py-0.5 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"}>{name}</span><span className="text-sm font-semibold text-zinc-500">{groups.find(([n]) => n === name)?.[1].length ?? rows.length}곳</span></h2>
              {renderList(rows, start)}
            </section>
          ))}
        </div>
      ) : renderList(pagedGroups[0]?.rows ?? [], pagedGroups[0]?.start ?? 0))}
      {pages > 1 && (
        <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5 text-sm" aria-label="쪽 이동">
          <button type="button" onClick={() => goPage(page - 1)} disabled={page <= 1} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-40 dark:bg-zinc-800">이전</button>
          {Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - page) <= 2).map((n, i, arr) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - arr[i - 1] > 1 && <span className="text-zinc-400">…</span>}
              <button type="button" onClick={() => goPage(n)} aria-current={n === page ? "page" : undefined} className={`min-w-9 rounded-lg px-3 py-1.5 font-bold ${n === page ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{n}</button>
            </span>
          ))}
          <button type="button" onClick={() => goPage(page + 1)} disabled={page >= pages} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-40 dark:bg-zinc-800">다음</button>
          <span className="ml-2 text-xs text-zinc-500">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, entries.length)} / {entries.length}{grouped ? " (품목별 묶음 기준)" : "곳"}</span>
        </nav>
      )}

      {canRegister && canEdit && canDelete && ( /* 등록·수정·삭제 권한을 모두 가진 사람만 편집하기를 쓸 수 있다 (일부 권한만 있으면 보기만) */
        <button type="button" onClick={() => { setEditing(v => !v); setDraft(null); setErr(""); }} aria-pressed={editing} title="눌러야 표의 칸을 고치고 거래처를 추가·삭제할 수 있어요" className={`fixed bottom-5 right-4 z-50 rounded-full px-5 py-3 text-sm font-extrabold shadow-lg ring-2 ring-white/70 dark:ring-black/40 ${editing ? "bg-blue-600 text-white" : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"}`}>{editing ? "✔ 편집 끝내기" : "✏️ 편집하기"}</button>
      )}

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
          <input id="sp-phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: formatPhone(e.target.value) })} maxLength={14} placeholder="예: 010-1234-5678" autoComplete="off" className={inputCls} />
          <label htmlFor="sp-addr" className="mt-4 block text-sm font-bold">주소 <span className="font-normal text-zinc-500">(선택)</span></label>
          <div className="mt-2 flex gap-2">
            <input id="sp-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="주소 찾기로 도로명 주소를 골라요" autoComplete="off" className={inputCls.replace("mt-1.5 w-full ", "") + " min-w-0 flex-1"} />
            <button type="button" onClick={() => { setAddrErr(""); setAddrOpen(true); }} className="shrink-0 rounded-xl bg-zinc-100 px-4 text-sm font-bold dark:bg-zinc-800">주소 찾기</button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">고른 뒤 동·호수 같은 상세 주소는 이어서 적어요.</p>
          <label htmlFor="sp-note" className="mt-4 block text-sm font-bold">비고 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="sp-note" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="예: 월말 정산, 배송 가능" autoComplete="off" className={inputCls} />
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
