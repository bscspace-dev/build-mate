"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { shrink } from "@/components/admin/AddProduct";
import { KINDS, type Kind, type Product, type TrashedProduct } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";

export type ProductEdited = { name: string; sub: string; brand: string; price: number; kind?: Kind; image?: string; model?: string; battery?: string };

// 등록한 품목의 정보 수정: 이름·세부분류·브랜드·가격·사진 (카테고리는 '이동', 재고는 재고 칸에서 바꾼다)
export default function EditProduct({
  product, onClose, onSaved,
}: {
  product: Product | TrashedProduct | null;
  onClose: () => void;
  onSaved: (key: string, e: ProductEdited) => void;
}) {
  return (
    <Modal open={product !== null} onClose={onClose} wide>
      {product && <Form key={product.key} product={product} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function Form({ product, onClose, onSaved }: { product: Product | TrashedProduct; onClose: () => void; onSaved: (key: string, e: ProductEdited) => void }) {
  const router = useRouter();
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState(product.name);
  const [sub, setSub] = useState(product.sub ?? "");
  const [brand, setBrand] = useState(product.brand ?? "");
  const [battery, setBattery] = useState((product as { battery?: string }).battery ?? ""); // 연장 배터리 포함 여부
  const [model, setModel] = useState((product as { model?: string }).model ?? ""); // 연장 제품명(모델명)
  const [price, setPrice] = useState(product.price ? String(product.price) : "");
  const [kind, setKind] = useState<Kind>(product.kind);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setErr("품목 이름을 적어 주세요.");
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.set("key", product.key);
      fd.set("name", name);
      fd.set("kind", kind);
      fd.set("sub", sub);
      fd.set("brand", brand);
      if (kind === "연장") { fd.set("model", model); fd.set("battery", battery); }
      fd.set("price", price);
      if (photo) {
        const blob = await shrink(photo);
        fd.set("photo", new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: blob.type }));
      }
      const r = await fetch("/api/admin/products/edit", { method: "POST", body: fd });
      if (r.status === 401) { router.replace("/"); return; }
      const j = (await r.json().catch(() => ({}))) as ProductEdited & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "수정하지 못했어요.");
      onSaved(product.key, { name: j.name, sub: j.sub, brand: j.brand, price: j.price, kind: j.kind, image: j.image, model: j.model, battery: j.battery });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "수정하지 못했어요.");
    }
    setBusy(false);
  }

  const shown = preview || product.image;
  return (
    <form onSubmit={submit}>
      <h2 className="text-lg font-bold">품목 수정</h2>
      <p className="mt-1 text-sm text-zinc-500">카테고리는 카드의 “이동”, 재고는 카드의 재고 칸에서 바꿔요.</p>

      <div className="mt-4 text-sm font-bold">사진 <span className="font-normal text-zinc-500">(바꿀 때만 고르세요)</span></div>
      <label className="mt-1.5 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-black/25 p-3 hover:border-blue-500 dark:border-white/25">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="미리보기" className="h-24 w-24 shrink-0 rounded-lg bg-white object-contain" />
        ) : (
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-3xl text-zinc-400 dark:bg-zinc-800">📷</span>
        )}
        <span className="text-sm text-zinc-600 dark:text-zinc-300">{photo ? photo.name : "눌러서 새 사진 고르기"}</span>
        <input type="file" accept="image/*" className="sr-only" onChange={e => { setPhoto(e.target.files?.[0] ?? null); setErr(""); }} />
      </label>

      <label htmlFor="ep-name" className="mt-4 block text-sm font-bold">품목 이름</label>
      <input id="ep-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={100} autoComplete="off" className={inputCls} />

      <div className="mt-4 text-sm font-bold">분류</div>
      <div className="mt-1.5 flex gap-2" role="group" aria-label="분류">
        {KINDS.map(k => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`flex-1 rounded-xl py-2.5 text-sm font-bold ${kind === k ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{k}</button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="ep-sub" className="mt-4 block text-sm font-bold">세부분류</label>
          <input id="ep-sub" value={sub} onChange={e => setSub(e.target.value)} maxLength={100} autoComplete="off" className={inputCls} />
        </div>
        <div>
          <label htmlFor="ep-brand" className="mt-4 block text-sm font-bold">사용 브랜드</label>
          <input id="ep-brand" value={brand} onChange={e => setBrand(e.target.value)} maxLength={50} autoComplete="off" className={inputCls} />
          {kind === "연장" && (<>
            <label htmlFor="ep-model" className="mt-4 block text-sm font-bold">제품명 <span className="font-normal text-zinc-500">(모델명)</span></label>
            <input id="ep-model" value={model} onChange={e => setModel(e.target.value)} maxLength={100} autoComplete="off" className={inputCls} />
            <label htmlFor="ep-battery" className="mt-4 block text-sm font-bold">배터리</label>
            <select id="ep-battery" value={battery} onChange={e => setBattery(e.target.value)} className={inputCls}><option value="">선택 안 함</option><option value="포함">포함</option><option value="미포함">미포함</option></select>
          </>)}
        </div>
        <div>
          <label htmlFor="ep-price" className="mt-4 block text-sm font-bold">가격</label>
          <input id="ep-price" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="원" autoComplete="off" className={inputCls} />
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
        <button disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
      </div>
    </form>
  );
}
