/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { shrink } from "@/components/admin/AddProduct";
import type { Vehicle, VehiclePhoto } from "@/lib/types";

const MAX_PER_UPLOAD = 4;
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// 차량 현황 사진: 지금 차량 상태를 사진으로 남기고(외관·계기판·적재 상태 등), 날짜순으로 모아 본다.
export default function VehiclePhotos({ vehicle, canAdd, canRemoveAny, myId }: { vehicle: Vehicle; canAdd: boolean; canRemoveAny: boolean; myId: string }) {
  const router = useRouter();
  const [sel, setSel] = useState(0); // 크게 보여 줄 대표 사진 번호
  const [open, setOpen] = useState(false); // 올리기 창
  const [view, setView] = useState<VehiclePhoto | null>(null); // 크게 보는 사진
  const [fresh, setFresh] = useState<{ id: number; file: File; url: string }[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => { fresh.forEach(p => URL.revokeObjectURL(p.url)); setFresh([]); setNote(""); setErr(""); };
  const close = () => { if (!busy) { reset(); setOpen(false); } };
  const add = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list]; // 입력칸을 비우면 FileList 도 비워지므로 먼저 배열로 복사
    setFresh(prev => [...prev, ...picked.slice(0, Math.max(0, MAX_PER_UPLOAD - prev.length)).map((file, i) => ({ id: Date.now() + i, file, url: URL.createObjectURL(file) }))]);
  };
  const drop = (id: number) => setFresh(prev => { const x = prev.find(p => p.id === id); if (x) URL.revokeObjectURL(x.url); return prev.filter(p => p.id !== id); });

  async function post(body: FormData | Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/vehicle-photos", body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (busy || fresh.length === 0) return;
    const fd = new FormData();
    fd.set("action", "add");
    fd.set("id", vehicle.id);
    fd.set("note", note);
    try {
      for (const p of fresh) {
        const blob = await shrink(p.file, 1400);
        fd.append("photo", new File([blob], blob.type === "image/webp" ? "vehicle.webp" : "vehicle.jpg", { type: blob.type }));
      }
    } catch {
      return setErr("사진을 처리하지 못했어요. 다른 사진으로 해 보세요.");
    }
    if (await post(fd)) { reset(); setOpen(false); }
  }
  const mayRemove = (p: VehiclePhoto) => canRemoveAny || (!!myId && p.byId === myId);

  const photos = vehicle.photos;
  const cur = photos[Math.min(sel, Math.max(0, photos.length - 1))];
  const stamp = (p: VehiclePhoto) => new Date(p.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

  return (
    <div className="mt-4">
      <>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-extrabold">현황 사진 <span className="font-normal text-zinc-500">({photos.length})</span></h2>
            {canAdd && <button type="button" onClick={() => { reset(); setOpen(true); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">📷 현황 사진 올리기</button>}
          </div>
          {!cur ? (
            <p className="mt-2 text-sm text-zinc-500">아직 올린 사진이 없어요.{canAdd ? " 지금 차량 상태를 사진으로 남겨 보세요." : ""}</p>
          ) : (
            <>
              {/* 대표 사진: 크게 */}
              <button type="button" onClick={() => setView(cur)} className="mt-3 block w-full text-left" aria-label="사진 크게 보기">
                <img src={cur.url} alt={cur.note || "차량 현황 사진"} className="max-h-96 w-full rounded-xl bg-zinc-100 object-contain dark:bg-zinc-800" />
              </button>
              <p className="mt-1.5 text-sm"><b>{when(cur.at)}</b> · {cur.by}{cur.note && <span className="ml-2 text-zinc-600 dark:text-zinc-300">{cur.note}</span>}</p>
              {/* 전체 사진: 눌러서 위에 크게 보기 */}
              {photos.length > 1 && (
                <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                  {photos.map((p, i) => (
                    <li key={p.url}>
                      <button type="button" onClick={() => setSel(i)} aria-label={`${when(p.at)} 사진 보기`} aria-pressed={p === cur} className={`block w-full overflow-hidden rounded-lg text-left ring-2 ${p === cur ? "ring-blue-600" : "ring-transparent"}`}>
                        <img src={p.url} alt={p.note || "차량 현황 사진"} loading="lazy" className="h-20 w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
                        <span className="block truncate px-1 py-0.5 text-[11px] font-semibold">{stamp(p)} · {p.by}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </>

      <Modal open={open} onClose={close}>
        <form onSubmit={e => { e.preventDefault(); void upload(); }}>
          <h2 className="text-lg font-bold">현황 사진 올리기</h2>
          <p className="mt-1 text-sm text-zinc-500">{vehicle.name} · 지금 차량 상태를 찍어 올려요 (외관, 계기판 키로수, 적재 상태 등). 최대 {MAX_PER_UPLOAD}장.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fresh.map(p => (
              <span key={p.id} className="relative">
                <img src={p.url} alt="새로 고른 사진" className="h-24 w-20 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
                <button type="button" aria-label="사진 빼기" onClick={() => drop(p.id)} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-black/75 text-xs font-bold text-white">✕</button>
              </span>
            ))}
            {fresh.length < MAX_PER_UPLOAD && (
              <label className="flex h-24 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-400 text-xs font-bold text-blue-700 dark:text-blue-300">
                <span className="text-2xl" aria-hidden>📷</span>사진 추가
                <input type="file" accept="image/*" multiple className="sr-only" onChange={e => { add(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <label htmlFor="vp-note" className="mt-4 block text-sm font-bold">현재 상태 메모 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="vp-note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="예: 우측 문 긁힘, 계기판 85,000km" autoComplete="off" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-2.5 text-base outline-none focus:border-blue-500 dark:border-white/15" />
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || fresh.length === 0} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "올리는 중…" : "올리기"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={view !== null} onClose={() => !busy && setView(null)}>
        {view && (
          <div>
            <img src={view.url} alt={view.note || "차량 현황 사진"} className="max-h-[65vh] w-full rounded-xl object-contain" />
            <p className="mt-2 text-sm font-bold">{when(view.at)} · {view.by}</p>
            {view.note && <p className="mt-0.5 whitespace-pre-line text-sm">{view.note}</p>}
            {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex gap-2">
              {mayRemove(view) && <button type="button" disabled={busy} onClick={() => void post({ action: "remove", id: vehicle.id, url: view.url }).then(ok => { if (ok) setView(null); })} className="rounded-xl bg-red-50 px-4 py-3 font-bold text-red-600 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300">{busy ? "삭제 중…" : "삭제"}</button>}
              <button type="button" onClick={() => setView(null)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">닫기</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
