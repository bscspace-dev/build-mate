"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import SiteCalendar from "@/components/admin/SiteCalendar";
import { shrink } from "@/components/admin/AddProduct";
import { addDays, daysBetween, extensionDays, fmtDate, sitePeriod, totalExtension } from "@/lib/site-period";
import type { Site } from "@/lib/types";

export type PmLite = { id: string; name: string; team: string; isPm: boolean };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
type Form = { name: string; address: string; pmId: string; startDate: string; endDate: string; memo: string };
const EMPTY: Form = { name: "", address: "", pmId: "", startDate: "", endDate: "", memo: "" };

// 마감일을 바꾼 현장에 붙는 표시: 처음 마감일 기준으로 지금까지 며칠 연장(또는 단축)됐는지
function ExtBadge({ s }: { s: Site }) {
  const t = totalExtension(s.extensions);
  if (s.extensions.length === 0 || t === 0) return null;
  return <span className={`ml-1.5 rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${t > 0 ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200" : "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200"}`}>{t > 0 ? `연장 +${t}일` : `단축 ${t}일`}</span>;
}

// 현장일정(현장관리 메뉴 아래): 자재 요청에서 고르는 현장을 등록·수정·삭제한다. 항목: 현장명 · 공사기간 · 담당 PM · 현장 주소 · 특이사항
export default function SitesAdmin({
  sites, pms, canRegister, canEdit, canDelete,
}: {
  sites: Site[]; pms: PmLite[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [yearSel, setYearSel] = useState(""); // 목록 필터: 년도 ("" = 전체)
  const [monthSel, setMonthSel] = useState(""); // 목록 필터: 월 "01"~"12" ("" = 전체)
  const [baseEnd, setBaseEnd] = useState(""); // 수정을 시작할 때의 마감일 (연장 일수 기준)
  const [view, setView] = useState<"cal" | "list">("cal"); // 달력(스케줄러) / 목록
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; s: Site } | { t: "view"; s: Site } | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  // 현장 사진(여러 장): 기존 사진 중 남길 것(keep) + 새로 고른 사진들
  const [keep, setKeep] = useState<string[]>([]);
  const [fresh, setFresh] = useState<{ id: number; file: File; url: string }[]>([]);
  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list]; // FileList 는 입력칸을 비우면 같이 비워지므로, 비우기 전에 배열로 복사해 둔다
    setFresh(prev => {
      const room = 10 - keep.length - prev.length;
      const add = picked.slice(0, Math.max(0, room)).map((file, i) => ({ id: Date.now() + i, file, url: URL.createObjectURL(file) }));
      return [...prev, ...add];
    });
  };
  const dropFresh = (id: number) => setFresh(prev => { const x = prev.find(p => p.id === id); if (x) URL.revokeObjectURL(x.url); return prev.filter(p => p.id !== id); });
  const resetPhotos = (existing: string[]) => { fresh.forEach(p => URL.revokeObjectURL(p.url)); setFresh([]); setKeep(existing); };
  const pmMap = new Map(pms.map(p => [p.id, p]));
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  // 목록은 공사 시작월(시작일이 없으면 종료월) 기준으로 년·월별로 묶는다. 최근 달이 위, 공사기간 미정은 맨 아래.
  const monthOf = (x: Site) => (x.startDate || x.endDate).slice(0, 7);
  // 년도 선택지: 등록된 현장의 시작년도들 (+ 올해). 최근 년도가 위.
  const nowYear = new Date().getFullYear();
  const years = [...new Set([String(nowYear), ...sites.map(x => monthOf(x).slice(0, 4)).filter(Boolean)])].sort((a, b) => b.localeCompare(a));
  const dateFiltered = yearSel !== "" || monthSel !== "";
  const inPeriod = (x: Site) => {
    if (!dateFiltered) return true;
    const mo = monthOf(x);
    if (!mo) return false; // 공사기간 미정 현장은 년·월을 고르면 숨는다
    return (!yearSel || mo.slice(0, 4) === yearSel) && (!monthSel || mo.slice(5, 7) === monthSel);
  };
  const shown = sites.filter(s => inPeriod(s) && (!kw || norm(`${s.name}${s.address}${s.memo}${pmMap.get(s.pmId)?.name ?? ""}`).includes(kw)));

  const groups = (() => {
    const m = new Map<string, Site[]>();
    for (const x of shown) m.set(monthOf(x) || "미정", [...(m.get(monthOf(x) || "미정") ?? []), x]);
    for (const list of m.values()) list.sort((a, b) => (a.startDate || a.endDate).localeCompare(b.startDate || b.endDate) || a.name.localeCompare(b.name, "ko"));
    return [...m.entries()].sort(([a], [b]) => (a === "미정" ? 1 : b === "미정" ? -1 : b.localeCompare(a)));
  })();
  const thisMonth = new Date().toLocaleDateString("sv-SE").slice(0, 7);

  async function call(body: Record<string, unknown> | FormData, done: string) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/sites", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
  const openForm = (s: Site | null) => {
    setErr("");
    setF(s ? { name: s.name, address: s.address, pmId: pmMap.has(s.pmId) ? s.pmId : "", startDate: s.startDate, endDate: s.endDate, memo: s.memo } : EMPTY);
    resetPhotos(s?.photos ?? []);
    setBaseEnd(s?.endDate ?? "");
    setDlg({ t: "form", id: s?.id ?? null });
  };
  const close = () => { if (!busy) { resetPhotos([]); setDlg(null); } };
  async function submitForm() {
    if (dateBad || busy) return;
    const fd = new FormData();
    fd.set("action", formId ? "update" : "add");
    if (formId) fd.set("id", formId);
    (Object.keys(f) as (keyof Form)[]).forEach(k => fd.set(k, f[k]));
    try {
      if (formId) fd.set("keep", JSON.stringify(keep));
      for (const p of fresh) {
        const blob = await shrink(p.file);
        fd.append("photo", new File([blob], blob.type === "image/webp" ? "site.webp" : "site.jpg", { type: blob.type }));
      }
    } catch {
      return setErr("사진을 처리하지 못했어요. 다른 사진으로 해 보세요.");
    }
    await call(fd, formId ? "현장 정보를 수정했어요" : "현장을 등록했어요");
  }
  const formId = dlg?.t === "form" ? dlg.id : null;
  const dateBad = !!f.startDate && !!f.endDate && f.endDate < f.startDate;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">현장일정</h1>
        <span className="text-sm text-zinc-500">총 {sites.length}곳</span>
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([["cal", "📅 달력"], ["list", "☰ 목록"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-3.5 py-2 ${view === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
          ))}
        </div>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 현장 등록</button>}
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">여기에 등록한 현장이 자재 요청의 “요청하기”에서 선택지로 나와요. 현장명을 바꾸거나 지워도 이미 들어온 요청에는 당시 이름이 그대로 남아요.</p>
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {view === "cal" ? (
        <div className="mt-2"><SiteCalendar sites={sites} onPick={x => { setErr(""); setDlg({ t: "view", s: x }); }} /></div>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="현장명·주소·담당 PM 검색" className="min-w-[12rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900" />
        <select aria-label="년도" value={yearSel} onChange={e => setYearSel(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
          <option value="">전체 년도</option>
          {years.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select aria-label="월" value={monthSel} onChange={e => setMonthSel(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
          <option value="">전체 월</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{i + 1}월</option>)}
        </select>
        <button type="button" onClick={() => { setYearSel(String(nowYear)); setMonthSel(String(new Date().getMonth() + 1).padStart(2, "0")); }} className="rounded-xl bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">이번 달</button>
        {dateFiltered && <button type="button" onClick={() => { setYearSel(""); setMonthSel(""); }} className="rounded-xl bg-zinc-100 px-3 py-2.5 text-sm font-bold dark:bg-zinc-800">필터 해제</button>}
      </div>
      {sites.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 현장이 없어요.{canRegister ? " 위의 “현장 등록”으로 추가해 주세요." : ""}</p>}
      {sites.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">검색 결과가 없어요.</p>}
      {groups.map(([key, list]) => (
      <section key={key} className="mt-5" aria-label={key === "미정" ? "공사기간 미정" : key.replace("-", "년 ") + "월"}>
        <h2 className="flex items-center gap-2 text-base font-extrabold">
          {key === "미정" ? "공사기간 미정" : `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월`}
          {key === thisMonth && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">이번 달</span>}
          <span className="text-sm font-semibold text-zinc-500">{list.length}곳</span>
        </h2>
      <ul className="mt-2 space-y-2">
        {list.map(s => {
          const p = sitePeriod(s.startDate, s.endDate);
          const pm = pmMap.get(s.pmId);
          return (
            <li key={s.id} className={`rounded-2xl border p-4 ${p.urgent ? "border-red-400 bg-red-50 dark:border-red-500/50 dark:bg-red-500/10" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
              <div className="flex items-center gap-2">
                {s.photos[0] ? (
                  <span className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.photos[0]} alt="" loading="lazy" className="h-14 w-14 rounded-xl bg-white object-cover" />
                    {s.photos.length > 1 && <span className="absolute -bottom-1 -right-1 rounded-full bg-black/70 px-1.5 text-[10px] font-bold text-white">+{s.photos.length - 1}</span>}
                  </span>
                ) : <span className="text-xl" aria-hidden>🏗️</span>}
                <b className="min-w-0 flex-1 truncate text-base">{s.name}</b>
                {p.badge && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${p.badge.cls}`}>{p.badge.label}</span>}
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-1.5"><dt className="shrink-0 text-xs font-bold leading-5 text-zinc-500">공사기간</dt><dd className={p.urgent ? "font-bold text-red-600 dark:text-red-300" : ""}>{p.text}<ExtBadge s={s} /></dd></div>
                <div className="flex gap-1.5"><dt className="shrink-0 text-xs font-bold leading-5 text-zinc-500">담당 PM</dt><dd>{pm ? `${pm.name}` : <span className="text-zinc-400">미지정</span>}</dd></div>
                <div className="flex gap-1.5 sm:col-span-2"><dt className="shrink-0 text-xs font-bold leading-5 text-zinc-500">현장주소</dt><dd className="min-w-0">{s.address || <span className="text-zinc-400">—</span>}</dd></div>
                {s.memo && <div className="flex gap-1.5 sm:col-span-2"><dt className="shrink-0 text-xs font-bold leading-5 text-zinc-500">특이사항</dt><dd className="min-w-0 whitespace-pre-line rounded-lg bg-amber-50 px-2 py-1 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">{s.memo}</dd></div>}
              </dl>
              {(canEdit || canDelete) && (
                <div className="mt-3 flex justify-end gap-1.5">
                  {canEdit && <button type="button" onClick={() => openForm(s)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>}
                  {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s }); }} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      </section>
      ))}
      </>
      )}

      <Modal open={dlg?.t === "form"} onClose={close}>
        <form onSubmit={e => { e.preventDefault(); void submitForm(); }}>
          <h2 className="text-lg font-bold">{formId ? "현장 수정" : "현장 등록"}</h2>
          <div className="mt-4 text-sm font-bold">현장 사진 <span className="font-normal text-zinc-500">(선택, 최대 10장 · {keep.length + fresh.length}/10)</span></div>
          <div className="mt-1.5 grid grid-cols-4 gap-2">
            {keep.map(u => (
              <div key={u} className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="등록된 현장 사진" className="h-full w-full rounded-lg bg-white object-cover" />
                <button type="button" aria-label="이 사진 빼기" onClick={() => setKeep(p => p.filter(x => x !== u))} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow">✕</button>
              </div>
            ))}
            {fresh.map(p => (
              <div key={p.id} className="relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="새로 고른 사진" className="h-full w-full rounded-lg bg-white object-cover ring-2 ring-blue-500" />
                <span className="absolute bottom-1 left-1 rounded bg-blue-600 px-1 text-[10px] font-bold text-white">새 사진</span>
                <button type="button" aria-label="이 사진 빼기" onClick={() => dropFresh(p.id)} className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow">✕</button>
              </div>
            ))}
            {keep.length + fresh.length < 10 && (
              <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-black/25 text-zinc-500 hover:border-blue-500 dark:border-white/25">
                <span className="text-2xl" aria-hidden>📷</span>
                <span className="text-[11px] font-bold">사진 추가</span>
                <input type="file" accept="image/*" multiple className="sr-only" onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <label htmlFor="st-name" className="mt-4 block text-sm font-bold">현장명</label>
          <input id="st-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={50} placeholder="예: 강남 ○○빌딩 신축" autoComplete="off" className={inputCls} />
          <div className="mt-4 text-sm font-bold">공사기간 <span className="font-normal text-zinc-500">(선택)</span></div>
          <div className="mt-1.5 flex items-center gap-2">
            <input type="date" aria-label="공사 시작일" value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} className={inputCls + " !mt-0 min-w-0 flex-1"} />
            <span className="text-zinc-400" aria-hidden>~</span>
            <input type="date" aria-label="공사 종료일" value={f.endDate} min={f.startDate || undefined} onChange={e => setF({ ...f, endDate: e.target.value })} className={inputCls + " !mt-0 min-w-0 flex-1"} />
          </div>
          {dateBad && <p className="mt-1 text-xs text-red-500">종료일이 시작일보다 빠를 수 없어요.</p>}
          {formId && baseEnd && (() => {
            const diff = f.endDate ? daysBetween(baseEnd, f.endDate) : 0;
            return (
              <div className="mt-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <div className="text-xs font-bold text-zinc-500">마감 연장 <span className="font-normal">· 현재 마감일 {fmtDate(baseEnd)} 기준</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {[1, 3, 7, 14, 30].map(n => (
                    <button key={n} type="button" onClick={() => setF({ ...f, endDate: addDays(baseEnd, n) })} className={`rounded-full border px-3 py-1 text-xs font-bold ${diff === n ? "border-orange-500 bg-orange-500 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>+{n}일</button>
                  ))}
                  <label className="ml-1 flex items-center gap-1 text-xs text-zinc-500">직접
                    <input aria-label="연장 일수" inputMode="numeric" value={diff ? String(diff) : ""} placeholder="0" onChange={e => { const n = parseInt(e.target.value.replace(/[^\d-]/g, ""), 10); setF({ ...f, endDate: Number.isFinite(n) ? addDays(baseEnd, Math.max(-365, Math.min(3650, n))) : baseEnd }); }} className="w-14 rounded-lg border border-black/15 bg-white px-2 py-1 text-right text-sm font-bold text-zinc-900 outline-none focus:border-orange-500 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100" />일
                  </label>
                  {diff !== 0 && <button type="button" onClick={() => setF({ ...f, endDate: baseEnd })} className="text-xs font-bold text-zinc-500 underline">되돌리기</button>}
                </div>
                {diff !== 0 && <p className={`mt-2 text-xs font-bold ${diff > 0 ? "text-orange-600 dark:text-orange-300" : "text-blue-600 dark:text-blue-300"}`}>마감일이 {Math.abs(diff)}일 {diff > 0 ? "연장" : "단축"}돼요 · {fmtDate(baseEnd)} → {fmtDate(f.endDate)}</p>}
              </div>
            );
          })()}
          <label htmlFor="st-pm" className="mt-4 block text-sm font-bold">담당 PM <span className="font-normal text-zinc-500">(현장관리자(PM) 팀 회원, 선택)</span></label>
          <select id="st-pm" value={f.pmId} onChange={e => setF({ ...f, pmId: e.target.value })} className={inputCls}>
            <option value="">미지정</option>
            {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {pms.length === 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">현장관리자(PM) 팀 회원이 아직 없어요. 회원 관리에서 먼저 만들어 주세요.</p>}
          <label htmlFor="st-addr" className="mt-4 block text-sm font-bold">현장주소 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="st-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="예: 서울 강남구 ○○로 12" autoComplete="off" className={inputCls} />
          <label htmlFor="st-memo" className="mt-4 block text-sm font-bold">특이사항 <span className="font-normal text-zinc-500">(선택)</span></label>
          <textarea id="st-memo" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} maxLength={300} rows={3} placeholder="예: 주차 불가, 자재 반입은 오전만" className={inputCls + " resize-none"} />
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim() || dateBad} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "등록"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={dlg?.t === "view"} onClose={close}>
        {dlg?.t === "view" && (() => {
          const v = dlg.s;
          const p = sitePeriod(v.startDate, v.endDate);
          const pm = pmMap.get(v.pmId);
          return (
            <div>
              {v.photos.length > 0 && (
                <div className="no-scrollbar -mx-1 mb-3 flex snap-x gap-2 overflow-x-auto px-1">
                  {v.photos.map((u, i) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer" className="shrink-0 snap-start" title="눌러서 크게 보기">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`${v.name} 현장 사진 ${i + 1}`} className={`h-40 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800 ${v.photos.length === 1 ? "w-full" : "w-56"}`} />
                    </a>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-lg font-bold">🏗️ {v.name}</h2>
                {p.badge && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${p.badge.cls}`}>{p.badge.label}</span>}
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">공사기간</dt><dd className="min-w-0"><span className={p.urgent ? "font-bold text-red-600 dark:text-red-300" : ""}>{p.text}</span><ExtBadge s={v} />
                  {v.extensions.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                      {v.extensions.map((e, i) => { const d = extensionDays(e); return <li key={i}>{d >= 0 ? "연장" : "단축"} {d >= 0 ? "+" : "−"}{Math.abs(d)}일 · {fmtDate(e.from)} → {fmtDate(e.to)} <span className="text-zinc-400">({new Date(e.at).toLocaleDateString("ko-KR")} 변경)</span></li>; })}
                    </ul>
                  )}
                </dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">담당 PM</dt><dd>{pm ? pm.name : <span className="text-zinc-400">미지정</span>}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">현장주소</dt><dd className="min-w-0">{v.address || <span className="text-zinc-400">—</span>}</dd></div>
                <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">특이사항</dt><dd className="min-w-0 whitespace-pre-line">{v.memo || <span className="text-zinc-400">—</span>}</dd></div>
              </dl>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
                {canEdit && <button type="button" onClick={() => openForm(v)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">수정</button>}
                {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "del", s: v }); }} className="rounded-xl bg-red-50 px-4 py-3 font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal open={dlg?.t === "del"} onClose={close}>
        {dlg?.t === "del" && (
          <div>
            <h2 className="text-lg font-bold">“{dlg.s.name}” 현장을 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">삭제하면 자재 요청에서 더 이상 고를 수 없어요. 이미 들어온 요청에는 현장 이름이 그대로 남아요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "delete", id: dlg.s.id }, "현장을 삭제했어요")} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
