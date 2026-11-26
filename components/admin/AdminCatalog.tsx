"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { KINDS, type Kind, type Product, type TrashedProduct } from "@/lib/types";
import { vendorColor } from "@/lib/vendor-color";
import { Modal } from "@/components/Sheet";
import AddProduct from "@/components/admin/AddProduct";
import EditProduct from "@/components/admin/EditProduct";
import { buildXlsx, downloadBlob, PHOTO_PX } from "@/lib/xlsx-export";
import { readXlsx } from "@/lib/xlsx-import";
import { headOf, rewriteSub } from "@/lib/sub-path";

const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";

// 별표(즐겨찾기)한 소모품: 이 기기 브라우저에 저장된다
const STAR_KEY = "bm_admin_stars";
const STAR_EVENT = "bm-admin-stars-change";
function subscribeStars(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(STAR_EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(STAR_EVENT, cb); };
}
function readStarsRaw(): string {
  try {
    return window.localStorage.getItem(STAR_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseStars(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

type Mode = "delete" | "restore";
type Confirm = { mode: Mode | "purge"; keys: string[] } | null;
type Toast = { id: number; text: string; undo?: { mode: Mode; keys: string[] } } | null;

// 재고 수량 입력: 숫자를 바꾸면 "등록" 버튼이 나타나고, 그 버튼을 눌러야 저장된다 (실수로 바뀌는 것을 막는다). 취소하면 원래 숫자로 돌아간다.
function StockBox({ value, canEdit, onCommit, draft, setDraft }: { value: number; canEdit: boolean; onCommit: (n: number) => void; draft: number | null; setDraft: (n: number | null) => void }) {
  const shown = draft ?? value;
  const dirty = draft !== null && draft !== value;
  const set = (n: number) => setDraft(Math.max(0, Math.min(9_999_999, n)));
  const register = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  if (!canEdit) return <div className={"mt-2 text-xs font-bold " + (value === 0 ? "text-red-600 dark:text-red-300" : "text-zinc-600 dark:text-zinc-300")}>재고 {value}</div>;
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        <span className={"mr-0.5 text-[11px] font-bold " + (value === 0 ? "text-red-600 dark:text-red-300" : "text-zinc-500")}>재고</span>
        <button type="button" aria-label="수량 줄이기" disabled={shown <= 0} onClick={() => set(shown - 1)} className="h-7 w-7 shrink-0 sm:h-8 sm:w-8 rounded-lg bg-zinc-100 text-base font-bold disabled:opacity-30 dark:bg-zinc-800">−</button>
        <input
          type="text"
          inputMode="numeric"
          aria-label="재고 수량"
          value={String(shown)}
          onFocus={e => e.target.select()}
          onChange={e => set(parseInt(e.target.value.replace(/\D/g, "").slice(0, 7), 10) || 0)}
          onKeyDown={e => { if (e.key === "Enter") register(); if (e.key === "Escape") setDraft(null); }}
          className={"h-7 min-w-0 flex-1 rounded-lg border sm:h-8 bg-transparent text-center text-sm font-bold outline-none focus:border-blue-500 " + (dirty ? "border-blue-500 ring-2 ring-blue-500/20" : value === 0 ? "border-red-300 text-red-600 dark:border-red-500/50 dark:text-red-300" : "border-black/15 dark:border-white/15")}
        />
        <button type="button" aria-label="수량 늘리기" onClick={() => set(shown + 1)} className="h-7 w-7 shrink-0 sm:h-8 sm:w-8 rounded-lg bg-zinc-100 text-base font-bold dark:bg-zinc-800">+</button>
      </div>
      {dirty && (
        <div className="mt-1.5 flex gap-1.5">
          <button type="button" onClick={register} className="flex-1 rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white">등록 ({value} → {draft})</button>
          <button type="button" onClick={() => setDraft(null)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">취소</button>
        </div>
      )}
    </div>
  );
}

// 끌 때 브라우저가 보여 주는 반투명 그림을 대신할 1px 투명 이미지
const BLANK_DRAG = typeof Image !== "undefined" ? Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }) : (null as unknown as HTMLImageElement);

/** 장비조사에서 이 품목을 추가·삭제한 사람과 때 */
export type InvMark = { add?: { by: string; at: string; src: string }; del?: { by: string; at: string; src: string } };
const markTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ProductCard({
  vendor, inv, p, deployed, selected, starred, onSelect, onStar, onAction, onMove, onRename, onShift, onStock, draft, onDraft, shiftable, trashMode, canDelete, canEdit, list, reorderable, dragging, onDragStart, onDragEnd, onDropOn,
}: {
  vendor?: { vendor: string; unit: string; url: string }; // 가격조사에서 등록한 구매처·판매단위·구매 링크
  inv?: InvMark; // 장비조사에서 추가·삭제한 기록
  dragging: boolean; // 지금 이 카드를 끌고 있는지
  onDragStart: ((k: string) => void) | null; // null = 끌어서 순서 바꾸기 불가
  onDragEnd: () => void;
  onDropOn: (k: string) => void;
  list: boolean; // true = 한 줄짜리 리스트형, false = 카드형
  reorderable: boolean; // 다른 카드 위에 놓아 순서를 바꿀 수 있는지 (기본 순서 보기일 때만)
  onStock: (k: string, n: number) => void;
  draft: number | null; // 입력했지만 아직 저장하지 않은 재고 수량
  onDraft: (k: string, n: number | null) => void;
  starred: boolean;
  onStar: (k: string) => void;
  p: Product | TrashedProduct;
  deployed: { icon: string; label: string; qty: number }[]; // 연장이 배정된 차량 (없으면 빈 배열)
  selected: boolean;
  onSelect: (k: string) => void;
  onAction: (k: string, mode: Mode | "purge") => void;
  onMove: (k: string) => void;
  onRename: (p: Product | TrashedProduct) => void;
  onShift: (k: string, dir: -1 | 1) => void;
  shiftable: { prev: boolean; next: boolean } | null; // 순서 이동 가능 여부(기본 순서 보기 + 수정 권한일 때만)
  trashMode: boolean;
  canDelete: boolean; // 삭제 권한이 없으면 삭제·복원 버튼을 숨긴다
  canEdit: boolean; // 수정 권한이 없으면 카테고리 이동 버튼을 숨긴다
}) {
  // motion.div 의 onDragStart/onDragEnd 는 motion 자체 드래그용이라, 브라우저 기본 끌기 이벤트는 직접 붙인다
  const handleRef = useRef<HTMLDivElement>(null); // 끌기 손잡이
  const [over, setOver] = useState(false); // 끌던 카드가 이 카드 위에 있는 중
  useEffect(() => {
    const el = handleRef.current;
    if (!el || !onDragStart) return;
    const start = (e: DragEvent) => {
      e.dataTransfer?.setData("text/plain", p.key);
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(BLANK_DRAG, 0, 0); } // 따라다니는 반투명 그림은 없앤다
      onDragStart(p.key);
    };
    el.addEventListener("dragstart", start);
    el.addEventListener("dragend", onDragEnd);
    return () => { el.removeEventListener("dragstart", start); el.removeEventListener("dragend", onDragEnd); };
  }, [onDragStart, onDragEnd, p.key]);
  const canSelect = canDelete || canEdit;
  const deletedAt = "deletedAt" in p ? p.deletedAt : null;
  const empty = !trashMode && (p.stock ?? 0) === 0; // 재고 0: 색을 다르게 보여 준다 (채우면 원래대로)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      onDragOver={e => { if (!onDragStart || !reorderable) return; e.preventDefault(); if (!dragging) setOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={e => { if (!onDragStart || !reorderable) return; e.preventDefault(); setOver(false); onDropOn(p.key); }}
      className={`${dragging ? "opacity-40" : ""} relative overflow-hidden border-2 transition-colors ${list ? "flex items-center gap-2 rounded-xl" : "rounded-2xl"} ${
        empty ? "bg-red-50 dark:bg-red-500/10" : "bg-white dark:bg-zinc-900"
      } ${over ? "border-blue-500 ring-4 ring-blue-500/40" : selected ? "border-blue-600 ring-2 ring-blue-600/30" : empty ? "border-red-300 dark:border-red-500/40" : "border-black/10 dark:border-white/10"}`}
    >
      {onDragStart && (
        <div
          ref={handleRef}
          draggable
          title={reorderable ? "끌어서 순서 바꾸기 · 위쪽 카테고리에 놓으면 이동" : "위쪽 카테고리 칩에 끌어다 놓으면 이동"}
          aria-label="끌어서 이동"
          className={list ? "flex w-6 shrink-0 items-center justify-center self-stretch text-zinc-400 hover:text-blue-600" : "absolute left-1/2 top-1.5 z-10 -translate-x-1/2 rounded-full bg-black/40 px-3 py-0.5 text-xs leading-none text-white hover:bg-blue-600"}
        >
          {list ? "⋮⋮" : "⠿"}
        </div>
      )}
      <button type="button" onClick={() => canSelect && onSelect(p.key)} aria-label={selected ? "선택 해제" : "선택"} aria-pressed={selected} className={list ? "block w-16 shrink-0 text-left" : "block w-full text-left"}>
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" loading="lazy" draggable={false} className={`${list ? "aspect-square" : "aspect-[4/3] sm:aspect-square"} w-full bg-white object-contain transition ${empty ? "opacity-50 grayscale" : ""}`} />
        ) : (
          <div className={`${list ? "aspect-square" : "aspect-[4/3] sm:aspect-square"} w-full bg-zinc-100 dark:bg-zinc-800`} />
        )}
      </button>
      <motion.span
        initial={false}
        animate={{ scale: selected ? 1 : 0.9, backgroundColor: selected ? "#2563eb" : "rgba(0,0,0,0.35)" }}
        className={"pointer-events-none absolute left-2 top-2 h-6 w-6 items-center justify-center rounded-full text-sm text-white " + (canSelect ? "flex" : "hidden")}
      >
        ✓
      </motion.span>
      {!trashMode && (
        <button type="button" onClick={() => onStar(p.key)} aria-pressed={starred} aria-label={`${p.name} 별표 ${starred ? "해제" : "등록"}`} className={`absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full text-2xl leading-none drop-shadow ${starred ? "text-amber-400" : "text-zinc-300 hover:text-amber-300"}`}>
          {starred ? "★" : "☆"}
        </button>
      )}
      {empty && !list && <span className="pointer-events-none absolute right-1.5 top-9 rounded-md bg-red-600 px-1 py-0.5 text-[10px] sm:right-2 sm:top-10 sm:px-1.5 sm:text-[11px] font-bold text-white">재고 없음</span>}
      {p.soldout && !list && <span className="pointer-events-none absolute left-2 top-10 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] text-white">품절</span>}
      <div className={list ? "flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-2 pr-10" : "p-2 sm:p-3"}>
        <div className={`break-keep ${list ? "min-w-[11rem] flex-1 text-sm leading-snug" : "line-clamp-2 min-h-[2.6em] text-xs leading-snug sm:line-clamp-3 sm:min-h-[3.6em] sm:text-[13px]"} ${empty ? "text-red-800 dark:text-red-200" : ""}`}>
          {p.name}
          {list && p.soldout && <span className="ml-1.5 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] text-white">품절</span>}
          {list && <small className="block text-[11px] text-zinc-500">{p.brand}{p.brand ? " · " : ""}{(p as Product).model}{(p as Product).model ? " · " : ""}<b className="tabular-nums text-zinc-700 dark:text-zinc-300">{p.price > 0 ? `${p.price.toLocaleString("ko-KR")}원` : "가격 미등록"}</b>{vendor?.vendor && (vendor.url ? <a href={vendor.url} target="_blank" rel="noopener noreferrer" title="눌러서 구매 링크로 이동" className={`ml-1.5 rounded px-1.5 py-0.5 font-bold hover:underline ${vendorColor(vendor.vendor)}`}>{vendor.vendor} ↗</a> : <span className={`ml-1.5 rounded px-1.5 py-0.5 font-bold ${vendorColor(vendor.vendor)}`}>{vendor.vendor}</span>)}{vendor?.unit && <span className="ml-1">{vendor.unit}</span>}</small>}
        </div>
        {!list && (p.brand || (p as Product).model) && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{[p.brand, (p as Product).model].filter(Boolean).join(" · ")}</div>}
        {!list && vendor && (vendor.vendor || vendor.unit) && <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">{vendor.vendor && (vendor.url ? <a href={vendor.url} target="_blank" rel="noopener noreferrer" title="눌러서 구매 링크로 이동" className={`max-w-full truncate rounded-md px-1.5 py-0.5 font-bold underline-offset-2 hover:underline ${vendorColor(vendor.vendor)}`}>{vendor.vendor} ↗</a> : <span className={`max-w-full truncate rounded-md px-1.5 py-0.5 font-bold ${vendorColor(vendor.vendor)}`}>{vendor.vendor}</span>)}{vendor.unit && <span className="text-zinc-500">{vendor.unit}</span>}</div>}
        {!list && <div className="mt-0.5 text-[11px] font-bold tabular-nums text-zinc-800 dark:text-zinc-200">{p.price > 0 ? <>{p.price.toLocaleString("ko-KR")}원</> : <span className="font-normal text-zinc-400">가격 미등록</span>}</div>}
        {inv && (inv.add || (trashMode && inv.del)) && (
          <div className="mt-0.5 text-[11px] font-semibold leading-snug text-blue-700 dark:text-blue-300">
            {inv.add && <div suppressHydrationWarning>{inv.add.src} 추가 · {inv.add.by} · {markTime(inv.add.at)}</div>}
            {trashMode && inv.del && <div className="text-red-600 dark:text-red-300" suppressHydrationWarning>{inv.del.src} 삭제 · {inv.del.by} · {markTime(inv.del.at)}</div>}
          </div>
        )}
        {p.kind === "연장" && !trashMode && deployed.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {deployed.map((d, i) => <span key={i} className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">{d.icon} {d.label} 배정{d.qty > 1 ? " ×" + d.qty : ""}</span>)}
          </div>
        )}
        {!trashMode && <div className={list ? "w-48 [&>div]:mt-0" : "contents"}><StockBox value={p.stock ?? 0} canEdit={canEdit} onCommit={n => onStock(p.key, n)} draft={draft} setDraft={n => onDraft(p.key, n)} /></div>}
        {deletedAt && (
          <div className="mt-1.5 text-[11px] text-zinc-500">
            삭제 <time suppressHydrationWarning dateTime={deletedAt}>{new Date(deletedAt).toLocaleString("ko-KR")}</time>
          </div>
        )}
        {((trashMode && canDelete) || (!trashMode && (canDelete || canEdit))) && (
        <div className={`${list ? "ml-auto" : "mt-2.5"} flex items-center gap-2`}>
          {trashMode ? (
            <div className="ml-auto flex flex-wrap justify-end gap-1 sm:gap-1.5">
              <motion.button
                type="button"
                onClick={() => onAction(p.key, "restore")}
                className="rounded-lg bg-emerald-50 whitespace-nowrap px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-[12px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                복원
              </motion.button>
              <motion.button
                type="button"
                onClick={() => onAction(p.key, "purge")}
                className="rounded-lg bg-red-50 whitespace-nowrap px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-[12px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300"
              >
                영구 삭제
              </motion.button>
            </div>
          ) : (
            <div className="ml-auto flex flex-wrap justify-end gap-1 sm:gap-1.5">
              {shiftable && (
                <>
                  <motion.button type="button" aria-label="앞으로" disabled={!shiftable.prev} onClick={() => onShift(p.key, -1)} className="rounded-lg bg-zinc-100 px-1.5 py-1 text-[11px] sm:px-2 sm:py-1.5 sm:text-[12px] font-bold disabled:opacity-30 dark:bg-zinc-800">◀</motion.button>
                  <motion.button type="button" aria-label="뒤로" disabled={!shiftable.next} onClick={() => onShift(p.key, 1)} className="rounded-lg bg-zinc-100 px-1.5 py-1 text-[11px] sm:px-2 sm:py-1.5 sm:text-[12px] font-bold disabled:opacity-30 dark:bg-zinc-800">▶</motion.button>
                </>
              )}
              {canEdit && (
                <motion.button type="button" onClick={() => onRename(p)} className="rounded-lg bg-zinc-100 whitespace-nowrap px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-[12px] font-bold dark:bg-zinc-800">
                  수정
                </motion.button>
              )}
              {canEdit && (
                <motion.button type="button" onClick={() => onMove(p.key)} className="rounded-lg bg-blue-50 whitespace-nowrap px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-[12px] font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                  이동
                </motion.button>
              )}
              {canDelete && (
                <motion.button type="button" onClick={() => onAction(p.key, "delete")} className="rounded-lg bg-red-50 whitespace-nowrap px-2 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-[12px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">
                  삭제
                </motion.button>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </motion.div>
  );
}

export default function AdminCatalog({
  deployed: deployedMap, vendors = {}, invMarks = {}, invExcluded, canSetInvExclude = false, initialProducts, initialTrash, trades: initialTrades, categories, categoryTrades, canRegister, canEdit, canDelete,
}: {
  vendors?: Record<string, { vendor: string; unit: string; url: string }>; // 품목 번호 → 구매처·판매단위·구매 링크
  invExcluded?: { trades: string[]; categories: string[] }; // 장비조사에서 제외한 공정·카테고리
  canSetInvExclude?: boolean; // 모든 권한이 있는 사람만 제외 설정을 바꿀 수 있다
  invMarks?: Record<string, InvMark>; // 품목 번호 → 장비조사에서 추가·삭제한 사람과 때
  deployed: Record<string, { icon: string; label: string; qty: number }[]>; // 연장 품목 번호 → 배정된 차량
  initialProducts: Product[];
  initialTrash: TrashedProduct[];
  trades: string[];
  categories: string[]; // 카테고리 이름 목록(비어 있는 카테고리 포함)
  categoryTrades: Record<string, string>; // 카테고리 → 묶어 보여 줄 공정 (빈 값 = 미지정)
  canRegister: boolean; // 카테고리 등록
  canEdit: boolean; // 카테고리 이름 수정 · 소모품의 카테고리 이동
  canDelete: boolean; // 소모품의 "삭제" 권한 (없으면 보기 전용)
}) {
  const router = useRouter();
  // 차량정보에서 배정·재고가 바뀐 채로 돌아와도 옛 화면이 남지 않게, 열릴 때 서버 데이터를 한 번 새로 받는다
  useEffect(() => { router.refresh(); }, [router]);
  const [products, setProducts] = useState(initialProducts);
  const [trash, setTrash] = useState(initialTrash);
  const [view, setView] = useState<"catalog" | "trash">("catalog");
  const [kind, setKind] = useState<Kind>("상비품"); // 장비운용 분류 탭
  const [cat, setCat] = useState("전체");
  const [sub, setSub] = useState("");
  const [trade, setTrade] = useState("전체");
  const [q, setQ] = useState("");
  const [onlyStar, setOnlyStar] = useState(false);
  const starsRaw = useSyncExternalStore(subscribeStars, readStarsRaw, () => "[]");
  const starSet = useMemo(() => new Set(parseStars(starsRaw)), [starsRaw]);
  const onStar = useCallback((k: string) => {
    const cur = parseStars(readStarsRaw());
    try {
      window.localStorage.setItem(STAR_KEY, JSON.stringify(cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]));
    } catch {
      // 저장 못 해도 다른 기능에는 문제없다
    }
    window.dispatchEvent(new Event(STAR_EVENT));
  }, []);
  const clearStars = useCallback(() => {
    try {
      window.localStorage.setItem(STAR_KEY, "[]");
    } catch {
      // 저장 못 해도 다른 기능에는 문제없다
    }
    window.dispatchEvent(new Event(STAR_EVENT));
    setOnlyStar(false);
  }, []);
  const [listView, setListView] = useState(false); // 보기 방식: 카드형 / 리스트형
  const [sort, setSort] = useState("stock"); // 기본: 재고 있는 품목이 위로
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [trades, setTrades] = useState(initialTrades);
  const [newTrade, setNewTrade] = useState("");
  const [tradeDel, setTradeDel] = useState<string | null>(null); // 삭제 확인 중인 공정
  const [catList, setCatList] = useState(categories);
  const [catTrades, setCatTrades] = useState(categoryTrades);
  const [newCatTrade, setNewCatTrade] = useState("");
  const [moveKeys, setMoveKeys] = useState<string[] | null>(null); // 카테고리 이동 창
  const [moveErr, setMoveErr] = useState("");
  const [catOpen, setCatOpen] = useState(false); // 카테고리 관리 창
  const [addOpen, setAddOpen] = useState(false); // 품목 추가 창
  const [newCat, setNewCat] = useState("");
  const [renaming, setRenaming] = useState<{ name: string; to: string } | null>(null);
  const [catErr, setCatErr] = useState("");
  const [catDel, setCatDel] = useState<string | null>(null); // 삭제 확인 중인 카테고리
  // 장비조사 제외: 지금 고른 공정·카테고리를 장비조사 목록에서 빼거나 다시 넣는다 (누르면 바로 저장)
  const [invEx, setInvEx] = useState(invExcluded ?? { trades: [], categories: [] });
  const [invBusy, setInvBusy] = useState(false);
  async function toggleInvEx(kind: "trade" | "category", name: string) {
    if (invBusy) return;
    const has = kind === "trade" ? invEx.trades.includes(name) : invEx.categories.includes(name);
    const next = kind === "trade"
      ? { ...invEx, trades: has ? invEx.trades.filter(x => x !== name) : [...invEx.trades, name] }
      : { ...invEx, categories: has ? invEx.categories.filter(x => x !== name) : [...invEx.categories, name] };
    setInvBusy(true);
    try {
      const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ menu: "inventory", action: "excludeSave", excludedTrades: next.trades, excludedCategories: next.categories }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "저장하지 못했어요.");
      setInvEx(next);
      setToast({ id: Date.now(), text: has ? `“${name}” ${kind === "trade" ? "공정" : "카테고리"}를 장비조사에 다시 넣었어요` : `“${name}” ${kind === "trade" ? "공정" : "카테고리"}를 장비조사에서 제외했어요` });
    } catch (e) {
      setToast({ id: Date.now(), text: e instanceof Error ? e.message : "서버에 연결할 수 없어요." });
    }
    setInvBusy(false);
  }
  const [editP, setEditP] = useState<Product | TrashedProduct | null>(null); // 품목 수정 창
  const canSelect = canDelete || canEdit;
  const canManageCats = canRegister || canEdit || canDelete;

  const trashMode = view === "trash";
  const kindCounts = useMemo(() => { const m: Record<string, number> = {}; (trashMode ? trash : products).forEach(p => { m[p.kind] = (m[p.kind] ?? 0) + 1; }); return m; }, [products, trash, trashMode]);
  const base: (Product | TrashedProduct)[] = useMemo(() => (trashMode ? trash : products).filter(p => p.kind === kind), [trashMode, trash, products, kind]);

  // 필터 단계: 분류 → 세부분류 → 공정 → 검색 (자재는 출처 사이트 구분 없이 하나로 통합돼 있다)
  const cats = useMemo(() => {
    // 공정을 고르면 그 공정에 지정된 카테고리만 보여 준다 (미배정 = 어느 공정에도 지정 안 된 카테고리)
    const inTrade = (c: string) => trade === "전체" || (trade === "미배정" ? !trades.includes(catTrades[c] ?? "") : catTrades[c] === trade);
    const counts = new Map<string, number>();
    base.forEach(p => { if (inTrade(p.category)) counts.set(p.category, (counts.get(p.category) ?? 0) + 1); });
    const m = new Map<string, number>();
    catList.forEach(c => { if (inTrade(c) && (!trashMode || counts.has(c))) m.set(c, counts.get(c) ?? 0); }); // 소모품 보기에서는 비어 있는 카테고리도 보여 준다
    counts.forEach((n, c) => { if (!m.has(c)) m.set(c, n); });
    return m;
  }, [base, catList, trashMode, trade, trades, catTrades]);
  const activeCat = cat === "전체" || cats.has(cat) ? cat : "전체";
  const byCat = useMemo(() => base.filter(p => (activeCat === "전체" ? cats.has(p.category) : p.category === activeCat)), [base, activeCat, cats]);
  const subs = useMemo(() => (activeCat === "전체" ? [] : [...new Set(byCat.map(p => p.sub).filter(Boolean))]), [byCat, activeCat]);
  const activeSub = subs.includes(sub) ? sub : "";
  const starCount = useMemo(() => products.filter(p => starSet.has(p.key)).length, [products, starSet]);
  const starOnly = onlyStar && !trashMode && starCount > 0;
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const r = byCat.filter(
      p =>
        (!starOnly || starSet.has(p.key)) &&
        (!activeSub || p.sub === activeSub) &&
        (!kw || `${p.name} ${p.brand} ${(p as Product).model ?? ""} ${p.sub}`.toLowerCase().includes(kw)),
    );
    if (sort === "nm") return [...r].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (sort === "stock") return [...r].sort((a, b) => Number((b as Product).stock > 0) - Number((a as Product).stock > 0)); // 재고 있는 품목 먼저, 나머지는 원래 순서 그대로
    return r;
  }, [byCat, activeSub, q, sort, starOnly, starSet]); // 공정 필터는 카테고리 단위(cats)로 이미 적용돼 있다

  // 한 페이지 분량: 화면 폭에 따라 카드 줄 수를 정한다 (PC 4줄 · 모바일 5줄), 리스트형은 PC 20개 · 모바일 12개
  const cols = useSyncExternalStore(
    cb => { window.addEventListener("resize", cb); return () => window.removeEventListener("resize", cb); },
    () => { const w = window.innerWidth; return w >= 1024 ? 6 : w >= 768 ? 4 : w >= 640 ? 3 : 2; },
    () => 6,
  );
  const pageSize = listView ? (cols <= 2 ? 12 : 20) : cols * (cols <= 2 ? 5 : 4);
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const visible = list.slice((curPage - 1) * pageSize, curPage * pageSize);
  const goPage = (n: number) => { setPage(Math.max(1, Math.min(totalPages, n))); window.scrollTo({ top: 0 }); };
  // 페이지 번호 줄: 1 … 4 5 [6] 7 8 … 20
  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1).filter(n => n === 1 || n === totalPages || Math.abs(n - curPage) <= 2);
  const selCount = selected.size;

  // 필터를 바꾸면 선택을 비운다 (안 보이는 자재가 같이 지워지는 사고 방지)
  const resetSel = () => setSelected(new Set());
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); resetSel(); };

  function toggleSel(k: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  const selectAllShown = () => setSelected(new Set(list.map(p => p.key)));

  // 엑셀 내보내기: 지금 화면에 걸린 필터대로 추려진 목록 전체를 "공정 → 카테고리" 순서로, 카테고리마다 시트 한 장씩 나눈다.
  // 사진 포함이면 각 행의 첫 열에 작은 사진(JPEG)을 넣는다 (엑셀은 webp 를 못 읽어서 브라우저에서 변환한다)
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  async function thumb(url: string): Promise<Uint8Array | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      const S = PHOTO_PX * 2; // 선명하게 2배로 만든다
      const cv = document.createElement("canvas");
      cv.width = S; cv.height = S;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, S, S);
      const k = Math.min(S / bmp.width, S / bmp.height);
      ctx.drawImage(bmp, (S - bmp.width * k) / 2, (S - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
      bmp.close();
      const blob = await new Promise<Blob | null>(res => cv.toBlob(res, "image/jpeg", 0.8));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch { return null; }
  }
  async function exportExcel(withPhoto: boolean) {
    if (exporting) return;
    setExporting(true);
    try {
      const header = [...(withPhoto ? ["사진"] : []), "자재번호", "세부분류", "자재명", "사용 브랜드", "공정", "단가", "재고", ...(trashMode ? ["삭제일"] : [])];
      const widths = [...(withPhoto ? [10] : []), 11, 14, 40, 16, 18, 12, 8, ...(trashMode ? [12] : [])];
      const tradeOf = (c: string) => (trades.includes(catTrades[c] ?? "") ? catTrades[c] : "미배정");
      const groups = new Map<string, (Product | TrashedProduct)[]>();
      list.forEach(p => { const g = groups.get(p.category); if (g) g.push(p); else groups.set(p.category, [p]); });
      const order = [...trades, "미배정"];
      const photos = new Map<string, Uint8Array | null>();
      if (withPhoto) {
        const todo = list.filter(p => p.image);
        for (let i = 0; i < todo.length; i += 8) {
          await Promise.all(todo.slice(i, i + 8).map(async p => { photos.set(p.key, await thumb(p.image)); }));
        }
      }
      const sheets = [...groups.entries()]
        .sort((a, b) => order.indexOf(tradeOf(a[0])) - order.indexOf(tradeOf(b[0])))
        .map(([cat, items]) => ({
          name: tradeOf(cat) + "_" + cat, header, widths,
          images: withPhoto ? items.map(p => photos.get(p.key) ?? null) : undefined,
          rows: items.map(p => [
            ...(withPhoto ? [""] : []),
            p.key, p.sub, p.name, p.brand, p.trades.join(", "), p.price,
            (p as Product).stock ?? 0,
            ...(trashMode ? [(p as TrashedProduct).deletedAt?.slice(0, 10) ?? ""] : []),
          ]),
        }));
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      downloadBlob(buildXlsx(sheets), `${trashMode ? "창고장비현황_휴지통" : "창고장비현황_" + kind}${withPhoto ? "_사진" : ""}_${stamp}.xlsx`);
      setExportOpen(false);
    } catch (err) {
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "엑셀 파일을 만들지 못했어요." });
    } finally { setExporting(false); }
  }

  async function run(mode: Mode | "purge", keys: string[]): Promise<boolean> {
    const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: mode, keys }) });
    if (r.status === 401) { router.replace("/"); return false; }
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "요청에 실패했어요.");
    const set = new Set(keys);
    if (mode === "purge") {
      setTrash(prev => prev.filter(p => !set.has(p.key))); // 서버에서 데이터·이미지가 완전히 지워짐
    } else if (mode === "delete") {
      const now = new Date().toISOString();
      setProducts(prev => prev.filter(p => !set.has(p.key)));
      setTrash(prev => [...prev, ...products.filter(p => set.has(p.key)).map(p => ({ ...p, deletedAt: now }))]);
    } else {
      setTrash(prev => prev.filter(p => !set.has(p.key)));
      setProducts(prev =>
        [...prev, ...trash.filter(p => set.has(p.key)).map(p => {
          const { deletedAt: _d, ...rest } = p;
          void _d;
          return rest;
        })].sort((a, b) => a.seq - b.seq),
      );
    }
    return true;
  }

  async function callCat(body: object): Promise<{ ok: boolean; error?: string; name?: string }> {
    const r = await fetch("/api/admin/categories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { router.replace("/"); return { ok: false, error: "권한이 없어요." }; }
    const j = (await r.json().catch(() => ({}))) as { error?: string; name?: string };
    return r.ok ? { ok: true, name: j.name } : { ok: false, error: j.error ?? "요청에 실패했어요." };
  }
  async function callTrade(body: object): Promise<{ ok: boolean; error?: string; count?: number }> {
    const r = await fetch("/api/admin/trades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { router.replace("/"); return { ok: false, error: "권한이 없어요." }; }
    const j = (await r.json().catch(() => ({}))) as { error?: string; count?: number };
    return r.ok ? { ok: true, count: j.count } : { ok: false, error: j.error ?? "요청에 실패했어요." };
  }
  async function addTradeName(e: React.FormEvent) {
    e.preventDefault();
    const name = newTrade.trim().replace(/\s+/g, " ");
    if (!name || busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callTrade({ action: "add", name });
      if (r.ok) { setTrades(l => [...l, name]); setNewTrade(""); } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  // 공정 순서 바꾸기: name 을 to 가 있던 자리로 (상단 공정 이름 끌기 · 카테고리 관리의 ◀▶ 버튼)
  const [dragTrade, setDragTrade] = useState<string | null>(null);
  const [overTrade, setOverTrade] = useState<string | null>(null);
  async function moveTradeTo(name: string, to: string) {
    setDragTrade(null); setOverTrade(null);
    if (busy || name === to) return;
    const i = trades.indexOf(name), j = trades.indexOf(to);
    if (i < 0 || j < 0) return;
    const before = trades;
    const n = [...trades];
    n.splice(j, 0, n.splice(i, 1)[0]);
    setTrades(n); // 먼저 화면에 반영
    try {
      const r = await callTrade({ action: "reorder", name, to });
      if (!r.ok) throw new Error(r.error || "순서를 바꾸지 못했어요.");
    } catch (err) {
      setTrades(before);
      setCatErr(err instanceof Error ? err.message : "서버에 연결할 수 없어요.");
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "서버에 연결할 수 없어요." });
    }
  }
  async function deleteTradeName(name: string) {
    if (busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callTrade({ action: "delete", name });
      if (r.ok) {
        const strip = <T extends { trades: string[] }>(rows: T[]) => rows.map(p => (p.trades.includes(name) ? { ...p, trades: p.trades.filter(t => t !== name) } : p));
        setProducts(strip); setTrash(strip);
        setCatTrades(m => Object.fromEntries(Object.entries(m).map(([c, t]) => [c, t === name ? "" : t])));
        setTrades(l => l.filter(t => t !== name));
        if (trade === name) setTrade("전체");
        if (newCatTrade === name) setNewCatTrade("");
        setTradeDel(null);
        setToast({ id: Date.now(), text: "“" + name + "” 공정을 지웠어요" });
      } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  async function moveCat(name: string, dir: "up" | "down") {
    if (busy) return;
    const i = catList.indexOf(name);
    const same = (c: string) => (catTrades[c] ?? "") === (catTrades[name] ?? "");
    let j = i;
    do j += dir === "up" ? -1 : 1;
    while (j >= 0 && j < catList.length && !same(catList[j]));
    if (i < 0 || j < 0 || j >= catList.length) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "reorder", name, dir });
      if (r.ok) setCatList(l => { const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n; }); else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  // 위쪽 카테고리 칩을 끌어서 순서 바꾸기 (마우스 기기, 수정 권한)
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  async function dropCat(to: string) {
    const from = dragCat;
    setDragCat(null); setOverCat(null);
    if (!from || from === to || busy) return;
    const i = catList.indexOf(from), j = catList.indexOf(to);
    if (i < 0 || j < 0) return;
    const before = catList;
    const n = [...catList];
    n.splice(j, 0, n.splice(i, 1)[0]);
    setCatList(n); // 먼저 화면에 반영
    try {
      const r = await callCat({ action: "reorder", name: from, to });
      if (!r.ok) throw new Error(r.error || "순서를 바꾸지 못했어요.");
    } catch (err) {
      setCatList(before);
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "서버에 연결할 수 없어요." });
    }
  }
  async function setTradeOf(name: string, trade: string) {
    if (busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "settrade", name, trade });
      if (r.ok) {
        const oldHead = headOf(name, catTrades, trades), newHead = headOf(name, { ...catTrades, [name]: trade }, trades);
        const re = <T extends { category: string; sub: string }>(rows: T[]) => rows.map(p => (p.category === name ? { ...p, sub: rewriteSub(p.sub, oldHead, newHead) } : p));
        setProducts(re); setTrash(re);
        setCatTrades(m => ({ ...m, [name]: trade }));
      } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  async function addCat(e: React.FormEvent) {
    e.preventDefault();
    const name = newCat.trim().replace(/\s+/g, " ");
    if (!name || busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "add", name, trade: newCatTrade });
      if (r.ok) { setCatList(l => [...l, name]); setCatTrades(m => ({ ...m, [name]: newCatTrade })); setNewCat(""); } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  async function renameCat() {
    if (!renaming || busy) return;
    const { name, to } = renaming;
    const next = to.trim().replace(/\s+/g, " ");
    if (!next || next === name) { setRenaming(null); return; }
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "rename", name, to: next });
      if (r.ok) {
        setCatList(l => l.map(c => (c === name ? next : c)));
        setCatTrades(m => { const { [name]: t, ...rest } = m; return { ...rest, [next]: t ?? "" }; });
        const oldHead = headOf(name, catTrades, trades), newHead = headOf(next, { ...catTrades, [next]: catTrades[name] ?? "" }, trades);
        const re = <T extends { category: string; sub: string }>(rows: T[]) => rows.map(p => (p.category === name ? { ...p, category: next, sub: rewriteSub(p.sub, oldHead, newHead) } : p));
        setProducts(re); setTrash(re);
        if (cat === name) setCat(next);
        setRenaming(null);
      } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  async function deleteCat(name: string) {
    if (busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "delete", name });
      if (r.ok) {
        const now = new Date().toISOString();
        const gone = products.filter(p => p.category === name);
        setProducts(prev => prev.filter(p => p.category !== name)); // 그 카테고리의 소모품은 휴지통으로
        setTrash(prev => [...prev, ...gone.map(p => ({ ...p, deletedAt: now }))]);
        setCatList(l => l.filter(c => c !== name));
        setCatTrades(m => { const { [name]: _t, ...rest } = m; void _t; return rest; });
        const goneKeys = new Set(gone.map(p => p.key));
        setSelected(prev => new Set([...prev].filter(k => !goneKeys.has(k))));
        if (cat === name) setCat("전체");
        setCatDel(null);
        setToast({ id: Date.now(), text: gone.length ? "“" + name + "” 카테고리를 지우고 소모품 " + gone.length + "개를 휴지통으로 옮겼어요" : "“" + name + "” 카테고리를 지웠어요" });
      } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
  }
  // 품목 순서 이동: 지금 보이는 목록에서 앞/뒤 이웃과 자리를 바꾼다
  // 마우스로 끌어서 순서 바꾸기: 끌던 품목을 놓은 자리로 옮긴다 (필터로 보이는 목록 안에서)
  const [dragKey, setDragKey] = useState<string | null>(null);
  const endDrag = useCallback(() => setDragKey(null), []);
  // 마우스가 있는 기기에서만 끌어서 이동 (터치 기기·모바일은 ◀▶ 버튼으로 이동)
  const mouseUser = useSyncExternalStore(
    cb => { const m = window.matchMedia("(hover: hover) and (pointer: fine)"); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia("(hover: hover) and (pointer: fine)").matches,
    () => false,
  );
  const catDrag = mouseUser && canEdit && !trashMode; // 카테고리 칩 끌어서 이동 가능 여부
  async function dropOn(targetKey: string) {
    const from = dragKey;
    setDragKey(null);
    if (!from || from === targetKey || busy) return;
    const keys = list.map(p => p.key);
    const fi = keys.indexOf(from), ti = keys.indexOf(targetKey);
    if (fi < 0 || ti < 0) return;
    keys.splice(ti, 0, keys.splice(fi, 1)[0]);
    const seqs = list.map(p => p.seq).sort((x, y) => x - y);
    const next = new Map(keys.map((k, i) => [k, seqs[i]]));
    const prev = products;
    setProducts(rows => rows.map(p => (next.has(p.key) ? { ...p, seq: next.get(p.key)! } : p)).sort((x, y) => x.seq - y.seq)); // 먼저 화면에 반영
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reorder", keys }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "순서를 바꾸지 못했어요.");
    } catch (err) {
      setProducts(prev);
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "순서를 바꾸지 못했어요." });
    }
  }
  async function shiftProduct(key: string, dir: -1 | 1) {
    if (busy) return;
    const i = list.findIndex(p => p.key === key);
    const other = list[i + dir];
    if (i < 0 || !other) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "swap", a: key, b: other.key }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "순서를 바꾸지 못했어요.");
      const sa = list[i].seq, sb = other.seq;
      setProducts(prev => prev.map(p => (p.key === key ? { ...p, seq: sb } : p.key === other.key ? { ...p, seq: sa } : p)).sort((x, y) => x.seq - y.seq));
    } catch (err) { setToast({ id: Date.now(), text: err instanceof Error ? err.message : "순서를 바꾸지 못했어요." }); }
    setBusy(false);
  }
  // 카드마다 수량을 입력만 해 두고 한꺼번에 저장하기: 입력한 수량은 drafts 에 모았다가 「전체 저장」으로 한 번에 반영한다
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  function setDraftOf(key: string, n: number | null) {
    setDrafts(d => {
      const next = { ...d };
      if (n === null || n === (products.find(p => p.key === key)?.stock ?? 0)) delete next[key]; else next[key] = n;
      return next;
    });
  }
  async function saveAllDrafts() {
    const items = Object.entries(drafts).map(([key, stock]) => ({ key, stock }));
    if (busy || items.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stockBulk", items }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "재고를 저장하지 못했어요.");
      setProducts(rows => rows.map(p => (p.key in drafts ? { ...p, stock: drafts[p.key] } : p)));
      setDrafts({});
      setToast({ id: Date.now(), text: "재고 " + items.length + "개를 저장했어요" });
    } catch (err) {
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "재고를 저장하지 못했어요." });
    } finally { setBusy(false); }
  }
  // 재고 수량 저장: 화면에 먼저 반영하고, 서버에 저장하지 못하면 되돌린다
  async function setStockOf(key: string, stock: number) {
    setDraftOf(key, null);
    const before = products.find(p => p.key === key)?.stock ?? 0;
    setProducts(rows => rows.map(p => (p.key === key ? { ...p, stock } : p)));
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stock", key, stock }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "재고를 저장하지 못했어요.");
    } catch (err) {
      setProducts(rows => rows.map(p => (p.key === key ? { ...p, stock: before } : p)));
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "재고를 저장하지 못했어요." });
    }
  }

  // 엑셀로 올린 재고: 파일에서 읽어 바뀌는 항목만 미리 보여 주고, 확인하면 한 번에 반영한다
  const [stockUp, setStockUp] = useState<{ changes: { key: string; name: string; from: number; to: number }[]; unknown: number; bad: number; same: number } | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false); // 재고 업로드 안내 창 (양식 받기 → 파일 올리기)
  // 양식: 지금 있는 소모품 전체를 공정_카테고리 시트로 나누고, 재고 열에는 현재 수량을 채워 둔다. 맨 앞 "작성방법" 시트는 업로드 때 무시된다.
  function downloadStockTemplate() {
    const header = ["자재번호", "세부분류", "자재명", "사용 브랜드", "재고"];
    const tradeOf = (c: string) => (trades.includes(catTrades[c] ?? "") ? catTrades[c] : "미배정");
    const groups = new Map<string, Product[]>();
    products.forEach(p => { const g = groups.get(p.category); if (g) g.push(p); else groups.set(p.category, [p]); });
    const order = [...trades, "미배정"];
    const sheets = [
      { name: "작성방법", header: ["재고 업로드 양식 작성방법"], widths: [70], rows: [
        ["1. 각 시트(공정_카테고리)의 \"재고\" 열에 실사한 수량을 적어 주세요. 0 이상의 정수만 가능해요."],
        ["2. 자재번호와 열 제목(자재번호 · 재고)은 바꾸거나 지우지 마세요. 자재번호로 품목을 찾아요."],
        ["3. 재고 칸을 비워 두면 그 품목은 바뀌지 않아요. 수량이 달라진 품목만 반영돼요."],
        ["4. 저장한 파일을 화면의 \"파일 올리기\"로 올리면, 바뀌는 내용을 미리 보여 준 뒤 확인하면 저장돼요."],
      ] as (string | number | null)[][] },
      ...[...groups.entries()]
        .sort((a, b) => order.indexOf(tradeOf(a[0])) - order.indexOf(tradeOf(b[0])))
        .map(([cat, items]) => ({
          name: tradeOf(cat) + "_" + cat, header, widths: [11, 26, 40, 16, 10],
          rows: items.map(x => [x.key, x.sub, x.name, x.brand, x.stock ?? 0]) as (string | number | null)[][],
        })),
    ];
    const d = new Date();
    downloadBlob(buildXlsx(sheets), `재고업로드양식_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.xlsx`);
  }
  async function onStockFile(file: File | undefined) {
    if (!file) return;
    setUploadOpen(false);
    try {
      const sheets = await readXlsx(file);
      const byKey = new Map(products.map(p => [p.key, p]));
      const last = new Map<string, number>();
      let unknown = 0, bad = 0, found = false;
      for (const sh of sheets) {
        const hi = sh.rows.findIndex(r => r.some(c => c.trim() === "자재번호") && r.some(c => c.trim() === "재고"));
        if (hi < 0) continue;
        found = true;
        const kc = sh.rows[hi].findIndex(c => c.trim() === "자재번호");
        const sc = sh.rows[hi].findIndex(c => c.trim() === "재고");
        for (const r of sh.rows.slice(hi + 1)) {
          const key = (r[kc] ?? "").trim();
          const raw = (r[sc] ?? "").trim();
          if (!key || raw === "") continue;
          const n = Number(raw.replace(/,/g, ""));
          if (!byKey.has(key)) { unknown++; continue; }
          if (!Number.isInteger(n) || n < 0 || n > 9_999_999) { bad++; continue; }
          last.set(key, n);
        }
      }
      if (!found) { setToast({ id: Date.now(), text: "“자재번호”와 “재고” 열이 있는 시트를 찾지 못했어요. 내보낸 엑셀 파일을 수정해서 올려 주세요." }); return; }
      const changes = [...last].filter(([k, n]) => byKey.get(k)!.stock !== n).map(([k, n]) => ({ key: k, name: byKey.get(k)!.name, from: byKey.get(k)!.stock ?? 0, to: n }));
      setModalErr("");
      setStockUp({ changes, unknown, bad, same: last.size - changes.length });
    } catch (err) {
      setToast({ id: Date.now(), text: err instanceof Error ? err.message : "엑셀 파일을 읽지 못했어요." });
    }
  }
  async function applyStockUp() {
    if (!stockUp || busy || stockUp.changes.length === 0) return;
    setBusy(true); setModalErr("");
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stockBulk", items: stockUp.changes.map(c => ({ key: c.key, stock: c.to })) }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "재고를 저장하지 못했어요.");
      const to = new Map(stockUp.changes.map(c => [c.key, c.to]));
      setProducts(rows => rows.map(p => (to.has(p.key) ? { ...p, stock: to.get(p.key)! } : p)));
      setToast({ id: Date.now(), text: "재고 " + stockUp.changes.length + "개를 엑셀 내용으로 바꿨어요" });
      setStockUp(null);
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : "재고를 저장하지 못했어요.");
    } finally { setBusy(false); }
  }

  // 카테고리로 옮기기: "이동" 창과, 카드·리스트를 위쪽 카테고리 칩으로 끌어다 놓는 경우가 함께 쓴다
  async function moveTo(allKeys: string[], category: string, fromDrag = false) {
    if (busy) return;
    const cur = new Map(products.map(p => [p.key, p.category]));
    const keys = allKeys.filter(k => cur.get(k) !== category);
    if (keys.length === 0) { if (fromDrag) setToast({ id: Date.now(), text: "이미 “" + category + "” 카테고리에 있어요" }); return; }
    setBusy(true); setMoveErr("");
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "move", keys, category }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "옮기지 못했어요.");
      const set = new Set(keys);
      const mv = <T extends { key: string; category: string; sub: string }>(rows: T[]) => rows.map(p => (set.has(p.key) ? { ...p, category, sub: headOf(category, catTrades, trades) } : p));
      setProducts(mv); setTrash(mv);
      setSelected(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
      setToast({ id: Date.now(), text: keys.length + "개를 “" + category + "”(으)로 옮겼어요" });
      setMoveKeys(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "옮기지 못했어요.";
      if (fromDrag) setToast({ id: Date.now(), text: msg }); else setMoveErr(msg);
    }
    setBusy(false);
  }
  const [kindKeys, setKindKeys] = useState<string[] | null>(null); // 분류 변경 창
  async function changeKind(to: Kind) {
    if (busy || !kindKeys) return;
    setBusy(true); setMoveErr("");
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "kind", keys: kindKeys, kind: to }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "분류를 바꾸지 못했어요.");
      const set = new Set(kindKeys);
      const mv = <T extends { key: string; kind: Kind }>(rows: T[]) => rows.map(p => (set.has(p.key) ? { ...p, kind: to } : p));
      setProducts(mv); setTrash(mv);
      setSelected(prev => { const n = new Set(prev); kindKeys.forEach(k => n.delete(k)); return n; });
      setToast({ id: Date.now(), text: kindKeys.length + "개를 “" + to + "”(으)로 옮겼어요" });
      setKindKeys(null);
    } catch (e) {
      setMoveErr(e instanceof Error ? e.message : "분류를 바꾸지 못했어요.");
    }
    setBusy(false);
  }
  const doMove = (category: string) => { if (moveKeys) void moveTo(moveKeys, category); };

  async function doConfirm() {
    if (!confirm) return;
    setBusy(true);
    setModalErr("");
    try {
      const ok = await run(confirm.mode, confirm.keys);
      if (ok) {
        const n = confirm.keys.length;
        setToast(
          confirm.mode === "purge"
            ? { id: Date.now(), text: `${n}개를 영구 삭제했어요` } // 되돌릴 수 없으므로 실행 취소 없음
            : {
                id: Date.now(),
                text: confirm.mode === "delete" ? `${n}개를 삭제했어요 (휴지통으로 이동)` : `${n}개를 복원했어요`,
                undo: { mode: confirm.mode === "delete" ? "restore" : "delete", keys: confirm.keys },
              },
        );
        setSelected(prev => { const next = new Set(prev); confirm.keys.forEach(k => next.delete(k)); return next; });
        setConfirm(null);
      }
    } catch (e) {
      setModalErr(e instanceof Error ? e.message : "요청에 실패했어요.");
    }
    setBusy(false);
  }

  async function undo(t: NonNullable<NonNullable<Toast>["undo"]>) {
    setToast(null);
    try { await run(t.mode, t.keys); } catch { setToast({ id: Date.now(), text: "되돌리지 못했어요." }); }
  }

  function switchView(v: "catalog" | "trash") {
    setView(v); setCat("전체"); setSub(""); setTrade("전체"); setQ(""); setPage(1); resetSel();
  }

  // 토스트는 6초 뒤 자동으로 사라진다
  const toastKey = toast?.id;
  useEffect(() => {
    if (toastKey == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastKey ? null : cur)), 6000);
    return () => window.clearTimeout(t);
  }, [toastKey]);

  // 공정 칩 + (고른 공정의) 카테고리 칩: 공정을 누르면 그 공정의 카테고리가 아래에 펼쳐진다
  const tradeCounts = new Map<string, number>();
  base.forEach(x => {
    const t = trades.includes(catTrades[x.category] ?? "") ? catTrades[x.category] : "미배정";
    tradeCounts.set(t, (tradeCounts.get(t) ?? 0) + 1);
  });
  const tradeChip = (t: string) => {
    const real = t !== "전체" && t !== "미배정";
    const n = t === "전체" ? base.length : tradeCounts.get(t) ?? 0;
    return (
      <button
        key={t}
        type="button"
        onClick={() => { filter(setTrade)(t); setCat("전체"); setSub(""); }}
        draggable={catDrag && real}
        title={catDrag && real ? "끌어서 공정 순서 바꾸기" : undefined}
        onDragStart={e => { e.dataTransfer.setData("text/plain", t); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(BLANK_DRAG, 0, 0); setDragTrade(t); }}
        onDragEnd={() => { setDragTrade(null); setOverTrade(null); }}
        onDragOver={e => { if (catDrag && dragTrade && real) { e.preventDefault(); if (overTrade !== t) setOverTrade(t); } }}
        onDrop={e => { if (dragTrade && real) { e.preventDefault(); void moveTradeTo(dragTrade, t); } }}
        className={`${chipBase} text-sm font-semibold ${trade === t ? chipOn : chipOff} ${dragTrade === t ? "opacity-40" : ""} ${overTrade === t && dragTrade && dragTrade !== t ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
      >
        {t === "미배정" ? "공정 미지정" : t}<small className="ml-1 opacity-70">{n}</small>
      </button>
    );
  };
  const catNames = [...cats.keys()].sort((x, y) => Number(x === "공통 소모품") - Number(y === "공통 소모품")); // "공통 소모품"은 맨 끝
  const chip = (c: string) => (
    <button
      key={c}
      type="button"
      onClick={() => { setCat(c); setSub(""); setPage(1); resetSel(); }}
      draggable={catDrag && c !== "전체" && c !== "공통 소모품"}
      onDragStart={e => { e.dataTransfer.setData("text/plain", c); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setDragImage(BLANK_DRAG, 0, 0); setDragCat(c); }}
      onDragEnd={() => { setDragCat(null); setOverCat(null); }}
      onDragOver={e => {
        if (c === "전체") return;
        if (catDrag && dragKey) { e.preventDefault(); if (overCat !== c) setOverCat(c); } // 카드·리스트를 이 카테고리로
        else if (catDrag && dragCat && c !== "공통 소모품") { e.preventDefault(); if (overCat !== c) setOverCat(c); } // 카테고리 순서 바꾸기
      }}
      onDragLeave={() => { if (overCat === c) setOverCat(null); }}
      onDrop={e => {
        e.preventDefault();
        if (dragKey && c !== "전체") { const k = dragKey; setDragKey(null); setOverCat(null); void moveTo(selected.has(k) ? [...selected] : [k], c, true); }
        else void dropCat(c);
      }}
      role="tab"
      aria-selected={activeCat === c}
      className={`shrink-0 rounded-t-lg border border-b-0 px-3.5 py-1.5 text-[13px] font-bold transition-colors ${activeCat === c ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"} ${dragCat === c ? "opacity-40" : ""} ${overCat === c && (dragKey || (dragCat && dragCat !== c)) ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
    >
      {c}<small className="ml-1 opacity-70">{c === "전체" ? [...cats.values()].reduce((x, n) => x + n, 0) : cats.get(c)}</small>
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">창고장비현황</h1>
        {canRegister && activeCat !== "전체" && ( // 카테고리를 고른 상태에서만 품목 추가
          <motion.button type="button" onClick={() => setAddOpen(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            + 품목 추가
          </motion.button>
        )}
      </header>

      {!canDelete && !canEdit && !canRegister && (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <b>보기 전용</b>이에요. 자재를 삭제하려면 최고 관리자나 개발팀에 이 메뉴의 <b>등록·수정·삭제</b> 권한을 요청해 주세요.
        </p>
      )}

      {/* 장비 목록은 항상 기본 화면이라 따로 탭이 필요 없다. 휴지통은 작은 버튼으로 들어가고, 안에서 목록으로 돌아온다. */}
      <div className="flex items-center gap-2">
        {trashMode ? (
          <>
            <button type="button" onClick={() => switchView("catalog")} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">← 장비 목록으로</button>
            <span className="text-sm font-extrabold">휴지통 <span className="text-zinc-500">{trash.length}</span></span>
          </>
        ) : (
          <button type="button" onClick={() => switchView("trash")} className="ml-auto rounded-xl bg-white px-3.5 py-2 text-sm font-bold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">🗑 휴지통 {trash.length}</button>
        )}
      </div>

      <div className="mt-3 flex gap-2" role="tablist" aria-label="창고장비현황 분류">
        {KINDS.map(k => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setCat("전체"); setSub(""); setPage(1); resetSel(); }} className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-extrabold sm:flex-none sm:px-8 ${kind === k ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-700 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {k}<small className="ml-1.5 opacity-70">{kindCounts[k] ?? 0}</small>
          </button>
        ))}
      </div>

      <div className="sticky top-0 z-20 -mx-4 mt-3 space-y-2 border-b border-black/10 bg-background/95 px-4 py-2.5 backdrop-blur dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={e => filter(setQ)(e.target.value)}
            placeholder="자재명·사용 브랜드 검색"
            className="min-w-[10rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900"
          />
          <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="stock">재고 있는 순</option>
            <option value="no">기본 순서</option>
            <option value="nm">이름순</option>
          </select>
          <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
            {([[false, "▦ 카드"], [true, "☰ 리스트"]] as const).map(([v, label]) => (
              <button key={label} type="button" aria-pressed={listView === v} onClick={() => { setListView(v); setPage(1); }} className={`px-3 py-2 ${listView === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSelect && list.length > 0 && (
            <button
              type="button"
              onClick={() => (selCount >= list.length ? resetSel() : selectAllShown())}
              className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold dark:border-white/15 dark:bg-zinc-900"
            >
              {selCount >= list.length ? "전체 해제" : `전체 선택 (${list.length})`}
            </button>
          )}
          {!trashMode && (
            <button type="button" aria-pressed={starOnly} disabled={starCount === 0} onClick={() => { setOnlyStar(v => !v); setPage(1); resetSel(); }} className={`rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-40 ${starOnly ? "border-amber-400 bg-amber-400 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>
              ★ 별표 {starCount}
            </button>
          )}
          {!trashMode && starCount > 0 && (
            <button type="button" onClick={clearStars} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold dark:border-white/15 dark:bg-zinc-900">
              별표 전체 해제
            </button>
          )}
          {canDelete && trashMode && trash.length > 0 && (
            <button
              type="button"
              onClick={() => { setModalErr(""); setConfirm({ mode: "purge", keys: trash.map(p => p.key) }); }}
              className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300"
            >
              휴지통 비우기 ({trash.length})
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
          {canSetInvExclude && !trashMode && invEx.trades.length + invEx.categories.length > 0 && (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-xl bg-zinc-100 px-3 py-2 text-sm font-bold dark:bg-zinc-800">장비조사 제외 {invEx.trades.length + invEx.categories.length}</summary>
              <div className="absolute right-0 z-20 mt-1 w-64 space-y-1 rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <p className="px-1 text-[11px] text-zinc-500">장비조사에서 빠져 있는 항목이에요. 눌러서 다시 추가해요.</p>
                {invEx.trades.map(t => (
                  <button key={"t" + t} type="button" disabled={invBusy} onClick={() => void toggleInvEx("trade", t)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"><span>{t} <small className="font-normal text-zinc-500">공정</small></span><span className="text-xs font-bold text-blue-600">＋ 다시 추가</span></button>
                ))}
                {invEx.categories.map(c => (
                  <button key={"c" + c} type="button" disabled={invBusy} onClick={() => void toggleInvEx("category", c)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"><span>{c} <small className="font-normal text-zinc-500">카테고리</small></span><span className="text-xs font-bold text-blue-600">＋ 다시 추가</span></button>
                ))}
              </div>
            </details>
          )}
          {canSetInvExclude && !trashMode && trade !== "전체" && (
            <button type="button" disabled={invBusy} onClick={() => void toggleInvEx("trade", trade)} title="이 공정을 장비조사 목록에서 뺍니다 (창고장비현황에는 영향 없음)" className={`rounded-xl px-3 py-2 text-sm font-bold disabled:opacity-50 ${invEx.trades.includes(trade) ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"}`}>
              {invEx.trades.includes(trade) ? `“${trade}” 공정 장비조사 제외됨 · 해제` : `“${trade}” 공정 장비조사에서 제외`}
            </button>
          )}
          {canSetInvExclude && !trashMode && cat !== "전체" && (
            <button type="button" disabled={invBusy} onClick={() => void toggleInvEx("category", cat)} title="이 카테고리를 장비조사 목록에서 뺍니다 (창고장비현황에는 영향 없음)" className={`rounded-xl px-3 py-2 text-sm font-bold disabled:opacity-50 ${invEx.categories.includes(cat) ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"}`}>
              {invEx.categories.includes(cat) ? `“${cat}” 카테고리 장비조사 제외됨 · 해제` : `“${cat}” 카테고리 장비조사에서 제외`}
            </button>
          )}
          {canManageCats && !trashMode && (
            <button type="button" onClick={() => { setCatErr(""); setRenaming(null); setCatOpen(true); }} className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
              카테고리 관리
            </button>
          )}
          <button type="button" disabled={list.length === 0} onClick={() => setExportOpen(true)} className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40 dark:bg-emerald-500/15 dark:text-emerald-300">
            엑셀 내보내기
          </button>
          {canEdit && !trashMode && (
            <button type="button" onClick={() => setUploadOpen(true)} className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              재고 업로드
            </button>
          )}
          <span className="pl-1 text-sm text-zinc-500">{list.length}개</span>
          </div>
        </div>
      </div>
      <div className="space-y-2 border-b border-black/10 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          {tradeChip("전체")}
          {trades.map(t => tradeChip(t))}
          {(tradeCounts.get("미배정") ?? 0) > 0 && tradeChip("미배정")}
        </div>
        {trade !== "전체" && (
          <div className="flex flex-wrap items-end gap-1 border-b border-black/15 pt-1 dark:border-white/15" role="tablist" aria-label="카테고리">
            {catNames.length > 0 ? <>{chip("전체")}{catNames.map(c => chip(c))}</> : <span className="px-2 text-sm text-zinc-500">이 공정에는 카테고리가 없어요.</span>}
          </div>
        )}
      </div>

      {canEdit && !trashMode && sort !== "no" && list.length > 1 && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          순서를 바꾸려면 정렬을 <b>기본 순서</b>로 바꿔야 해요.
          <button type="button" onClick={() => setSort("no")} className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">기본 순서로 보기</button>
        </p>
      )}
      <div className={listView ? "mt-4 flex flex-col gap-2" : "mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"}>
        <AnimatePresence mode="popLayout">
          {visible.map(p => (
            <ProductCard
              key={p.key}
              list={listView}
              dragging={dragKey === p.key}
              reorderable={sort === "no"}
              onDragStart={mouseUser && canEdit && !trashMode ? setDragKey : null}
              onDragEnd={endDrag}
              onDropOn={dropOn}
              canDelete={canDelete}
              canEdit={canEdit}
              onMove={k => { setMoveErr(""); setMoveKeys([k]); }}
              onRename={x => setEditP(x)}
              onShift={shiftProduct}
              onStock={setStockOf}
              draft={drafts[p.key] ?? null}
              onDraft={setDraftOf}
              shiftable={!mouseUser && canEdit && !trashMode && sort === "no" ? { prev: list[0]?.key !== p.key, next: list[list.length - 1]?.key !== p.key } : null}
              p={p}
              inv={invMarks[p.key]}
              vendor={vendors[p.key]}
              deployed={deployedMap[p.key] ?? []}
              selected={selected.has(p.key)}
              starred={starSet.has(p.key)}
              onStar={onStar}
              onSelect={toggleSel}
              onAction={(k, mode) => { setModalErr(""); setConfirm({ mode, keys: [k] }); }}
              trashMode={trashMode}
            />
          ))}
        </AnimatePresence>
      </div>
      {list.length === 0 && (
        <p className="py-20 text-center text-zinc-500">{trashMode ? "휴지통이 비어 있어요" : "해당하는 자재가 없어요"}</p>
      )}
      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-1.5 py-6" aria-label="페이지">
          <button type="button" disabled={curPage === 1} onClick={() => goPage(curPage - 1)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15 dark:bg-zinc-900">이전</button>
          {pageNums.map((n, i) => (
            <span key={n} className="contents">
              {i > 0 && n - pageNums[i - 1] > 1 && <span className="px-1 text-zinc-400">…</span>}
              <button type="button" aria-current={n === curPage ? "page" : undefined} onClick={() => goPage(n)} className={`min-w-9 rounded-lg border px-2.5 py-2 text-sm font-bold ${n === curPage ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{n}</button>
            </span>
          ))}
          <button type="button" disabled={curPage === totalPages} onClick={() => goPage(curPage + 1)} className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15 dark:bg-zinc-900">다음</button>
          <span className="w-full text-center text-xs text-zinc-500">{(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, list.length)} / 총 {list.length}개</span>
        </nav>
      )}

      {/* 선택 작업 바 */}
      <AnimatePresence>
        {canSelect && selCount > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 32 }}
            className="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[calc(100%-2rem)] max-w-xl items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-white shadow-2xl dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span className="mr-auto text-sm font-bold">{selCount}개 선택</span>
            <button type="button" onClick={selectAllShown} className="text-xs underline underline-offset-2 opacity-80">현재 목록 전체({list.length})</button>
            <button type="button" onClick={resetSel} className="text-xs font-bold underline underline-offset-2">전체 해제</button>
            {canEdit && (
              <motion.button type="button" onClick={() => { setMoveErr(""); setKindKeys([...selected]); }} className="rounded-xl bg-zinc-700 px-4 py-2 text-sm font-bold text-white">
                분류 변경
              </motion.button>
            )}
            {canEdit && !trashMode && (
              <motion.button type="button" onClick={() => { setMoveErr(""); setMoveKeys([...selected]); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                카테고리 이동
              </motion.button>
            )}
            {canDelete && (
              <motion.button
                type="button"
                onClick={() => { setModalErr(""); setConfirm({ mode: trashMode ? "restore" : "delete", keys: [...selected] }); }}
                className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${trashMode ? "bg-emerald-600" : "bg-red-600"}`}
              >
                {trashMode ? "복원" : "삭제"}
              </motion.button>
            )}
            {trashMode && canDelete && (
              <motion.button
                type="button"
                onClick={() => { setModalErr(""); setConfirm({ mode: "purge", keys: [...selected] }); }}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white"
              >
                영구 삭제
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 품목 수정: 이름·세부분류·브랜드·가격·사진 */}
      <EditProduct
        product={editP}
        onClose={() => setEditP(null)}
        onSaved={(key, e) => {
          const up = <T extends { key: string; name: string; sub: string; brand: string; price: number; kind: Kind; image: string }>(rows: T[]) => rows.map(p => (p.key === key ? { ...p, name: e.name, sub: e.sub, brand: e.brand, price: e.price, kind: e.kind ?? p.kind, image: e.image ?? p.image, ...(e.model !== undefined ? { model: e.model } : {}) } : p));
          setProducts(up); setTrash(up);
          setToast({ id: Date.now(), text: "품목 정보를 수정했어요" });
          setEditP(null);
        }}
      />

      {/* 분류 변경: 연장 / 소모품 / 자재 */}
      <Modal open={kindKeys !== null} onClose={() => !busy && setKindKeys(null)}>
        {kindKeys && (
          <>
            <h2 className="text-lg font-bold">{kindKeys.length}개를 어느 분류로 옮길까요?</h2>
            <div className="mt-3 flex gap-2">
              {KINDS.map(k => (
                <button key={k} type="button" disabled={busy} onClick={() => void changeKind(k)} className={`flex-1 rounded-xl py-3 text-sm font-extrabold disabled:opacity-50 ${k === kind ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{k}</button>
              ))}
            </div>
            {moveErr && <p className="mt-3 text-sm text-red-500" role="alert">{moveErr}</p>}
            <button type="button" disabled={busy} onClick={() => setKindKeys(null)} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          </>
        )}
      </Modal>

      {/* 카테고리 이동: 목록이 길어도 스크롤된다 */}
      <Modal open={moveKeys !== null} onClose={() => !busy && setMoveKeys(null)}>
        {moveKeys && (
          <>
            <h2 className="text-lg font-bold">{moveKeys.length}개를 어느 카테고리로 옮길까요?</h2>
            <div className="mt-3 max-h-[50vh] overflow-y-auto pr-1">
              {[...trades, ""].map(g => {
                const inG = catList.filter(c => (g === "" ? !trades.includes(catTrades[c] ?? "") : catTrades[c] === g));
                if (inG.length === 0) return null;
                return (
                  <div key={g || "none"} className="mb-3">
                    <div className="mb-1.5 text-xs font-bold text-blue-600 dark:text-blue-300">{g || "공정 미지정"}<small className="ml-1 font-normal text-zinc-500">{inG.length}</small></div>
                    <div className="space-y-1.5">
                      {inG.map(c => (
                        <button key={c} type="button" disabled={busy} onClick={() => doMove(c)} className="flex w-full items-center rounded-xl border border-black/10 px-4 py-3 text-left text-[15px] hover:border-blue-500 disabled:opacity-50 dark:border-white/10">
                          {c}
                          <small className="ml-auto text-zinc-500">{products.filter(p => p.category === c).length}개</small>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {catList.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">카테고리가 없어요. 먼저 카테고리를 만들어 주세요.</p>}
            </div>
            {moveErr && <p className="mt-3 text-sm text-red-500" role="alert">{moveErr}</p>}
            <button type="button" disabled={busy} onClick={() => setMoveKeys(null)} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          </>
        )}
      </Modal>

      <AddProduct
        open={addOpen}
        onClose={() => setAddOpen(false)}
        categories={catList}
        defaultKind={kind}
        defaultCategory={cat !== "전체" && catList.includes(cat) ? cat : ""}
        headOfCat={c => headOf(c, catTrades, trades)}
        onAdded={p => {
          setProducts(prev => [...prev, p]);
          setView("catalog"); setKind(p.kind); setTrade("전체"); setQ(""); setSub(""); setSort("no"); setCat(p.category); setPage(1);
          setToast({ id: Date.now(), text: "“" + p.name + "” 품목을 등록했어요" });
        }}
      />

      {/* 카테고리 관리: 등록 · 이름 수정 · 삭제 */}
      <Modal wide open={catOpen} onClose={() => !busy && setCatOpen(false)}>
        <h2 className="text-lg font-bold">카테고리 관리</h2>
        <p className="mt-1 text-xs text-zinc-500">카테고리는 지정한 공정별로 묶여요. ▲▼로 같은 공정 안에서 순서를 바꿀 수 있어요. 카테고리를 삭제하면 그 안의 소모품은 모두 휴지통으로 이동해요(복원 가능).</p>
        <div className="mt-3 max-h-[50vh] overflow-y-auto pr-1">
          {[...trades, ""].map(g => {
            const inG = catList.filter(c => (g === "" ? !trades.includes(catTrades[c] ?? "") : catTrades[c] === g));
            if (inG.length === 0) return null;
            return (
              <div key={g || "none"} className="mb-3">
                <div className="mb-1.5 text-xs font-bold text-blue-600 dark:text-blue-300">
                  {g || "공정 미지정"}
                  <small className="ml-1 font-normal text-zinc-500">{inG.length}</small>
                </div>
                <div className="space-y-1.5">
                  {inG.map((c, ci) => {
                    const n = products.filter(p => p.category === c).length;
                    return (
                      <div key={c} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-black/10 px-3 py-2 dark:border-white/10">
                        {renaming?.name === c ? (
                          <>
                            <input autoFocus value={renaming.to} maxLength={20} onChange={e => setRenaming({ name: c, to: e.target.value })} onKeyDown={e => { if (e.key === "Enter") renameCat(); }} aria-label="새 카테고리 이름" className="min-w-0 flex-1 rounded-lg border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
                            <button type="button" disabled={busy} onClick={renameCat} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">저장</button>
                            <button type="button" disabled={busy} onClick={() => setRenaming(null)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">취소</button>
                          </>
                        ) : (
                          <>
                            {canEdit && (
                              <span className="flex flex-col">
                                <button type="button" aria-label={c + " 위로"} disabled={busy || ci === 0} onClick={() => moveCat(c, "up")} className="px-1 text-[10px] leading-none text-zinc-500 disabled:opacity-25">▲</button>
                                <button type="button" aria-label={c + " 아래로"} disabled={busy || ci === inG.length - 1} onClick={() => moveCat(c, "down")} className="px-1 text-[10px] leading-none text-zinc-500 disabled:opacity-25">▼</button>
                              </span>
                            )}
                            <span className="min-w-[5rem] flex-1 truncate text-[15px]">{c}</span>
                            <small className="text-zinc-500">{n}개</small>
                            {canEdit && (
                              <select value={catTrades[c] ?? ""} disabled={busy} onChange={e => setTradeOf(c, e.target.value)} aria-label={c + " 공정"} className="max-w-[9rem] rounded-lg border border-black/10 bg-transparent px-1.5 py-1.5 text-xs dark:border-white/10">
                                <option value="">공정 미지정</option>
                                {trades.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            )}
                            {canEdit && <button type="button" disabled={busy} onClick={() => { setCatErr(""); setRenaming({ name: c, to: c }); }} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>}
                            {canDelete && <button type="button" disabled={busy} onClick={() => { setCatErr(""); setCatDel(c); }} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 disabled:opacity-35 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {(canRegister || canDelete || canEdit) && (
          <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
            <div className="text-xs font-bold text-blue-600 dark:text-blue-300">공정 관리 <small className="font-normal text-zinc-500">{trades.length}</small></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {trades.map((t, ti) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-black/10 py-1 pl-3 pr-1.5 text-sm dark:border-white/10">
                  {canEdit && <button type="button" aria-label={t + " 앞으로"} disabled={busy || ti === 0} onClick={() => moveTradeTo(t, trades[ti - 1])} className="rounded-full px-1 text-zinc-500 hover:text-blue-600 disabled:opacity-30">◀</button>}
                  {t}
                  {canEdit && <button type="button" aria-label={t + " 뒤로"} disabled={busy || ti === trades.length - 1} onClick={() => moveTradeTo(t, trades[ti + 1])} className="rounded-full px-1 text-zinc-500 hover:text-blue-600 disabled:opacity-30">▶</button>}
                  {canDelete && <button type="button" aria-label={t + " 공정 삭제"} disabled={busy} onClick={() => { setCatErr(""); setTradeDel(t); }} className="rounded-full px-1.5 text-zinc-500 hover:text-red-600 disabled:opacity-35">×</button>}
                </span>
              ))}
              {trades.length === 0 && <span className="text-sm text-zinc-500">공정이 없어요.</span>}
            </div>
            {canRegister && (
              <form onSubmit={addTradeName} className="mt-2 flex gap-2">
                <input value={newTrade} maxLength={10} onChange={e => setNewTrade(e.target.value)} placeholder="새 공정 이름" aria-label="새 공정 이름" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
                <motion.button disabled={busy || !newTrade.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">+ 공정 등록</motion.button>
              </form>
            )}
            {tradeDel !== null && (
              <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm dark:bg-red-500/10" role="alertdialog">
                <p className="font-semibold text-red-700 dark:text-red-300">“{tradeDel}” 공정을 삭제할까요?</p>
                <p className="mt-1 text-red-700/80 dark:text-red-200/80">소모품과 회원에 걸린 이 공정, 카테고리의 공정 지정이 모두 빠져요. 소모품은 지워지지 않아요. 이미 들어온 현장요청은 그대로 남아요.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setTradeDel(null)} className="flex-1 rounded-lg bg-white py-2 font-bold dark:bg-zinc-800">취소</button>
                  <button type="button" disabled={busy} onClick={() => deleteTradeName(tradeDel)} className="flex-1 rounded-lg bg-red-600 py-2 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "삭제"}</button>
                </div>
              </div>
            )}
          </div>
        )}
        {canRegister && (
          <form onSubmit={addCat} className="mt-3 flex gap-2">
            <input value={newCat} maxLength={20} onChange={e => setNewCat(e.target.value)} placeholder="새 카테고리 이름" aria-label="새 카테고리 이름" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
            <select value={newCatTrade} onChange={e => setNewCatTrade(e.target.value)} aria-label="공정" className="max-w-[9rem] rounded-xl border border-black/15 bg-transparent px-2 text-sm dark:border-white/15"><option value="">공정 미지정</option>{trades.map(t => <option key={t} value={t}>{t}</option>)}</select>
            <motion.button disabled={busy || !newCat.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">+ 등록</motion.button>
          </form>
        )}
        {catDel !== null && (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm dark:bg-red-500/10" role="alertdialog">
            <p className="font-semibold text-red-700 dark:text-red-300">
              “{catDel}” 카테고리를 삭제할까요?
            </p>
            <p className="mt-1 text-red-700/80 dark:text-red-200/80">
              {products.filter(p => p.category === catDel).length > 0
                ? "이 안의 소모품 " + products.filter(p => p.category === catDel).length + "개가 모두 휴지통으로 이동해요. 휴지통에서 복원할 수 있어요."
                : "비어 있는 카테고리예요."}
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setCatDel(null)} className="flex-1 rounded-lg bg-white py-2 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => deleteCat(catDel)} className="flex-1 rounded-lg bg-red-600 py-2 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "삭제"}</button>
            </div>
          </div>
        )}
        {catErr && <p className="mt-2 text-sm text-red-500" role="alert">{catErr}</p>}
        <button type="button" disabled={busy} onClick={() => { setCatDel(null); setCatOpen(false); }} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
      </Modal>

      {/* 확인 창 */}
      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)}>
        <h2 className="text-lg font-bold">재고 업로드</h2>
        <p className="mt-1 text-sm text-zinc-500">엑셀로 실사한 재고를 한 번에 반영해요. 먼저 양식을 받아 작성한 뒤 올려 주세요.</p>
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="text-sm font-bold">① 양식 받기</div>
            <p className="mt-1 text-xs text-zinc-500">지금 소모품 {products.length}개가 공정_카테고리 시트별로 들어 있고, 재고 열에 현재 수량이 채워져 있어요. 재고 열만 실사 수량으로 고쳐 주세요.</p>
            <button type="button" onClick={downloadStockTemplate} className="mt-2 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-bold text-white">양식 받기 (.xlsx)</button>
          </div>
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="text-sm font-bold">② 작성한 파일 올리기</div>
            <p className="mt-1 text-xs text-zinc-500">자재번호와 열 제목은 바꾸지 마세요. 올리면 바뀌는 내용을 먼저 보여 드려요.</p>
            <label className="mt-2 block cursor-pointer rounded-lg bg-blue-600 py-2.5 text-center text-sm font-bold text-white">
              파일 선택 (.xlsx)
              <input type="file" accept=".xlsx" className="hidden" onChange={e => { void onStockFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        </div>
        <button type="button" onClick={() => setUploadOpen(false)} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
      </Modal>

      <Modal open={exportOpen} onClose={() => !exporting && setExportOpen(false)}>
        <h2 className="text-lg font-bold">엑셀 내보내기</h2>
        <p className="mt-1 text-sm text-zinc-500">지금 화면의 목록 {list.length}개를 카테고리별 시트로 내보내요.</p>
        <div className="mt-4 space-y-2">
          <button type="button" disabled={exporting} onClick={() => void exportExcel(false)} className="block w-full rounded-xl border border-black/10 px-4 py-3 text-left hover:border-blue-500 disabled:opacity-50 dark:border-white/10">
            <b>일반 리스트</b>
            <span className="block text-xs text-zinc-500">글자만 · 빠르고 파일이 작아요. 재고를 고쳐 다시 올리기 좋아요.</span>
          </button>
          <button type="button" disabled={exporting} onClick={() => void exportExcel(true)} className="block w-full rounded-xl border border-black/10 px-4 py-3 text-left hover:border-blue-500 disabled:opacity-50 dark:border-white/10">
            <b>{exporting ? "사진을 불러와 만드는 중…" : "사진 포함 리스트"}</b>
            <span className="block text-xs text-zinc-500">각 품목 사진이 함께 들어가요. 품목이 많으면 시간이 걸리고 파일이 커져요.</span>
          </button>
        </div>
        <button type="button" disabled={exporting} onClick={() => setExportOpen(false)} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
      </Modal>

      <Modal open={stockUp !== null} onClose={() => !busy && setStockUp(null)}>
        {stockUp && (
          <>
            <h2 className="text-lg font-bold">엑셀 재고를 반영할까요?</h2>
            <p className="mt-2 text-sm text-zinc-500">
              바뀌는 품목 <b>{stockUp.changes.length}개</b>
              {stockUp.same > 0 && <> · 같은 수량 {stockUp.same}개</>}
              {stockUp.unknown > 0 && <> · 없는 자재번호 {stockUp.unknown}개(건너뜀)</>}
              {stockUp.bad > 0 && <> · 수량 오류 {stockUp.bad}개(건너뜀)</>}
            </p>
            {stockUp.changes.length > 0 && (
              <div className="mt-3 max-h-[40vh] space-y-1 overflow-y-auto pr-1 text-sm">
                {stockUp.changes.map(c => (
                  <div key={c.key} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-1.5 dark:bg-zinc-800/60">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-zinc-500">{c.from} → <b className="text-blue-600 dark:text-blue-300">{c.to}</b></span>
                  </div>
                ))}
              </div>
            )}
            {modalErr && <p className="mt-3 text-sm text-red-500" role="alert">{modalErr}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setStockUp(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy || stockUp.changes.length === 0} onClick={() => void applyStockUp()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "반영 중…" : "반영하기"}</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)}>
        {confirm && (
          <>
            <h2 className="text-lg font-bold">
              {confirm.mode === "purge" ? `${confirm.keys.length}개를 영구 삭제할까요?` : `${confirm.keys.length}개를 ${confirm.mode === "delete" ? "삭제" : "복원"}할까요?`}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {confirm.mode === "delete"
                ? "삭제한 자재는 설문 화면에서 사라져요. 영구 삭제가 아니라 휴지통으로 이동하며, 언제든 복원할 수 있어요."
                : confirm.mode === "restore"
                  ? "복원한 자재는 설문 화면에 다시 나타나요."
                  : "자재 정보와 이미지 파일이 완전히 지워져요. 이 작업은 되돌릴 수 없어요."}
            </p>
            {confirm.mode === "purge" && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 dark:bg-red-500/15 dark:text-red-300">복원할 수 없어요. 정말 지울까요?</p>
            )}
            {modalErr && <p className="mt-3 text-sm text-red-500" role="alert">{modalErr}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button type="button" disabled={busy} onClick={doConfirm} className={`flex-1 rounded-xl py-3 font-bold text-white disabled:opacity-50 ${confirm.mode === "restore" ? "bg-emerald-600" : "bg-red-600"}`}>
                {busy ? "처리 중…" : confirm.mode === "delete" ? "삭제" : confirm.mode === "restore" ? "복원" : "영구 삭제"}
              </motion.button>
            </div>
          </>
        )}
      </Modal>

      {/* 재고 수량을 여러 카드에 입력해 두었을 때: 한 번에 저장 */}
      {canEdit && Object.keys(drafts).length > 0 && (
        <div className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-md items-center gap-2 rounded-2xl bg-zinc-900 p-2.5 pl-4 text-sm text-white shadow-2xl dark:bg-zinc-100 dark:text-zinc-900" role="region" aria-label="재고 수정 저장">
          <span className="mr-auto font-bold">재고 {Object.keys(drafts).length}개 수정 중</span>
          <button type="button" disabled={busy} onClick={() => setDrafts({})} className="rounded-xl px-3 py-2 font-bold opacity-80 hover:opacity-100 disabled:opacity-40">모두 취소</button>
          <button type="button" disabled={busy} onClick={() => void saveAllDrafts()} className="rounded-xl bg-blue-600 px-4 py-2 font-extrabold text-white disabled:opacity-50">{busy ? "저장 중…" : "전체 저장"}</button>
        </div>
      )}

      {/* 알림 (실행 취소) */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
            role="status"
          >
            <span>{toast.text}</span>
            {toast.undo && <button type="button" onClick={() => undo(toast.undo!)} className="font-bold text-blue-300 dark:text-blue-600">실행 취소</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
