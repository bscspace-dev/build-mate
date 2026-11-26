"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { KINDS, type Kind, type Product } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const MAX_SIDE = 1000; // 사진은 긴 변을 이 크기로 줄여서 올린다

// 사진을 줄이고 webp 로 바꾼다 (webp 를 못 만드는 브라우저는 jpg)
export async function shrink(file: File, maxSide = MAX_SIDE): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("사진을 처리하지 못했어요.");
  ctx.fillStyle = "#fff"; // 투명한 부분은 흰색으로
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const to = (type: string, q: number) => new Promise<Blob | null>(res => canvas.toBlob(res, type, q));
  const webp = await to("image/webp", 0.85);
  if (webp && webp.type === "image/webp") return webp;
  const jpg = await to("image/jpeg", 0.85);
  if (!jpg) throw new Error("사진을 처리하지 못했어요.");
  return jpg;
}

// 새 품목 등록: 사진 + 정보
export default function AddProduct({
  open, onClose, categories, defaultCategory, defaultKind, headOfCat, onAdded,
}: {
  headOfCat: (category: string) => string; // 카테고리의 "공정>카테고리"
  open: boolean;
  onClose: () => void;
  categories: string[];
  defaultCategory: string;
  defaultKind: Kind;
  onAdded: (p: Product) => void;
}) {
  const router = useRouter();
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [category, setCategory] = useState(defaultCategory);
  const [sub, setSub] = useState<string | null>(null); // null = 직접 고치지 않음 (고른 카테고리의 공정>카테고리가 자동으로 들어간다)
  const subShown = sub ?? (category ? headOfCat(category) : "");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [battery, setBattery] = useState(""); // 연장 배터리 포함 여부 // 연장 제품명(모델명)
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 창을 열 때마다 지금 선택된 카테고리로 맞춘다 (처음 한 번만 반영되던 문제)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setCategory(defaultCategory); setKind(defaultKind); }
  }, [open, defaultCategory, defaultKind]);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function reset() {
    setPhoto(null);
    setPreview("");
    setName("");
    setSub(null);
    setBrand("");
    setPrice("");
    setStock("0");
    setErr("");
  }
  function close() {
    if (busy) return;
    onClose();
    reset();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!photo) return setErr("사진을 올려 주세요.");
    if (!name.trim()) return setErr("품목 이름을 적어 주세요.");
    if (!category) return setErr("카테고리를 골라 주세요.");
    setBusy(true);
    setErr("");
    try {
      const blob = await shrink(photo);
      const fd = new FormData();
      fd.set("photo", new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: blob.type }));
      fd.set("name", name);
      fd.set("kind", kind);
      fd.set("category", category);
      fd.set("sub", subShown);
      fd.set("brand", brand);
      if (kind === "연장") { fd.set("model", model); fd.set("battery", battery); }
      fd.set("price", price);
      fd.set("stock", stock);
      const r = await fetch("/api/admin/products/new", { method: "POST", body: fd });
      if (r.status === 401) { router.replace("/"); return; }
      const j = (await r.json().catch(() => ({}))) as { error?: string; product?: Product };
      if (!r.ok || !j.product) throw new Error(j.error ?? "등록하지 못했어요.");
      onAdded(j.product);
      onClose();
      reset();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "등록하지 못했어요.");
    }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={close} wide>
      <form onSubmit={submit}>
        <h2 className="text-lg font-bold">품목 추가</h2>
        <p className="mt-1 text-sm text-zinc-500">새로 들어온 품목의 사진과 정보를 등록해요. 사진과 이름, 카테고리는 꼭 필요해요.</p>

        <div className="mt-4 text-sm font-bold">사진</div>
        <label className="mt-1.5 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-black/25 p-3 hover:border-blue-500 dark:border-white/25">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="미리보기" className="h-24 w-24 shrink-0 rounded-lg bg-white object-contain" />
          ) : (
            <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-3xl text-zinc-400 dark:bg-zinc-800">📷</span>
          )}
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{photo ? photo.name : "눌러서 사진을 고르거나 찍어 주세요"}</span>
          <input type="file" accept="image/*" className="sr-only" onChange={e => { setPhoto(e.target.files?.[0] ?? null); setErr(""); }} />
        </label>

        <label htmlFor="np-name" className="mt-4 block text-sm font-bold">품목 이름</label>
        <input id="np-name" value={name} onChange={e => setName(e.target.value)} maxLength={100} placeholder="예: 구조용 합판 12T" autoComplete="off" className={inputCls} />

        <div className="mt-4 text-sm font-bold">분류</div>
        <div className="mt-1.5 flex gap-2" role="group" aria-label="분류">
          {KINDS.map(k => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${kind === k ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{k}</button>
          ))}
        </div>

        <label htmlFor="np-cat" className="mt-4 block text-sm font-bold">카테고리</label>
        <select id="np-cat" value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
          <option value="">카테고리를 골라 주세요</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="np-sub" className="mt-4 block text-sm font-bold">세부분류 <span className="font-normal text-zinc-500">(선택)</span></label>
            <input id="np-sub" value={subShown} onChange={e => setSub(e.target.value)} maxLength={100} autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label htmlFor="np-brand" className="mt-4 block text-sm font-bold">사용 브랜드 <span className="font-normal text-zinc-500">(선택)</span></label>
            <input id="np-brand" value={brand} onChange={e => setBrand(e.target.value)} maxLength={50} autoComplete="off" className={inputCls} />
            {kind === "연장" && (<>
              <label htmlFor="np-model" className="mt-4 block text-sm font-bold">제품명 <span className="font-normal text-zinc-500">(모델명, 선택)</span></label>
              <input id="np-model" value={model} onChange={e => setModel(e.target.value)} maxLength={100} autoComplete="off" className={inputCls} />
              <label htmlFor="np-battery" className="mt-4 block text-sm font-bold">배터리 <span className="font-normal text-zinc-500">(선택)</span></label>
              <select id="np-battery" value={battery} onChange={e => setBattery(e.target.value)} className={inputCls}><option value="">선택 안 함</option><option value="포함">포함</option><option value="미포함">미포함</option></select>
            </>)}
          </div>
          <div>
            <label htmlFor="np-price" className="mt-4 block text-sm font-bold">가격 <span className="font-normal text-zinc-500">(선택)</span></label>
            <input id="np-price" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="원" autoComplete="off" className={inputCls} />
          </div>
          <div>
            <label htmlFor="np-stock" className="mt-4 block text-sm font-bold">재고 수량</label>
            <input id="np-stock" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value.replace(/\D/g, "").slice(0, 7))} onFocus={e => e.target.select()} autoComplete="off" className={inputCls} />
          </div>
        </div>

        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "등록 중…" : "등록"}</button>
        </div>
      </form>
    </Modal>
  );
}
