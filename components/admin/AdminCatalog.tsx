"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Product, TrashedProduct } from "@/lib/types";
import { Modal } from "@/components/Sheet";

const PAGE = 120;
const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";

type Mode = "delete" | "restore";
type Confirm = { mode: Mode | "purge"; keys: string[] } | null;
type Toast = { id: number; text: string; undo?: { mode: Mode; keys: string[] } } | null;

function ProductCard({
  p, selected, onSelect, onAction, onMove, onRename, onShift, shiftable, trashMode, canDelete, canEdit,
}: {
  p: Product | TrashedProduct;
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
  const canSelect = canDelete || canEdit;
  const deletedAt = "deletedAt" in p ? p.deletedAt : null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={`relative overflow-hidden rounded-2xl border-2 bg-white dark:bg-zinc-900 ${
        selected ? "border-blue-600 ring-2 ring-blue-600/30" : "border-black/10 dark:border-white/10"
      }`}
    >
      <button type="button" onClick={() => canSelect && onSelect(p.key)} aria-label={selected ? "선택 해제" : "선택"} aria-pressed={selected} className="block w-full text-left">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
        ) : (
          <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-800" />
        )}
      </button>
      <motion.span
        initial={false}
        animate={{ scale: selected ? 1 : 0.9, backgroundColor: selected ? "#2563eb" : "rgba(0,0,0,0.35)" }}
        className={"pointer-events-none absolute left-2 top-2 h-6 w-6 items-center justify-center rounded-full text-sm text-white " + (canSelect ? "flex" : "hidden")}
      >
        ✓
      </motion.span>
      {p.soldout && <span className="pointer-events-none absolute left-2 top-10 rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] text-white">품절</span>}
      <div className="p-3">
        <div className="line-clamp-3 min-h-[3.6em] text-[13px] leading-snug break-keep">{p.name}</div>
        {deletedAt && (
          <div className="mt-1.5 text-[11px] text-zinc-500">
            삭제 <time suppressHydrationWarning dateTime={deletedAt}>{new Date(deletedAt).toLocaleString("ko-KR")}</time>
          </div>
        )}
        {((trashMode && canDelete) || (!trashMode && (canDelete || canEdit))) && (
        <div className="mt-2.5 flex items-center gap-2">
          {trashMode ? (
            <div className="ml-auto flex gap-1.5">
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                onClick={() => onAction(p.key, "restore")}
                className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
              >
                복원
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.92 }}
                type="button"
                onClick={() => onAction(p.key, "purge")}
                className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300"
              >
                영구 삭제
              </motion.button>
            </div>
          ) : (
            <div className="ml-auto flex gap-1.5">
              {shiftable && (
                <>
                  <motion.button whileTap={{ scale: 0.92 }} type="button" aria-label="앞으로" disabled={!shiftable.prev} onClick={() => onShift(p.key, -1)} className="rounded-lg bg-zinc-100 px-2 py-1.5 text-[12px] font-bold disabled:opacity-30 dark:bg-zinc-800">◀</motion.button>
                  <motion.button whileTap={{ scale: 0.92 }} type="button" aria-label="뒤로" disabled={!shiftable.next} onClick={() => onShift(p.key, 1)} className="rounded-lg bg-zinc-100 px-2 py-1.5 text-[12px] font-bold disabled:opacity-30 dark:bg-zinc-800">▶</motion.button>
                </>
              )}
              {canEdit && (
                <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={() => onRename(p)} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[12px] font-bold dark:bg-zinc-800">
                  이름
                </motion.button>
              )}
              {canEdit && (
                <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={() => onMove(p.key)} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-[12px] font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                  이동
                </motion.button>
              )}
              {canDelete && (
                <motion.button whileTap={{ scale: 0.92 }} type="button" onClick={() => onAction(p.key, "delete")} className="rounded-lg bg-red-50 px-3 py-1.5 text-[12px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">
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
  initialProducts, initialTrash, trades: initialTrades, responseCount, categories, categoryTrades, canRegister, canEdit, canDelete,
}: {
  initialProducts: Product[];
  initialTrash: TrashedProduct[];
  trades: string[];
  responseCount: number;
  categories: string[]; // 카테고리 이름 목록(비어 있는 카테고리 포함)
  categoryTrades: Record<string, string>; // 카테고리 → 묶어 보여 줄 공정 (빈 값 = 미지정)
  canRegister: boolean; // 카테고리 등록
  canEdit: boolean; // 카테고리 이름 수정 · 소모품의 카테고리 이동
  canDelete: boolean; // 소모품의 "삭제" 권한 (없으면 보기 전용)
}) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [trash, setTrash] = useState(initialTrash);
  const [view, setView] = useState<"catalog" | "trash">("catalog");
  const [cat, setCat] = useState("전체");
  const [sub, setSub] = useState("");
  const [trade, setTrade] = useState("전체");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("no");
  const [shown, setShown] = useState(PAGE);
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
  const [newCat, setNewCat] = useState("");
  const [renaming, setRenaming] = useState<{ name: string; to: string } | null>(null);
  const [catErr, setCatErr] = useState("");
  const [catDel, setCatDel] = useState<string | null>(null); // 삭제 확인 중인 카테고리
  const [renameP, setRenameP] = useState<{ key: string; name: string } | null>(null); // 소모품 이름 변경 창
  const [renameErr, setRenameErr] = useState("");
  const canSelect = canDelete || canEdit;
  const canManageCats = canRegister || canEdit || canDelete;

  const trashMode = view === "trash";
  const base: (Product | TrashedProduct)[] = trashMode ? trash : products;

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
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const r = byCat.filter(
      p =>
        (!activeSub || p.sub === activeSub) &&
        (!kw || `${p.name} ${p.brand} ${p.sub}`.toLowerCase().includes(kw)),
    );
    if (sort === "nm") return [...r].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return r;
  }, [byCat, activeSub, q, sort]); // 공정 필터는 카테고리 단위(cats)로 이미 적용돼 있다

  const visible = list.slice(0, shown);
  const selCount = selected.size;

  // 필터를 바꾸면 선택을 비운다 (안 보이는 자재가 같이 지워지는 사고 방지)
  const resetSel = () => setSelected(new Set());
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setShown(PAGE); resetSel(); };

  function toggleSel(k: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  const selectAllShown = () => setSelected(new Set(list.map(p => p.key)));

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
    const name = newTrade.trim().replace(/s+/g, " ");
    if (!name || busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callTrade({ action: "add", name });
      if (r.ok) { setTrades(l => [...l, name]); setNewTrade(""); } else setCatErr(r.error ?? "");
    } catch { setCatErr("서버에 연결할 수 없어요."); }
    setBusy(false);
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
  async function setTradeOf(name: string, trade: string) {
    if (busy) return;
    setBusy(true); setCatErr("");
    try {
      const r = await callCat({ action: "settrade", name, trade });
      if (r.ok) setCatTrades(m => ({ ...m, [name]: trade })); else setCatErr(r.error ?? "");
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
        const re = <T extends { category: string }>(rows: T[]) => rows.map(p => (p.category === name ? { ...p, category: next } : p));
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
  async function doRenameProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!renameP || busy) return;
    const { key } = renameP;
    const name = renameP.name.trim().replace(/\s+/g, " ");
    if (!name) { setRenameErr("이름을 적어 주세요."); return; }
    setBusy(true); setRenameErr("");
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rename", key, name }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "이름을 바꾸지 못했어요.");
      const re = <T extends { key: string; name: string }>(rows: T[]) => rows.map(p => (p.key === key ? { ...p, name } : p));
      setProducts(re); setTrash(re);
      setToast({ id: Date.now(), text: "이름을 바꿨어요" });
      setRenameP(null);
    } catch (err) { setRenameErr(err instanceof Error ? err.message : "이름을 바꾸지 못했어요."); }
    setBusy(false);
  }
  async function doMove(category: string) {
    if (!moveKeys || busy) return;
    const keys = moveKeys;
    setBusy(true); setMoveErr("");
    try {
      const r = await fetch("/api/admin/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "move", keys, category }) });
      if (r.status === 401) { router.replace("/"); return; }
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "옮기지 못했어요.");
      const set = new Set(keys);
      const mv = <T extends { key: string; category: string; sub: string }>(rows: T[]) => rows.map(p => (set.has(p.key) ? { ...p, category, sub: "" } : p));
      setProducts(mv); setTrash(mv);
      setSelected(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
      setToast({ id: Date.now(), text: keys.length + "개를 “" + category + "”(으)로 옮겼어요" });
      setMoveKeys(null);
    } catch (e) { setMoveErr(e instanceof Error ? e.message : "옮기지 못했어요."); }
    setBusy(false);
  }

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
    setView(v); setCat("전체"); setSub(""); setTrade("전체"); setQ(""); setShown(PAGE); resetSel();
  }

  // 토스트는 6초 뒤 자동으로 사라진다
  const toastKey = toast?.id;
  useEffect(() => {
    if (toastKey == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastKey ? null : cur)), 6000);
    return () => window.clearTimeout(t);
  }, [toastKey]);

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-32">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">소모품</h1>
        <span className="text-sm text-zinc-500">설문 응답 {responseCount}건</span>
      </header>

      {!canDelete && !canEdit && !canRegister && (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <b>보기 전용</b>이에요. 자재를 삭제하려면 최고 관리자나 개발팀에 이 메뉴의 <b>등록·수정·삭제</b> 권한을 요청해 주세요.
        </p>
      )}

      <div className="flex gap-2">
        {([["catalog", `소모품 ${products.length}`], ["trash", `휴지통 ${trash.length}`]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => switchView(v)} className={`relative rounded-xl px-4 py-2.5 text-sm font-bold ${view === v ? "text-white" : "bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {view === v && <motion.span layoutId="viewTab" className="absolute inset-0 rounded-xl bg-blue-600" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <div className="sticky top-0 z-20 -mx-4 mt-3 space-y-2 border-b border-black/10 bg-background/95 px-4 py-3 backdrop-blur dark:border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={e => filter(setQ)(e.target.value)}
            placeholder="자재명·브랜드 검색"
            className="w-56 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
          />
          <select value={trade} onChange={e => filter(setTrade)(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="전체">공정: 전체</option>
            {trades.map(t => <option key={t} value={t}>공정: {t}</option>)}
            <option value="미배정">공정: 미배정</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="no">기본 순서</option>
            <option value="nm">이름순</option>
          </select>
          {canDelete && trashMode && trash.length > 0 && (
            <button
              type="button"
              onClick={() => { setModalErr(""); setConfirm({ mode: "purge", keys: trash.map(p => p.key) }); }}
              className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300"
            >
              휴지통 비우기 ({trash.length})
            </button>
          )}
          {canManageCats && !trashMode && (
            <button type="button" onClick={() => { setCatErr(""); setRenaming(null); setCatOpen(true); }} className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
              카테고리 관리
            </button>
          )}
          <span className="ml-auto text-sm text-zinc-500">{list.length}개</span>
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {["전체", ...[...cats.keys()].sort((a, b) => Number(a === "공통 소모품") - Number(b === "공통 소모품"))].map(c => (
            <button key={c} type="button" onClick={() => { setCat(c); setSub(""); setShown(PAGE); resetSel(); }} className={`${chipBase} text-[13px] ${activeCat === c ? chipOn : chipOff}`}>
              {c}<small className="ml-1 opacity-70">{c === "전체" ? [...cats.values()].reduce((a, n) => a + n, 0) : cats.get(c)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <AnimatePresence mode="popLayout">
          {visible.map(p => (
            <ProductCard
              key={p.key}
              canDelete={canDelete}
              canEdit={canEdit}
              onMove={k => { setMoveErr(""); setMoveKeys([k]); }}
              onRename={x => { setRenameErr(""); setRenameP({ key: x.key, name: x.name }); }}
              onShift={shiftProduct}
              shiftable={canEdit && !trashMode && sort === "no" ? { prev: list[0]?.key !== p.key, next: list[list.length - 1]?.key !== p.key } : null}
              p={p}
              selected={selected.has(p.key)}
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
      {list.length > shown && (
        <div className="py-6 text-center">
          <button type="button" onClick={() => setShown(s => s + PAGE)} className="rounded-xl bg-blue-50 px-5 py-3 font-bold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
            더 보기 ({list.length - shown}개 남음)
          </button>
        </div>
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
            {canEdit && !trashMode && (
              <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => { setMoveErr(""); setMoveKeys([...selected]); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
                카테고리 이동
              </motion.button>
            )}
            {canDelete && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                type="button"
                onClick={() => { setModalErr(""); setConfirm({ mode: trashMode ? "restore" : "delete", keys: [...selected] }); }}
                className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${trashMode ? "bg-emerald-600" : "bg-red-600"}`}
              >
                {trashMode ? "복원" : "삭제"}
              </motion.button>
            )}
            {trashMode && canDelete && (
              <motion.button
                whileTap={{ scale: 0.95 }}
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

      {/* 소모품 이름 변경 */}
      <Modal open={renameP !== null} onClose={() => !busy && setRenameP(null)}>
        {renameP && (
          <form onSubmit={doRenameProduct}>
            <h2 className="text-lg font-bold">소모품 이름 변경</h2>
            <input autoFocus value={renameP.name} maxLength={100} onChange={e => setRenameP({ key: renameP.key, name: e.target.value })} aria-label="소모품 이름" className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            {renameErr && <p className="mt-2 text-sm text-red-500" role="alert">{renameErr}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setRenameP(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button whileTap={{ scale: 0.97 }} disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "저장"}</motion.button>
            </div>
          </form>
        )}
      </Modal>

      {/* 카테고리 이동: 목록이 길어도 스크롤된다 */}
      <Modal open={moveKeys !== null} onClose={() => !busy && setMoveKeys(null)}>
        {moveKeys && (
          <>
            <h2 className="text-lg font-bold">{moveKeys.length}개를 어느 카테고리로 옮길까요?</h2>
            <div className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
              {catList.map(c => (
                <button key={c} type="button" disabled={busy} onClick={() => doMove(c)} className="flex w-full items-center rounded-xl border border-black/10 px-4 py-3 text-left text-[15px] hover:border-blue-500 disabled:opacity-50 dark:border-white/10">
                  {c}
                  <small className="ml-auto text-zinc-500">{products.filter(p => p.category === c).length}개</small>
                </button>
              ))}
              {catList.length === 0 && <p className="py-4 text-center text-sm text-zinc-500">카테고리가 없어요. 먼저 카테고리를 만들어 주세요.</p>}
            </div>
            {moveErr && <p className="mt-3 text-sm text-red-500" role="alert">{moveErr}</p>}
            <button type="button" disabled={busy} onClick={() => setMoveKeys(null)} className="mt-4 w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          </>
        )}
      </Modal>

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
                      <div key={c} className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/10">
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
                            <span className="min-w-0 flex-1 truncate text-[15px]">{c}</span>
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
        {(canRegister || canDelete) && (
          <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
            <div className="text-xs font-bold text-blue-600 dark:text-blue-300">공정 관리 <small className="font-normal text-zinc-500">{trades.length}</small></div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {trades.map(t => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-black/10 py-1 pl-3 pr-1.5 text-sm dark:border-white/10">
                  {t}
                  {canDelete && <button type="button" aria-label={t + " 공정 삭제"} disabled={busy} onClick={() => { setCatErr(""); setTradeDel(t); }} className="rounded-full px-1.5 text-zinc-500 hover:text-red-600 disabled:opacity-35">×</button>}
                </span>
              ))}
              {trades.length === 0 && <span className="text-sm text-zinc-500">공정이 없어요.</span>}
            </div>
            {canRegister && (
              <form onSubmit={addTradeName} className="mt-2 flex gap-2">
                <input value={newTrade} maxLength={10} onChange={e => setNewTrade(e.target.value)} placeholder="새 공정 이름" aria-label="새 공정 이름" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
                <motion.button whileTap={{ scale: 0.96 }} disabled={busy || !newTrade.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">+ 공정 등록</motion.button>
              </form>
            )}
            {tradeDel !== null && (
              <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm dark:bg-red-500/10" role="alertdialog">
                <p className="font-semibold text-red-700 dark:text-red-300">“{tradeDel}” 공정을 삭제할까요?</p>
                <p className="mt-1 text-red-700/80 dark:text-red-200/80">소모품과 회원에 걸린 이 공정, 카테고리의 공정 지정이 모두 빠져요. 소모품은 지워지지 않아요. 이미 낸 설문 응답은 그대로 남아요.</p>
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
            <motion.button whileTap={{ scale: 0.96 }} disabled={busy || !newCat.trim()} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">+ 등록</motion.button>
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
              <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy} onClick={doConfirm} className={`flex-1 rounded-xl py-3 font-bold text-white disabled:opacity-50 ${confirm.mode === "restore" ? "bg-emerald-600" : "bg-red-600"}`}>
                {busy ? "처리 중…" : confirm.mode === "delete" ? "삭제" : confirm.mode === "restore" ? "복원" : "영구 삭제"}
              </motion.button>
            </div>
          </>
        )}
      </Modal>

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
