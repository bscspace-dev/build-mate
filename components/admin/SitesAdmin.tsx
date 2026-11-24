"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import SiteBoard, { type CrewMap, type SiteNews } from "@/components/admin/SiteBoard";
import { shrink } from "@/components/admin/AddProduct";
import { embedPostcode, loadPostcode } from "@/lib/postcode-client";
import { addDays, daysBetween, fmtDate } from "@/lib/site-period";
import type { Site } from "@/lib/types";

const isPdf = (u: string) => u.toLowerCase().endsWith(".pdf");
export type PmLite = { id: string; name: string; team: string; isPm: boolean };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
type Form = { name: string; address: string; pmId: string; startDate: string; endDate: string; memo: string };
const EMPTY: Form = { name: "", address: "", pmId: "", startDate: "", endDate: "", memo: "" };

// 현장정보(현장관리 메뉴 아래): 자재 요청에서 고르는 현장을 등록·수정·삭제한다. 항목: 현장명 · 공사기간 · 담당 PM · 현장 주소 · 특이사항
export default function SitesAdmin({
  sites, pms, date, showCrew, crew, news, notes, openEdit = "", openDel = "", canRegister, canEdit, canDelete,
}: {
  sites: Site[]; pms: PmLite[]; date: string; showCrew: boolean; crew: CrewMap; news: SiteNews; notes: Record<string, string>; openEdit?: string; openDel?: string; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  // 현장 상세 화면의 수정·삭제 버튼에서 들어오면(?edit= / ?del=) 수정 창 / 삭제 확인 창을 바로 연다
  const editSite = canEdit && openEdit ? sites.find(x => x.id === openEdit) : undefined;
  const delSite = canDelete && openDel ? sites.find(x => x.id === openDel) : undefined;
  const [baseEnd, setBaseEnd] = useState(editSite?.endDate ?? ""); // 수정을 시작할 때의 마감일 (연장 일수 기준)
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; s: Site } | null>(editSite ? { t: "form", id: editSite.id } : delSite ? { t: "del", s: delSite } : null);
  const [f, setF] = useState<Form>(editSite ? { name: editSite.name, address: editSite.address, pmId: pms.some(p => p.id === editSite.pmId) ? editSite.pmId : "", startDate: editSite.startDate, endDate: editSite.endDate, memo: editSite.memo } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [addrOpen, setAddrOpen] = useState(false); // 도로명 주소 찾기 창
  const [addrErr, setAddrErr] = useState("");
  const addrBox = useRef<HTMLDivElement>(null);
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
  // 현장 사진(여러 장): 기존 사진 중 남길 것(keep) + 새로 고른 사진들
  const [keep, setKeep] = useState<string[]>(editSite?.photos ?? []);
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
  // 도면(이미지·PDF): 기존 도면 중 남길 것(keepDraw) + 새로 고른 파일들
  const [keepDraw, setKeepDraw] = useState<string[]>(editSite?.drawings ?? []);
  const [freshDraw, setFreshDraw] = useState<{ id: number; file: File }[]>([]);
  const addDrawings = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list];
    setFreshDraw(prev => [...prev, ...picked.slice(0, Math.max(0, 10 - keepDraw.length - prev.length)).map((file, i) => ({ id: Date.now() + i, file }))]);
  };
  const resetPhotos = (existing: string[], existingDraw: string[] = []) => { fresh.forEach(p => URL.revokeObjectURL(p.url)); setFresh([]); setKeep(existing); setFreshDraw([]); setKeepDraw(existingDraw); };
  const pmMap = new Map(pms.map(p => [p.id, p]));

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
      if (openEdit || openDel) router.replace("/admin/sites");
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
    resetPhotos(s?.photos ?? [], s?.drawings ?? []);
    setBaseEnd(s?.endDate ?? "");
    setDlg({ t: "form", id: s?.id ?? null });
  };
  const close = () => { if (!busy) { resetPhotos([]); setDlg(null); if (openEdit || openDel) router.replace("/admin/sites"); } };
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
      if (formId) fd.set("keepDrawings", JSON.stringify(keepDraw));
      for (const d of freshDraw) {
        // 도면: PDF 는 그대로, 이미지는 글자가 읽히도록 크게(긴 변 2400px) 줄여서 올린다
        if (d.file.type === "application/pdf") fd.append("drawing", d.file);
        else {
          const blob = await shrink(d.file, 2400);
          fd.append("drawing", new File([blob], blob.type === "image/webp" ? "drawing.webp" : "drawing.jpg", { type: blob.type }));
        }
      }
    } catch {
      return setErr("사진을 처리하지 못했어요. 다른 사진으로 해 보세요.");
    }
    await call(fd, formId ? "현장 정보를 수정했어요" : "현장을 등록했어요");
  }
  const formId = dlg?.t === "form" ? dlg.id : null;
  const dateBad = !!f.startDate && !!f.endDate && f.endDate < f.startDate;

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">현장정보</h1>
        <span className="text-sm text-zinc-500">총 {sites.length}곳</span>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 현장 등록</button>}
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">여기에 등록한 현장이 자재 요청의 “요청하기”에서 선택지로 나와요. 현장명을 바꾸거나 지워도 이미 들어온 요청에는 당시 이름이 그대로 남아요.</p>
      {toast && <p className="mb-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      <SiteBoard sites={sites} date={date} showCrew={showCrew} crew={crew} news={news} notes={notes} pmName={id => pmMap.get(id)?.name ?? ""} onPick={x => router.push(`/admin/sites/${x.id}`)} />

      <Modal open={dlg?.t === "form"} onClose={close} wide xl>
        <form onSubmit={e => { e.preventDefault(); void submitForm(); }} className="flex max-h-[85vh] flex-col">
          <div className="flex items-center gap-2">
            <h2 className="mr-auto text-lg font-bold">{formId ? "현장 수정" : "현장 등록"}</h2>
            <button type="button" onClick={() => !busy && close()} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
          </div>
          <div className="-mx-1 mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
            <div className="grid gap-x-4 sm:grid-cols-2">
              <div className="mt-3 sm:col-span-2">
                <label htmlFor="st-name" className="block text-sm font-bold">현장명 <span className="font-normal text-zinc-500">(필수)</span></label>
                <input id="st-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={50} placeholder="예: 강남 ○○빌딩 신축" autoComplete="off" className={inputCls} />
              </div>
              <div className="mt-3 sm:col-span-2">
                <div className="text-sm font-bold">공사기간 <span className="font-normal text-zinc-500">(선택)</span></div>
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
              </div>
              <div className="mt-3">
                <label htmlFor="st-pm" className="block text-sm font-bold">담당 PM <span className="font-normal text-zinc-500">(선택)</span></label>
                <select id="st-pm" value={f.pmId} onChange={e => setF({ ...f, pmId: e.target.value })} className={inputCls}>
                  <option value="">미지정</option>
                  {pms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {pms.length === 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">PM 역할을 가진 회원이 아직 없어요. 회원등록 및 수정에서 현장 팀의 역할에 PM을 골라 주세요.</p>}
              </div>
              <div className="mt-3">
                <label htmlFor="st-addr" className="block text-sm font-bold">현장주소 <span className="font-normal text-zinc-500">(선택)</span></label>
                <div className="mt-1.5 flex gap-2">
                  <input id="st-addr" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} maxLength={200} placeholder="주소 찾기로 도로명 주소를 골라요" autoComplete="off" className={inputCls.replace("mt-1.5 w-full ", "") + " min-w-0 flex-1"} />
                  <button type="button" onClick={() => { setAddrErr(""); setAddrOpen(true); }} className="shrink-0 rounded-xl bg-zinc-100 px-4 text-sm font-bold dark:bg-zinc-800">주소 찾기</button>
                </div>
              </div>
              <div className="mt-3 sm:col-span-2">
                <label htmlFor="st-memo" className="block text-sm font-bold">특이사항 <span className="font-normal text-zinc-500">(선택)</span></label>
                <textarea id="st-memo" value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} maxLength={300} rows={3} placeholder="예: 주차 불가, 자재 반입은 오전만" className={inputCls + " resize-none"} />
              </div>
              <div className="mt-3 sm:col-span-2">
                <div className="text-sm font-bold">현장 사진 <span className="font-normal text-zinc-500">(선택, 최대 10장 · {keep.length + fresh.length}/10)</span></div>
              <div className="mt-1.5 grid grid-cols-5 gap-2 sm:grid-cols-8">
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
              </div>
              <div className="mt-3 sm:col-span-2">
                <div className="text-sm font-bold">도면 <span className="font-normal text-zinc-500">(선택, PDF 또는 이미지 · 최대 10개 · {keepDraw.length + freshDraw.length}/10)</span></div>
                <ul className="mt-1.5 space-y-1.5">
                  {keepDraw.map((u, i) => (
                    <li key={u} className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
                      <span aria-hidden>{isPdf(u) ? "📄" : "🖼️"}</span>
                      <a href={u} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-blue-700 hover:underline dark:text-blue-300">도면 {i + 1} · {isPdf(u) ? "PDF" : "이미지"}</a>
                      <button type="button" onClick={() => setKeepDraw(p => p.filter(x => x !== u))} aria-label="이 도면 빼기" className="text-xs font-bold text-red-600">빼기</button>
                    </li>
                  ))}
                  {freshDraw.map(d => (
                    <li key={d.id} className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm dark:bg-blue-500/10">
                      <span aria-hidden>{d.file.type === "application/pdf" ? "📄" : "🖼️"}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{d.file.name}</span>
                      <span className="shrink-0 rounded bg-blue-600 px-1 text-[10px] font-bold text-white">새 도면</span>
                      <button type="button" onClick={() => setFreshDraw(p => p.filter(x => x.id !== d.id))} aria-label="이 도면 빼기" className="text-xs font-bold text-red-600">빼기</button>
                    </li>
                  ))}
                </ul>
                {keepDraw.length + freshDraw.length < 10 && (
                  <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-dashed border-black/25 px-4 py-2.5 text-sm font-bold text-zinc-600 hover:border-blue-500 dark:border-white/25 dark:text-zinc-300">
                    <span aria-hidden>📐</span> 도면 추가
                    <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={e => { addDrawings(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
            </div>
          </div>
          {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-2 flex shrink-0 gap-2 border-t border-black/10 pt-3 dark:border-white/10">
            <button type="button" disabled={busy} onClick={close} className="rounded-xl bg-zinc-100 px-5 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim() || dateBad} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "등록"}</button>
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
