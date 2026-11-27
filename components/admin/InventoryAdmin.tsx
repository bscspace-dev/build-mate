"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/components/admin/AddProduct";
import { Modal } from "@/components/Sheet";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-export";
import { readXlsx } from "@/lib/xlsx-import";
import { normTags } from "@/lib/tags";
import type { InventoryEntry } from "@/lib/types";

type Prod = { key: string; kind: "상비품" | "자재" | "연장"; stock: number; price: number; image: string; link: string; brand: string; model: string; battery: string; voltage: string; compat: string; tags: string[]; trade: string; category: string; name: string; copyOf?: string };
type KindTab = "상비품" | "자재" | "연장";
const KIND_KEY = "bm_inventory_kind"; // 마지막으로 본 종류 (이 브라우저에 기억)

const PICK_KEY = "bm_inventory_pick";
const PAGE = 20; // 한 쪽에 보여 줄 품목 수
const ORDER_KEY = "bm_inventory_order"; // 나열 순서 선택 (이 브라우저에 기억)
const FRESH_MS = 14 * 24 * 60 * 60 * 1000; // 신규로 보는 기간 (14일): 이 안에 추가한 품목은 맨 위에 모아 보여 준다
const BASE = "border border-black/10 px-2.5 dark:border-white/10";
// 행 간격(칸 위아래 여백): 좁게 / 보통 / 넓게
const PADS = { tight: "py-0.5", normal: "py-1.5", wide: "py-3.5" } as const;
type Density = keyof typeof PADS;
const DENSITY_KEY = "bm_row_density";
const inp = "w-full rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15";
const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);

// 장비조사: 창고현황의 상비품이 공정(대분류)별로 엑셀처럼 목록으로 먼저 채워져 있다. 할 수 있는 일은 추가와 삭제뿐이다.
//  · 필요 없는 상비품 삭제 → 창고현황의 휴지통으로 간다(거기서 복원할 수 있다).
//  · 필요한 상비품 추가 → 고른 공정·카테고리로 창고현황에도 같이 등록된다.
//  · 추가·삭제한 사람과 시각이 남는다. 최고 관리자·개발팀은 모든 공정을 보고, 팀마다 맡을 공정을 정한다.
export default function InventoryAdmin({ trades, categories, products, log, admin, stars }: { trades: string[]; categories: Record<string, string[]>; products: Prod[]; log: InventoryEntry[]; admin: boolean; stars: string[]; }) {
  const router = useRouter();
  const [checked, setChecked] = useState<string[]>([]); // 삭제하려고 체크한 품목
  const [kindTab, setKindTab] = useState<KindTab>("상비품"); // 장비조사의 종류 탭: 상비품 / 자재
  useEffect(() => { try { const v = localStorage.getItem(KIND_KEY); if (v === "상비품" || v === "자재" || v === "연장") setKindTab(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const [holdTab, setHoldTab] = useState<"all" | "own" | "none">("all"); // 보유(재고 1개 이상) / 미보유(재고 0) 구분
  useEffect(() => { try { const v = localStorage.getItem("bm_inventory_hold"); if (v === "all" || v === "own" || v === "none") setHoldTab(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickHold = (h: "all" | "own" | "none") => { setHoldTab(h); setChecked([]); try { localStorage.setItem("bm_inventory_hold", h); } catch { /* 저장이 막힌 환경 */ } };
  const pickKind = (k: KindTab) => {
    setKindTab(k); setChecked([]);
    // 지금 고른 카테고리에 이 종류의 품목이 없으면, 품목이 있는 카테고리로 옮긴다
    const has = (c: string) => items.some(i => i.kind === k && (!sel || i.trade === sel) && i.category === c);
    if (k !== "연장" && sel && catSel && !has(catSel)) { const next = (categories[sel] ?? []).find(has); if (next) setCatSel(next); }
    try { localStorage.setItem(KIND_KEY, k); } catch { /* 저장이 막힌 환경 */ } };
  // 열 제목을 눌러 정렬: 한 번 = 오름차순, 두 번 = 내림차순, 세 번 = 해제. 정렬 중에는 신규·카테고리 묶음을 풀고 한 줄로 늘어놓는다.
  type SortKey = "trade" | "category" | "name" | "by" | "added";
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  // 나열 순서 옵션: 기본(신규 위·카테고리별) / 이름 / 공정 / 카테고리 / 추가한 시각 — 열 제목을 눌러도 같은 값이 바뀐다
  const ORDERS: { v: string; label: string; sort: { key: SortKey; dir: 1 | -1 } | null }[] = [
    { v: "default", label: "기본 (신규 위 · 카테고리별)", sort: null },
    { v: "added:-1", label: "최근 추가한 순", sort: { key: "added", dir: -1 } },
    { v: "added:1", label: "오래전 추가한 순", sort: { key: "added", dir: 1 } },
    { v: "name:1", label: "품목 이름 가나다순", sort: { key: "name", dir: 1 } },
    { v: "name:-1", label: "품목 이름 가나다 역순", sort: { key: "name", dir: -1 } },
    { v: "category:1", label: "카테고리 가나다순", sort: { key: "category", dir: 1 } },
    { v: "trade:1", label: "공정 가나다순", sort: { key: "trade", dir: 1 } },
    { v: "by:1", label: "추가한 사람순", sort: { key: "by", dir: 1 } },
  ];
  const orderValue = sort ? `${sort.key}:${sort.dir}` : "default";
  const pickOrder = (v: string) => setSort(ORDERS.find(o => o.v === v)?.sort ?? null);
  useEffect(() => { try { const v = localStorage.getItem(ORDER_KEY); const o = ORDERS.find(x => x.v === v); if (o) setSort(o.sort); } catch { /* 저장이 막힌 환경 */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(ORDER_KEY, orderValue); } catch { /* 저장이 막힌 환경 */ } }, [orderValue]);
  const clickSort = (key: SortKey) => setSort(s0 => (!s0 || s0.key !== key ? { key, dir: 1 } : s0.dir === 1 ? { key, dir: -1 } : null));
  // 연장은 공정만으로 구분한다: 카테고리를 비워서 목록·묶음에 카테고리가 나오지 않게 한다
  const flatten = (list: Prod[]) => list.map(p => (p.kind === "연장" ? { ...p, category: "" } : p));
  const [items, setItems] = useState(() => flatten(products)); // 화면에 보이는 목록 (추가·수정·삭제하면 서버 응답 즉시 반영, 이후 서버 값으로 다시 맞춘다)
  useEffect(() => setItems(flatten(products)), [products]); // eslint-disable-line react-hooks/exhaustive-deps
  const [density, setDensity] = useState<Density>("normal");
  useEffect(() => { try { const v = localStorage.getItem(DENSITY_KEY); if (v === "tight" || v === "normal" || v === "wide") setDensity(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickDensity = (d: Density) => { setDensity(d); try { localStorage.setItem(DENSITY_KEY, d); } catch { /* 저장이 막힌 환경 */ } };
  const cell = `${BASE} ${PADS[density]}`;
  const [sel, setSel] = useState(trades[0] ?? ""); // 고른 공정 (처음 열 때 기억해 둔 공정이 없으면 맨 처음 공정): 목록도 그 공정의 품목만 보이고, 추가할 때도 이 공정에 들어간다
  const firstCat = (t: string) => categories[t]?.[0] ?? ""; // 공정의 첫 카테고리 (창고현황 순서)
  const [catSel, setCatSel] = useState(() => firstCat(sel)); // 고른 카테고리: 목록도 그 카테고리만 보이고, 추가할 때도 여기에 들어간다
  // 고른 공정·카테고리는 다른 것으로 바꿀 때까지 그대로 둔다 (품목을 추가·삭제해도, 새로고침해도 이 브라우저에 기억한다)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const t = localStorage.getItem(PICK_KEY + ".trade") ?? "", c = localStorage.getItem(PICK_KEY + ".cat") ?? "";
      if (trades.includes(t)) { setSel(t); setCatSel(c === "" || (categories[t] ?? []).includes(c) ? c : firstCat(t)); }
    } catch { /* 저장이 막힌 환경 */ }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(PICK_KEY + ".trade", sel); localStorage.setItem(PICK_KEY + ".cat", catSel); } catch { /* 저장이 막힌 환경 */ }
  }, [ready, sel, catSel]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function post(body: object): Promise<Record<string, unknown> | null> {
    if (busy) return null;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      return j;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "서버에 연결할 수 없어요.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  // 가격·사진: 추가할 때 함께 적고(가격) 고르고(사진), 수정할 때 바꾼다. 사진은 줄여서(webp) 올린다.
  const [newPrice, setNewPrice] = useState("");
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newLink, setNewLink] = useState("");
  const [newBrand, setNewBrand] = useState(""); // 연장 브랜드·제품명
  const [newModel, setNewModel] = useState("");
  const [newTags, setNewTags] = useState(""); // 연장 태그 (쉼표로 구분)
  const [editTags, setEditTags] = useState("");
  const [setMsg, setSetMsg] = useState("");
  const [toolQ, setToolQ] = useState(""); // 검색어: 연장은 품목·브랜드·제품명·전압·배터리·호환성·태그, 상비품·자재는 품목·카테고리·공정
  const [tagSel, setTagSel] = useState(""); // 태그로 묶어 보기 (빈 값 = 전체)
  const tagChips = (p: Prod) => p.tags.length > 0 ? (
    <div className="mt-0.5 flex flex-wrap gap-1">
      {p.tags.map(t => <button key={t} type="button" onClick={e => { e.stopPropagation(); setTagSel(x => (x === t ? "" : t)); }} title="이 태그로 묶어 보기" className={`rounded-full px-1.5 py-0 text-[11px] font-bold ${tagSel === t ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200"}`}>#{t}</button>)}
    </div>
  ) : null;
  const [newCompat, setNewCompat] = useState(""); // 연장 호환성 (자유 입력)
  const [editCompat, setEditCompat] = useState("");
  const [newVoltage, setNewVoltage] = useState(""); // 연장 전압 (자유 입력, 예: 18V)
  const [editVoltage, setEditVoltage] = useState("");
  const voltageList = (
    <datalist id="voltage-list"><option value="12V" /><option value="14.4V" /><option value="18V" /><option value="20V" /><option value="21V" /><option value="36V" /><option value="220V" /></datalist>
  );
  const [newBattery, setNewBattery] = useState(""); // 연장 배터리 포함 여부 ("" | 포함 | 미포함)
  const [editBattery, setEditBattery] = useState("");
  const batteryBadge = (v: string) => v ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${v === "포함" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"}`}>{v}</span> : <span className="text-zinc-300">—</span>;
  const batterySelect = (v: string, set: (x: string) => void, label: string, extra = "") => (
    <select value={v} onChange={e => set(e.target.value)} aria-label={label} className={`${inp} ${extra}`}>
      <option value="">배터리 선택</option><option value="포함">포함</option><option value="미포함">미포함</option>
    </select>
  );
  const [editBrand, setEditBrand] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editLink, setEditLink] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const priceNum = (v: string) => v.replace(/\D/g, "").slice(0, 9);
  const won = (n: number) => n.toLocaleString("ko-KR");
  // 이름·가격 칸을 누르면 그 칸이 바로 입력 상태가 된다 (수정 버튼과 같은 수정 모드)
  const [editFocus, setEditFocus] = useState<"name" | "price" | "link" | "brand" | "model" | "battery" | "voltage" | "compat" | "tags">("name");
  // 사진 미리보기: 목록의 사진(썸네일)에 마우스를 올리면 커서 왼쪽에 작은 사진을 띄운다 (수정 중에는 띄우지 않는다)
  const [peek, setPeek] = useState<{ src: string; x: number; y: number } | null>(null);
  const peekProps = (p: Prod) => p.image && editKey !== p.key ? {
    onMouseEnter: (e: React.MouseEvent) => setPeek({ src: p.image, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setPeek({ src: p.image, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPeek(null),
  } : {};
  const [editing, setEditing] = useState(false);
  // 즐겨찾기(별표): 계정마다 따로 저장되어 나에게만 적용되고, 별표한 품목은 목록 맨 위에 모아서 보여 준다
  const [starKeys, setStarKeys] = useState<string[]>(stars);
  useEffect(() => setStarKeys(stars), [stars]);
  const starSet = new Set(starKeys);
  async function toggleStar(key: string) {
    const on = !starSet.has(key);
    setStarKeys(k => (on ? [...k, key] : k.filter(x => x !== key)));
    try {
      const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "star", keys: [key], on }) });
      if (!r.ok) throw new Error();
    } catch {
      setStarKeys(k => (on ? k.filter(x => x !== key) : [...k, key])); // 저장하지 못하면 되돌린다
      setErr("즐겨찾기를 저장하지 못했어요.");
    }
  }
  const starBtn = (p: Prod) => (
    <button type="button" onClick={() => void toggleStar(p.key)} aria-pressed={starSet.has(p.key)} aria-label={`${p.name} 즐겨찾기 ${starSet.has(p.key) ? "해제" : "등록"}`} title="즐겨찾기 (나에게만 적용돼요)" className={`shrink-0 cursor-pointer text-lg leading-none ${starSet.has(p.key) ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}>{starSet.has(p.key) ? "★" : "☆"}</button>
  );
  const [hl, setHl] = useState<string[]>([]); // 편집하기가 아닐 때 눌러서 강조해 둔 행들 (여러 개 가능)
  const CART_KEY = "bm_inventory_cart";
  const [cart, setCart] = useState<string[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(CART_KEY) ?? "[]"); if (Array.isArray(v)) setCart(v.filter((k): k is string => typeof k === "string")); } catch { /* 저장이 막힌 환경 */ } setCartReady(true); }, []);
  useEffect(() => { if (cartReady) try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* 저장이 막힌 환경 */ } }, [cartReady, cart]);
  const addToCart = () => { setCart(c => [...new Set([...c, ...hl])]); setHl([]); };
  const rowClick = (key: string) => (e: React.MouseEvent) => {
    if (editing || (e.target as HTMLElement).closest("a,button,input,select,label")) return;
    setHl(h => (h.includes(key) ? h.filter(k => k !== key) : [...h, key]));
  };
  const startEdit = (p: Prod, f: "name" | "price" | "link" | "brand" | "model" | "battery" | "voltage" | "compat" | "tags" = "name") => { if (!editing) return; setPeek(null); setEditTags(p.tags.join(", ")); setEditCompat(p.compat); setEditVoltage(p.voltage); setEditLink(p.link); setEditBrand(p.brand); setEditModel(p.model); setEditBattery(p.battery); setEditKey(p.key); setEditName(p.name); setEditPrice(p.price ? String(p.price) : ""); setEditPhoto(null); setEditFocus(f); };
  async function uploadPhoto(key: string, file: File): Promise<string | null> {
    try {
      const blob = await shrink(file);
      const fd = new FormData();
      fd.set("key", key);
      fd.set("photo", new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.jpg", { type: blob.type }));
      const r = await fetch("/api/admin/inventory/photo", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { error?: string; image?: string };
      if (!r.ok) throw new Error(j.error ?? "사진을 올리지 못했어요.");
      return typeof j.image === "string" ? j.image : null;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "사진을 올리지 못했어요.");
      return null;
    }
  }
  // 목록의 사진 칸을 누르면 이미지 찾기 창이 열린다. 고르면 수정 상태가 되고, 옆의 「저장」을 눌러야 올라간다 (「취소」로 되돌린다)
  function changePhoto(p: Prod, file: File | null) {
    if (!file) return;
    startEdit(p, "name");
    setEditPhoto(file);
  }
  const thumbPick = (p: Prod, size: string) => (
    <label className={`mx-auto flex ${size} items-center justify-center overflow-hidden rounded ${editing ? "cursor-pointer hover:ring-2 hover:ring-blue-500" : "cursor-default"}`} title={!editing ? "「편집하기」를 누르면 사진을 바꿀 수 있어요" : p.image ? "눌러서 사진 바꾸기" : "눌러서 사진 찾기"} {...peekProps(p)}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" loading="lazy" className="h-full w-full bg-white object-contain" />
      ) : <span className="text-base text-zinc-400" aria-hidden>📷</span>}
      <input type="file" accept="image/*" disabled={!editing} className="sr-only" aria-label={`${p.name} 사진 ${p.image ? "바꾸기" : "찾기"}`} onChange={e => { changePhoto(p, e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </label>
  );
  const photoPicker = (file: File | null, set: (f: File | null) => void, label: string) => (
    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-black/15 px-2 py-1 text-xs font-bold text-zinc-600 hover:bg-white dark:border-white/15 dark:text-zinc-300" title={file ? file.name : "사진 고르기"}>
      <span aria-hidden>{file ? "✅" : "📷"}</span><span>{file ? "선택됨" : label}</span>
      <input type="file" accept="image/*" className="sr-only" onChange={e => { set(e.target.files?.[0] ?? null); setErr(""); e.target.value = ""; }} />
    </label>
  );
  async function add() {
    if (!sel) return setErr("공정을 골라 주세요.");
    const flat = kindTab === "연장"; // 연장은 카테고리 구분이 없다 (공정의 첫 카테고리에 등록해 두고 화면에는 보이지 않는다)
    const category = flat ? firstCat(sel) : catSel;
    if (!category) return setErr(flat ? "이 공정에는 카테고리가 없어서 연장을 추가할 수 없어요. 창고현황에서 카테고리를 먼저 만들어 주세요." : "카테고리를 골라 주세요.");
    if (!name.trim()) return setErr("품목 이름을 적어 주세요.");
    const j = await post({ action: "add", trade: sel, category, name, kind: kindTab, price: Number(newPrice || 0), ...(flat ? { brand: newBrand.trim(), model: newModel.trim(), battery: newBattery, voltage: newVoltage.trim(), compat: newCompat.trim(), tags: normTags(newTags) } : {}) });
    if (j) {
      const newLinkUrl = newLink.trim();
      let linkSaved = "";
      if (typeof j.key === "string" && newLinkUrl) { const lj = await post({ action: "link", key: j.key, url: newLinkUrl }); if (lj && typeof lj.url === "string") linkSaved = lj.url; } // 링크는 등록된 품목에 이어서 저장한다
      let img = "";
      if (typeof j.key === "string" && newPhoto) img = (await uploadPhoto(j.key, newPhoto)) ?? ""; // 사진은 등록된 품목에 이어서 올린다
      if (typeof j.key === "string") setAddedNow(x => ({ ...x, [j.key as string]: Date.now() }));
      if (typeof j.key === "string") setItems(x => [...x, { key: j.key as string, kind: kindTab, stock: 0, price: Number(newPrice || 0), image: img, link: linkSaved, brand: flat ? newBrand.trim() : "", model: flat ? newModel.trim() : "", battery: flat ? newBattery : "", voltage: flat ? newVoltage.trim() : "", compat: flat ? newCompat.trim() : "", tags: flat ? normTags(newTags) : [], trade: sel, category: flat ? "" : catSel, name: name.trim().replace(/\s+/g, " ") }]); // 새로고침을 기다리지 않고 바로 보여 준다
      setName(""); setNewPrice(""); setNewPhoto(null); setNewLink(""); setNewBrand(""); setNewModel(""); setNewBattery(""); setNewVoltage(""); setNewCompat(""); setNewTags("");
      router.refresh(); // 뒤에서 서버 값으로 맞춘다
    }
  }
  // 엑셀 일괄 등록: 「양식 받기」로 받은 시트를 채워 올리면 한 줄마다 품목이 추가된다 (직접 추가할 때와 같은 검사: 내 공정만, 같은 이름 중복 불가·연장은 허용).
  const importRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState("");
  const [importing, setImporting] = useState(false);
  const IMPORT_HEAD = ["종류", "공정", "카테고리", "품목", "가격(원)", "구매 링크", "브랜드", "제품명", "전압", "배터리", "호환성", "태그"];
  function downloadTemplate() {
    const t = sel || trades[0] || "";
    const c = categories[t]?.[0] ?? "";
    downloadBlob(buildXlsx([
      { name: "일괄등록", header: IMPORT_HEAD, widths: [9, 10, 14, 30, 12, 36, 12, 16, 8, 10, 18, 20], rows: [[kindTab, t, kindTab === "연장" ? "" : c, "(예시) 이 줄은 지우고 입력하세요", 10000, "https://", kindTab === "연장" ? "브랜드" : "", "", kindTab === "연장" ? "18V" : "", kindTab === "연장" ? "포함" : "", "", kindTab === "연장" ? "그라인더, 18V" : ""]] },
      { name: "공정·카테고리", header: ["공정", "카테고리"], widths: [14, 24], rows: trades.flatMap(tr => (categories[tr] ?? [""]).map(ca => [tr, ca])) },
      { name: "작성방법", header: ["안내"], widths: [90], rows: [["1. 「일괄등록」 시트에 한 줄에 품목 하나씩 적어요. 예시 줄은 지우세요."], ["2. 종류는 상비품 · 자재 · 연장 중 하나 (비우면 지금 보는 탭 종류)."], ["3. 공정·카테고리는 「공정·카테고리」 시트에 있는 이름 그대로 적어요. 내가 맡은 공정만 올릴 수 있어요."], ["4. 연장은 카테고리를 비워 두세요. 브랜드·제품명·전압·배터리(포함/미포함)·호환성·태그(쉼표로)는 연장만 써요."], ["5. 공정·품목 이름은 꼭 적어야 해요. 가격·구매 링크는 비워도 돼요."], ["6. 첫 줄(머리글)은 고치지 마세요. 채운 뒤 「엑셀로 일괄 등록」으로 올려요."]] },
    ]), `장비조사_양식_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}.xlsx`);
  }
  async function importSheet(file: File) {
    setImportMsg(""); setErr(""); setImporting(true);
    const call = async (body: object): Promise<{ ok: boolean; j: Record<string, unknown> }> => {
      try {
        const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: r.ok, j };
      } catch { return { ok: false, j: { error: "서버에 연결할 수 없어요." } }; }
    };
    try {
      const sheets = await readXlsx(file);
      const sh = sheets.find(s => s.name === "일괄등록") ?? sheets[0];
      const head = (sh?.rows[0] ?? []).map(h => String(h ?? "").trim());
      const col = (n: string) => head.findIndex(h => h.startsWith(n));
      const c = { kind: col("종류"), trade: col("공정"), cat: col("카테고리"), name: col("품목"), price: col("가격"), url: col("구매 링크"), brand: col("브랜드"), model: col("제품명"), volt: col("전압"), bat: col("배터리"), compat: col("호환성"), tags: col("태그") };
      if (c.trade < 0 || c.name < 0) return setErr("양식이 달라요. 「양식 받기」로 받은 파일을 써 주세요.");
      const sq = (r: string[], i: number) => (i < 0 ? "" : String(r[i] ?? "").trim().replace(/\s+/g, " "));
      let done = 0; const bad: string[] = [];
      for (const [i, r] of sh.rows.slice(1).entries()) {
        const nm = sq(r, c.name), tr = sq(r, c.trade);
        if (!nm && !tr) continue;
        const no = `${i + 2}줄 ${nm || "(품목 없음)"}`;
        if (nm.startsWith("(예시)")) continue;
        const kindIn = sq(r, c.kind) || kindTab;
        if (kindIn !== "상비품" && kindIn !== "자재" && kindIn !== "연장") { bad.push(`${no} — 종류는 상비품·자재·연장 중 하나`); continue; }
        if (!nm) { bad.push(`${no} — 품목 이름이 없어요`); continue; }
        if (!trades.includes(tr)) { bad.push(`${no} — 내가 맡은 공정이 아니에요 (${tr || "비어 있음"})`); continue; }
        const flat = kindIn === "연장";
        const cat = flat ? firstCat(tr) : sq(r, c.cat);
        if (!cat || !(categories[tr] ?? []).includes(cat)) { bad.push(`${no} — 카테고리를 확인해 주세요 (${sq(r, c.cat) || "비어 있음"})`); continue; }
        const priceRaw = sq(r, c.price).replace(/[,원\s]/g, ""); const price = priceRaw === "" ? 0 : Number(priceRaw);
        if (!Number.isInteger(price) || price < 0) { bad.push(`${no} — 가격이 숫자가 아니에요`); continue; }
        const bat = sq(r, c.bat);
        const a = await call({ action: "add", trade: tr, category: cat, name: nm, kind: kindIn, price, ...(flat ? { brand: sq(r, c.brand), model: sq(r, c.model), battery: bat === "포함" || bat === "미포함" ? bat : "", voltage: sq(r, c.volt), compat: sq(r, c.compat), tags: normTags(sq(r, c.tags)) } : {}) });
        if (!a.ok || typeof a.j.key !== "string") { bad.push(`${no} — ${typeof a.j.error === "string" ? a.j.error : "추가하지 못했어요"}`); continue; }
        const url = sq(r, c.url);
        if (url) { const l = await call({ action: "link", key: a.j.key, url }); if (!l.ok) bad.push(`${no} — 추가는 됐지만 링크를 저장하지 못했어요`); }
        done++;
      }
      setImportMsg(`${done}개 품목을 추가했어요${bad.length ? ` · 못 올린 줄 ${bad.length}개: ${bad.slice(0, 5).join(" / ")}${bad.length > 5 ? " 외" : ""}` : ""}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "엑셀 파일을 읽지 못했어요.");
    } finally {
      setImporting(false);
    }
  }
  // 품목 이름 바꾸기 (창고현황에도 같은 이름으로 바뀐다)
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  async function rename(p: Prod) {
    const n = editName.trim().replace(/\s+/g, " ");
    if (!n) return setErr("품목 이름을 적어 주세요.");
    const pr = Number(editPrice || 0);
    const lk = editLink.trim();
    const isTool = p.kind === "연장"; // 연장은 브랜드·제품명도 함께 고친다
    const br = editBrand.trim(), md = editModel.trim();
    const toolSame = !isTool || (br === p.brand && md === p.model && editBattery === p.battery && editVoltage.trim() === p.voltage && editCompat.trim() === p.compat && normTags(editTags).join("|") === p.tags.join("|"));
    if (n === p.name && pr === p.price && !editPhoto && lk === p.link && toolSame) return setEditKey(null);
    if (n !== p.name || pr !== p.price || !toolSame) {
      if (!(await post({ action: "rename", key: p.key, name: n, price: pr, ...(isTool ? { brand: br, model: md, battery: editBattery, voltage: editVoltage.trim(), compat: editCompat.trim(), tags: normTags(editTags) } : {}) }))) return;
    }
    let linkNow = p.link;
    if (lk !== p.link) { const lj = await post({ action: "link", key: p.key, url: lk }); if (!lj) return; linkNow = typeof lj.url === "string" ? lj.url : lk; }
    let img = p.image;
    if (editPhoto) { const up = await uploadPhoto(p.key, editPhoto); if (up) img = up; else return; }
    setItems(x => x.map(i => (i.key === p.key ? { ...i, name: n, price: pr, image: img, link: linkNow, ...(isTool ? { brand: br, model: md, battery: editBattery, voltage: editVoltage.trim(), compat: editCompat.trim(), tags: normTags(editTags) } : {}) } : i)));
    setEditKey(null); setEditPhoto(null);
    router.refresh();
  }
  // 체크한 품목을 다른 공정·카테고리로 이동 (내가 맡은 공정으로만 — trades 가 이미 내 공정만 담고 있다. 서버에서도 한 번 더 확인한다)
  const [moveTrade, setMoveTrade] = useState("");
  const [moveCat, setMoveCat] = useState("");
  const moveCats = moveTrade ? categories[moveTrade] ?? [] : [];
  async function moveChecked() {
    const list = items.filter(i => checked.includes(i.key));
    if (list.length === 0) return;
    const onlyTools = list.every(i => i.kind === "연장");
    if (!moveTrade) return setErr("옮길 공정을 골라 주세요.");
    if (!onlyTools && !moveCat) return setErr("옮길 카테고리를 골라 주세요.");
    const j = await post({ action: "move", keys: list.map(i => i.key), trade: moveTrade, category: moveCat });
    if (j) {
      const moved = (Array.isArray(j.moved) ? j.moved : []) as { key: string; category: string }[];
      const to = new Map(moved.map(m => [m.key, m.category]));
      setItems(x => x.map(i => (to.has(i.key) ? { ...i, trade: moveTrade, category: i.kind === "연장" ? "" : to.get(i.key)! } : i)));
      setChecked([]);
      setSetMsg(moved.length ? `${moved.length}개를 ${moveTrade}${onlyTools ? "" : ` › ${moveCat}`}(으)로 옮겼어요.` : "이미 그 공정·카테고리에 있어요.");
      router.refresh();
    }
  }
  // 종류 변경: 체크한 품목을 상비품 · 자재 · 연장으로 옮긴다. 자재·상비품은 공정·카테고리까지 정하고, 연장은 필요 없다 (지금 공정에 그대로 둔다).
  const [kindTo, setKindTo] = useState<KindTab | "">("");
  const [kindTrade, setKindTrade] = useState("");
  const [kindCat, setKindCat] = useState("");
  async function changeKindChecked() {
    const list = items.filter(i => checked.includes(i.key));
    if (list.length === 0) return;
    if (!kindTo) return setErr("바꿀 종류를 골라 주세요.");
    if (kindTo !== "연장") {
      if (!kindTrade) return setErr("옮길 공정을 골라 주세요.");
      if (!kindCat) return setErr("옮길 카테고리를 골라 주세요.");
    }
    const j = await post({ action: "kind", keys: list.map(i => i.key), kind: kindTo, trade: kindTrade, category: kindCat });
    if (j) {
      const ch = (Array.isArray(j.changed) ? j.changed : []) as { key: string; trade: string; category: string }[];
      const to = new Map(ch.map(c => [c.key.split("@")[0], c]));
      setItems(x => x.map(i => { const c = to.get(i.key.split("@")[0]); return c ? { ...i, kind: kindTo, trade: i.copyOf ? i.trade : c.trade, category: kindTo === "연장" ? "" : i.copyOf ? i.category : c.category } : i; }));
      setChecked([]);
      setSetMsg(`${ch.length}개를 ${kindTo}(으)로 바꿨어요${kindTo === "연장" ? "" : ` (${kindTrade} › ${kindCat})`}.`);
      router.refresh();
    }
  }
  // 공통 연결 복사: 원본은 그대로 두고 고른 공정·카테고리 목록에도 보이게 한다 (재고·가격·링크·사진은 원본 하나를 같이 쓴다)
  async function copyChecked() {
    const list = items.filter(i => checked.includes(i.key));
    if (list.length === 0) return;
    const onlyTools = list.every(i => i.kind === "연장");
    if (!moveTrade) return setErr("복사할 공정을 골라 주세요.");
    if (!onlyTools && !moveCat) return setErr("복사할 카테고리를 골라 주세요.");
    const j = await post({ action: "copy", keys: list.map(i => i.key), trade: moveTrade, category: moveCat });
    if (j) {
      const n = Array.isArray(j.moved) ? j.moved.length : 0;
      const skipped = Array.isArray(j.skipped) ? (j.skipped as string[]) : [];
      setChecked([]);
      setSetMsg(`${n}개를 ${moveTrade}${onlyTools ? "" : ` › ${moveCat}`}에도 연결했어요. 재고·가격은 원본과 같아요.${skipped.length ? ` (건너뜀: ${skipped.slice(0, 3).join(", ")})` : ""}`);
      router.refresh();
    }
  }
  async function delChecked() {
    const keys = checked.filter(k => items.some(i => i.key === k));
    if (keys.length === 0) return;
    const nCopy = items.filter(i => keys.includes(i.key) && i.copyOf).length;
    if (!window.confirm(`체크한 ${keys.length}개를 삭제할까요?\n${nCopy > 0 ? `연결 복사본 ${nCopy}개는 이 공정에서만 빠지고, ` : ""}원본은 창고현황의 휴지통으로 이동해요. (원본을 지우면 연결된 복사본도 함께 사라져요. 거기서 복원할 수 있어요)`)) return;
    const j = await post({ action: "deleteMany", keys });
    if (j) {
      const gone = new Set(((Array.isArray(j.removed) ? j.removed : keys) as string[]));
      setItems(x => x.filter(i => !gone.has(i.key)));
      setChecked([]);
      router.refresh();
    }
  }
  async function del(p: Prod) {
    if (!window.confirm(p.copyOf ? `“${p.name}”을(를) 이 공정에서 뺄까요?\n원본(${p.copyOf})은 그대로 남아요.` : `“${p.name}”을(를) 삭제할까요?\n창고현황의 휴지통으로 이동해요. (원본을 지우면 다른 공정에 연결된 복사본도 함께 사라져요)`)) return;
    if (await post({ action: "delete", key: p.key })) {
      setItems(x => x.filter(i => i.key !== p.key));
      router.refresh();
    }
  }
  // 품목마다 가장 최근에 '추가'한 기록 (없으면 처음부터 있던 품목)
  const addedBy = new Map<string, InventoryEntry>();
  for (const e of [...log].reverse()) if (e.action === "add") addedBy.set(e.productKey, e); // log 는 최신순이라 뒤집어서 최신 것이 남게
  const cats = sel ? categories[sel] ?? [] : [];
  // 공정 → 카테고리 순서로 묶어서 보여 준다 (카테고리 순서는 창고현황을 따른다)
  const catRank = (p: Prod) => (categories[p.trade] ?? []).indexOf(p.category);
  // 신규로 추가된 품목은 공정·카테고리와 상관없이 항상 맨 앞(1쪽 맨 위)에, 최근에 추가한 것부터 보여 준다
  const [addedNow, setAddedNow] = useState<Record<string, number>>({});
  const freshAt = (p: Prod): number => {
    const e = addedBy.get(p.key);
    const t = addedNow[p.key] ?? (e ? new Date(e.createdAt).getTime() : 0);
    return t && Date.now() - t < FRESH_MS ? t : 0;
  };
  const addedAtMs = (p: Prod): number => addedNow[p.key] ?? (addedBy.get(p.key) ? new Date(addedBy.get(p.key)!.createdAt).getTime() : 0);
  const cmpAdded = (x: Prod, y: Prod, dir: 1 | -1): number => { const a = addedAtMs(x), b = addedAtMs(y); return !a || !b ? (a ? -1 : b ? 1 : 0) : dir * (a - b); }; // 추가한 기록이 없는 품목은 항상 맨 뒤
  const sortVal = (p: Prod, key: SortKey): string => (key === "trade" ? p.trade : key === "category" ? p.category : key === "name" ? p.name : key === "by" ? addedBy.get(p.key)?.byName ?? "기존 품목" : "");
  // 지금 고른 종류·공정·카테고리 안에서 보유(재고 1개 이상) / 미보유(재고 0) 개수
  // 연장 태그: 지금 공정의 연장에 붙은 태그와 개수 (없어진 태그를 골라 둔 상태면 전체로)
  const tagCounts = (() => { const m = new Map<string, number>(); items.filter(p => p.kind === "연장" && (!sel || p.trade === sel)).forEach(p => p.tags.forEach(t => m.set(t, (m.get(t) ?? 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")); })();
  const tagNow = kindTab === "연장" && tagCounts.some(([t]) => t === tagSel) ? tagSel : "";
  const toolKw = toolQ.trim().replace(/\s+/g, "").toLowerCase();
  const toolMatch = (p: Prod) => !toolKw || (p.kind === "연장" ? `${p.name} ${p.brand} ${p.model} ${p.voltage} ${p.battery} ${p.compat} ${p.tags.join(" ")}` : `${p.name} ${p.category} ${p.trade}`).replace(/\s+/g, "").toLowerCase().includes(toolKw);
  const inScope = (p: Prod) => p.kind === kindTab && (!sel || p.trade === sel) && (kindTab === "연장" || !catSel || p.category === catSel) && (!tagNow || p.tags.includes(tagNow)) && toolMatch(p);
  const holdCounts = { all: items.filter(inScope).length, own: items.filter(p => inScope(p) && p.stock > 0).length, none: items.filter(p => inScope(p) && p.stock <= 0).length };
  const shown = items
    .filter(p => inScope(p) && (kindTab !== "연장" || holdTab === "all" || (holdTab === "own") === (p.stock > 0)))
    .map((p, i) => ({ p, i, f: freshAt(p) }))
    .sort((x, y) => sort ? (sort.key === "added" ? cmpAdded(x.p, y.p, sort.dir) : sort.dir * sortVal(x.p, sort.key).localeCompare(sortVal(y.p, sort.key), "ko", { numeric: true })) || x.i - y.i : (x.f || y.f ? (!x.f ? 1 : !y.f ? -1 : y.f - x.f) : trades.indexOf(x.p.trade) - trades.indexOf(y.p.trade) || catRank(x.p) - catRank(y.p) || x.i - y.i))
    .sort((x, y) => Number(starSet.has(y.p.key)) - Number(starSet.has(x.p.key)))
    .map(x => x.p);
  // 엑셀 받기: 지금 화면에 걸러진 목록 전체(다른 쪽 포함)를 엑셀 파일로 받는다
  function exportItems(list: Prod[]) {
    if (list.length === 0) { setErr("받을 품목이 없어요."); return; }
    const tool = list.every(p => p.kind === "연장");
    const header = ["#", "종류", "공정", ...(tool ? [] : ["카테고리"]), "품목", ...(tool ? ["브랜드", "제품명", "전압", "배터리", "호환성", "태그"] : []), "가격(원)"];
    const widths = [5, 9, 10, ...(tool ? [] : [14]), 30, ...(tool ? [12, 16, 8, 10, 18, 20] : []), 12];
    const rows = list.map((p, i) => [i + 1, p.kind, p.trade, ...(tool ? [] : [p.category]), p.name, ...(tool ? [p.brand, p.model, p.voltage, p.battery, p.compat, p.tags.join(", ")] : []), p.price > 0 ? p.price : ""]);
    downloadBlob(buildXlsx([{ name: kindTab, header, widths, rows }]), `장비조사_${kindTab}${sel ? `_${sel}` : ""}_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}.xlsx`);
  }
  const showTradeCol = new Set(shown.map(p => p.trade)).size > 1;
  const showCatCol = kindTab !== "연장" && new Set(shown.map(p => p.category)).size > 1;
  const hideCols = (showTradeCol ? 0 : 1) + (kindTab === "연장" ? 0 : showCatCol ? 0 : 1);
  const spanAll = (kindTab === "연장" ? 14 : 10) - (editing ? 0 : 3) - hideCols;
  // 인쇄: 지금 화면에 걸러진 목록(또는 담은 품목)을 깔끔한 표로 만들어 인쇄창을 연다
  function printItems(list: Prod[], title: string) {
    if (list.length === 0) { setErr("인쇄할 품목이 없어요."); return; }
    const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const tool = list.some(p => p.kind === "연장");
    const total = list.reduce((n, p) => n + (p.price > 0 ? p.price : 0), 0);
    const head = ["#", "공정", ...(tool ? [] : ["카테고리"]), "품목", ...(tool ? ["브랜드", "제품명", "전압"] : []), "가격(원)"];
    const rows = list.map((p, i) => "<tr>" + [String(i + 1), p.trade, ...(tool ? [] : [p.category]), p.name, ...(tool ? [p.brand, p.model, p.voltage] : []), p.price > 0 ? won(p.price) : "—"]
      .map((v, c, a) => `<td${c === a.length - 1 ? ' class="r"' : ""}>${esc(v)}</td>`).join("") + "</tr>").join("");
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:'Malgun Gothic',sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 12px;font-size:12px;color:#555}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px 7px;text-align:left}th{background:#eee}.r{text-align:right}
      tfoot td{font-weight:bold;background:#f6f6f6}tr{page-break-inside:avoid}thead{display:table-header-group}</style></head><body>
      <h1>${esc(title)}</h1><p>${list.length}개 · ${new Date().toLocaleDateString("ko-KR")}</p>
      <table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="${head.length - 1}">합계 (가격 미등록은 제외)</td><td class="r">${won(total)}</td></tr></tfoot></table>
      </body></html>`;
    // 새 창 없이 보이지 않는 틀에 표를 넣어 바로 인쇄창을 띄운다
    const fr = document.createElement("iframe");
    fr.setAttribute("aria-hidden", "true");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(fr);
    const w = fr.contentWindow;
    if (!w) { fr.remove(); setErr("인쇄를 시작하지 못했어요."); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { w.focus(); w.print(); setTimeout(() => fr.remove(), 60000); }, 200);
  }
  const groupOf = (p: Prod) => (starSet.has(p.key) ? "★" : freshAt(p) ? "신규" : `${p.trade}›${p.category}`);
  const starCount = shown.filter(p => starSet.has(p.key)).length;
  const freshCount = shown.filter(p => !starSet.has(p.key) && freshAt(p) > 0).length;
  const countIn = (t: string, c: string) => shown.filter(x => !starSet.has(x.key) && !freshAt(x) && x.trade === t && x.category === c).length;
  // 목록이 길면 쪽으로 나눈다 (공정·카테고리를 바꾸면 1쪽으로)
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [sel, catSel, sort, holdTab, kindTab, toolQ]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages);
  const start = (cur - 1) * PAGE;
  const rows = shown.slice(start, start + PAGE);
  const pageNums = Array.from({ length: pages }, (_, n) => n + 1).filter(n => n === 1 || n === pages || Math.abs(n - cur) <= 2);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">장비조사</h1>
        <span className="text-sm text-zinc-500">{admin ? `모든 공정 · ${kindTab}` : trades.length ? `내 공정: ${trades.join(" · ")}` : ""}</span>
      </div>
      <div className="mt-3 flex items-end gap-1 border-b border-black/15 dark:border-white/15" role="tablist" aria-label="품목 종류">
        {(["상비품", "자재", "연장"] as const).map(k => (
          <button key={k} type="button" role="tab" aria-selected={kindTab === k} onClick={() => pickKind(k)} className={`rounded-t-lg border border-b-0 px-5 py-2 text-sm font-extrabold ${kindTab === k ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{k} <small className="font-bold opacity-70">{items.filter(p => p.kind === k).length}</small></button>
        ))}
      </div>
      {kindTab === "연장" && <div className="mt-2 flex items-end gap-1 border-b border-black/15 dark:border-white/15" role="tablist" aria-label="보유 여부">
        {([["all", "전체"], ["own", "보유"], ["none", "미보유"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={holdTab === k} onClick={() => pickHold(k)} title={k === "own" ? "창고현황 재고가 1개 이상" : k === "none" ? "창고현황 재고가 0" : "보유·미보유 모두"} className={`rounded-t-lg border border-b-0 px-4 py-1.5 text-xs font-bold ${holdTab === k ? "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label} <small className="opacity-70">{holdCounts[k]}</small></button>
        ))}
      </div>}
      {(
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="search" value={toolQ} onChange={e => setToolQ(e.target.value.slice(0, 60))} placeholder={kindTab === "연장" ? "🔍 연장 검색 (품목·브랜드·제품명·전압·호환성·태그)" : `🔍 ${kindTab} 검색 (품목·카테고리·공정)`} aria-label={`${kindTab} 검색`} className="min-w-[14rem] flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-md dark:border-white/15" />
          {toolKw && <span className="text-xs text-zinc-500">검색 결과 {items.filter(p => p.kind === kindTab && toolMatch(p) && (!sel || p.trade === sel)).length}개</span>}
          {toolKw && <button type="button" onClick={() => setToolQ("")} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold dark:bg-zinc-800">지우기</button>}
        </div>
      )}
      {kindTab === "연장" && tagCounts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="태그로 묶어 보기">
          <span className="font-bold text-zinc-500">태그</span>
          <button type="button" aria-pressed={tagNow === ""} onClick={() => setTagSel("")} className={`rounded-full border px-2.5 py-1 font-bold ${tagNow === "" ? "border-violet-600 bg-violet-600 text-white" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>전체</button>
          {tagCounts.map(([t, n]) => <button key={t} type="button" aria-pressed={tagNow === t} onClick={() => setTagSel(tagNow === t ? "" : t)} className={`rounded-full border px-2.5 py-1 font-bold ${tagNow === t ? "border-violet-600 bg-violet-600 text-white" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>#{t} <span className="opacity-70">{n}</span></button>)}
        </div>
      )}
      <p className="mt-1 mb-[20pt] text-xs text-zinc-500">필요 없는 {kindTab}은(는) <b>삭제</b>(창고현황 휴지통으로 이동), 필요한 {kindTab}은(는) 맨 위 줄에서 공정·카테고리를 고르고 <b>추가</b>하세요. 추가한 품목은 창고현황의 같은 공정·카테고리에 바로 들어가요.</p>

      {checked.length > 0 && (
        <div className="mt-3 divide-y divide-black/10 rounded-xl border border-red-200 bg-red-50 text-sm dark:divide-white/10 dark:border-red-500/30 dark:bg-red-500/10">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <b className="text-red-700 dark:text-red-300">{checked.length}개 선택</b>
            <button type="button" onClick={() => setChecked([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">선택 해제</button>
            {setMsg && <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">{setMsg}</span>}
          </div>
          {editing && (<>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-20 shrink-0 text-xs font-extrabold text-zinc-600 dark:text-zinc-300">종류 변경</span>
            <select value={kindTo} onChange={e => { setKindTo(e.target.value as KindTab | ""); setKindCat(""); setSetMsg(""); }} aria-label="바꿀 종류" className="rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
              <option value="">바꿀 종류</option>
              {(["상비품", "자재", "연장"] as const).filter(k => k !== kindTab).map(k => <option key={k} value={k}>{k}(으)로</option>)}
            </select>
            {kindTo && kindTo !== "연장" && (
              <>
                <select value={kindTrade} onChange={e => { setKindTrade(e.target.value); setKindCat(""); setSetMsg(""); }} aria-label="종류 변경 후 공정" className="max-w-[9rem] rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
                  <option value="">공정</option>
                  {trades.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {kindTrade && (
                  <select value={kindCat} onChange={e => { setKindCat(e.target.value); setSetMsg(""); }} aria-label="종류 변경 후 카테고리" className="max-w-[9rem] rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
                    <option value="">카테고리</option>
                    {(categories[kindTrade] ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </>
            )}
            {kindTo === "연장" && <span className="text-xs text-zinc-500">연장은 공정만 쓰므로 지금 공정에 그대로 들어가요</span>}
            <button type="button" disabled={busy || !kindTo} onClick={() => void changeKindChecked()} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">선택한 품목 종류 변경</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-20 shrink-0 text-xs font-extrabold text-zinc-600 dark:text-zinc-300">공정 이동·복사</span>
            <select value={moveTrade} onChange={e => { setMoveTrade(e.target.value); setMoveCat(""); setSetMsg(""); }} aria-label="옮길 공정" className="max-w-[9rem] rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
              <option value="">옮길 공정</option>
              {trades.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {moveTrade && !checked.every(k => items.find(i => i.key === k)?.kind === "연장") && (
              <select value={moveCat} onChange={e => { setMoveCat(e.target.value); setSetMsg(""); }} aria-label="옮길 카테고리" className="max-w-[9rem] rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
                <option value="">옮길 카테고리</option>
                {moveCats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <button type="button" disabled={busy || !moveTrade} onClick={() => void moveChecked()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">선택한 품목 이동</button>
            <button type="button" disabled={busy || !moveTrade} onClick={() => void copyChecked()} title="원본은 그대로 두고 그 공정 목록에도 보이게 해요. 재고·가격은 원본 하나를 같이 써요" className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">다른 공정에 복사 (재고 공유)</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-20 shrink-0 text-xs font-extrabold text-zinc-600 dark:text-zinc-300">삭제</span>
            <button type="button" disabled={busy} onClick={() => void delChecked()} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">선택한 품목 삭제</button>
          </div>
          </>)}
        </div>
      )}
      {checked.length > 0 && (() => {
        return (
          <>
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] backdrop-blur dark:border-white/10 dark:bg-zinc-900/95" role="status" aria-live="polite">
              <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="text-sm font-extrabold text-red-700 dark:text-red-300">{checked.length}개 선택</span>
              </div>
            </div>
          </>
        );
      })()}
      {editing && (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-extrabold text-zinc-600 dark:text-zinc-300">엑셀 일괄 등록</span>
        <button type="button" onClick={downloadTemplate} disabled={trades.length === 0} title="공정·카테고리 목록이 들어 있는 엑셀 양식을 받아요" className="rounded-lg bg-emerald-100 px-3 py-1.5 font-bold text-emerald-800 disabled:opacity-40 dark:bg-emerald-500/20 dark:text-emerald-200">양식 받기</button>
        <button type="button" onClick={() => importRef.current?.click()} disabled={importing || busy || trades.length === 0} title="양식을 채워 올리면 한 줄마다 품목이 추가돼요" className="rounded-lg bg-emerald-700 px-3 py-1.5 font-bold text-white disabled:opacity-50">{importing ? "올리는 중…" : "엑셀로 일괄 등록"}</button>
        <input ref={importRef} type="file" accept=".xlsx" className="sr-only" aria-label="일괄 등록 엑셀 올리기" onChange={ev => { const fl = ev.target.files?.[0]; ev.target.value = ""; if (fl) void importSheet(fl); }} />
      </div>
      )}
      {importMsg && <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{importMsg}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-500">
        <label className="flex items-center gap-1.5">
          나열 순서
          <select value={orderValue} onChange={e => pickOrder(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-2 py-1 text-xs font-bold text-zinc-800 dark:border-white/15 dark:text-zinc-100" aria-label="나열 순서">
            {ORDERS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </label>
        <div className="hidden items-center gap-1.5 md:flex">
        행 간격
        <div className="inline-flex overflow-hidden rounded-lg border border-black/10 dark:border-white/10" role="radiogroup" aria-label="행 간격">
          {([["tight", "좁게"], ["normal", "보통"], ["wide", "넓게"]] as const).map(([d, label]) => (
            <button key={d} type="button" role="radio" aria-checked={density === d} onClick={() => pickDensity(d)} className={`px-2.5 py-1 font-bold ${density === d ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
          ))}
        </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => exportItems(shown)} className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">📥 엑셀 내보내기</button>
          <button type="button" onClick={() => printItems(shown, `장비조사 ${kindTab}${sel ? ` · ${sel}` : ""}`)} className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">🖨 인쇄</button>
        </span>
      </div>

      {err && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">{err}</p>}

      {trades.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-zinc-500 dark:border-white/15">내 팀이 맡은 공정이 아직 없어요. 최고 관리자나 개발팀에 팀의 ‘관여 공정’ 설정을 요청해 주세요.</p>
      ) : (
        <>
          {/* 좁은 화면(모바일): 표 대신 카드로 보여 준다 — 옆으로 밀어야 하는 표는 잘려 보여서 불편하다 */}
          <div className="mt-4 space-y-1.5 md:hidden">
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
              <select value={sel} onChange={e => { setSel(e.target.value); setCatSel(firstCat(e.target.value)); }} className={inp} aria-label="공정">
                <option value="">공정 선택</option>
                {trades.map(t => <option key={t}>{t}</option>)}
              </select>
              {sel && kindTab !== "연장" && (
                <div className="no-scrollbar flex items-end gap-1 overflow-x-auto border-b border-black/15 dark:border-white/15" role="tablist" aria-label="카테고리">
                  {cats.map(c => (
                    <button key={c} type="button" role="tab" aria-selected={catSel === c} onClick={() => setCatSel(c)} className={`shrink-0 rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${catSel === c ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{c}</button>
                  ))}
                </div>
              )}
              {editing && (<>
              <div className="flex items-center gap-2">
                <input value={newPrice} onChange={e => setNewPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격 (모바일)" />
                {photoPicker(newPhoto, setNewPhoto, "사진")}
              </div>
              <input value={newLink} onChange={e => setNewLink(e.target.value.slice(0, 500))} placeholder="구매 링크 (선택)" className={inp} aria-label="구매 링크 (모바일)" />
              {kindTab === "연장" && (
                <div className="flex gap-2">
                  <input value={newBrand} onChange={e => setNewBrand(e.target.value.slice(0, 50))} placeholder="브랜드" className={inp} aria-label="브랜드 (모바일)" />
                  <input value={newModel} onChange={e => setNewModel(e.target.value.slice(0, 100))} placeholder="제품명" className={inp} aria-label="제품명 (모바일)" />
                </div>
              )}
              {kindTab === "연장" && (
                <div className="flex gap-2">
                  <input list="voltage-list" value={newVoltage} onChange={e => setNewVoltage(e.target.value.slice(0, 20))} placeholder="전압 (예: 18V)" className={inp} aria-label="전압 (모바일)" />
                  {batterySelect(newBattery, setNewBattery, "배터리 포함 여부 (모바일)")}
                </div>
              )}
              {kindTab === "연장" && <input value={newTags} onChange={e => setNewTags(e.target.value.slice(0, 120))} placeholder="태그 (쉼표로, 예: 18V, 그라인더)" className={inp} aria-label="태그 (모바일)" />}
              {kindTab === "연장" && <input value={newCompat} onChange={e => setNewCompat(e.target.value.slice(0, 100))} placeholder="호환성 (예: M18 배터리 호환)" className={inp} aria-label="호환성 (모바일)" />}
              <div className="flex gap-2">
                <input value={name} onChange={e => setName(e.target.value.slice(0, 100))} placeholder="추가할 품목 이름" className={inp} aria-label="품목 이름 (모바일)" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
                <button type="button" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={add} className="shrink-0 rounded-md bg-blue-600 px-5 text-sm font-bold text-white disabled:opacity-50">추가</button>
              </div>
              </>)}
            </div>
            {editing && shown.length > 0 && <label className="flex cursor-pointer items-center gap-2 px-1 text-xs font-bold text-zinc-600 dark:text-zinc-300"><input type="checkbox" aria-label="목록 전체 선택 (모든 쪽)" checked={shown.every(r => checked.includes(r.key))} onChange={e => setChecked(c => (e.target.checked ? [...new Set([...c, ...shown.map(r => r.key)])] : c.filter(k => !shown.some(r => r.key === k))))} className="h-4 w-4 accent-red-600" />목록 전체 선택 ({shown.length}개)</label>}
            {shown.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">내 공정에 {kindTab}이(가) 없어요. 위에서 추가해 보세요.</p>}
            {rows.map((p, k) => {
              const i = start + k;
              const a = addedBy.get(p.key);
              const head = !sort && (k === 0 || groupOf(shown[i - 1]) !== groupOf(p));
              return (
                <Fragment key={p.key}>
                  {head && <div className="px-1 pt-1.5 text-xs font-extrabold text-blue-700 dark:text-blue-300">{starSet.has(p.key) ? <>★ 즐겨찾기 <span className="font-normal text-zinc-500">{starCount}개 · 나에게만 보이는 별표예요</span></> : freshAt(p) ? <>신규 추가 <span className="font-normal text-zinc-500">{freshCount}개</span></> : <>{p.trade}{p.category ? ` › ${p.category}` : ""} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개</span></>}</div>}
                  <div onClick={rowClick(p.key)} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${checked.includes(p.key) ? "border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5" : !editing && hl.includes(p.key) ? "border-blue-400 bg-blue-100 dark:border-blue-400/60 dark:bg-blue-500/25" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
                    {editing && <input type="checkbox" aria-label={`${p.name} 삭제할 품목으로 선택`} checked={checked.includes(p.key)} onChange={e => setChecked(c => (e.target.checked ? [...c, p.key] : c.filter(x => x !== p.key)))} className="h-4 w-4 shrink-0 accent-red-600" />}
                    <div className="shrink-0">{thumbPick(p, "h-10 w-10")}</div>
                    <div className="min-w-0 flex-1">
                      {editKey === p.key
                        ? <input autoFocus={editFocus === "name"} value={editName} onChange={e => setEditName(e.target.value.slice(0, 100))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} className={inp} aria-label="품목 이름 수정" />
                        : <div className="break-words text-sm font-semibold leading-snug" onClick={() => startEdit(p, "name")}>{p.name}<span className="ml-1 align-middle" onClick={e => e.stopPropagation()}>{starBtn(p)}</span>{p.copyOf && <span className="ml-1.5 align-middle rounded-full bg-sky-100 px-1.5 py-0 text-[11px] font-bold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200" title={`재고·가격·링크·사진은 원본(${p.copyOf})과 같아요`}>🔗 {p.copyOf} 연결</span>}</div>}
                      {editKey !== p.key && p.kind === "연장" && (p.brand || p.model) && <div className="text-[11px] text-zinc-500">{[p.brand, p.model].filter(Boolean).join(" · ")}</div>}
                      {editKey !== p.key && p.kind === "연장" && (p.voltage || p.battery) && <div className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">{[p.voltage, p.battery].filter(Boolean).join(" · ")}</div>}
                      {editKey !== p.key && p.kind === "연장" && tagChips(p)}
                      {editKey !== p.key && p.kind === "연장" && p.compat && <div className="text-[11px] text-zinc-500">호환: {p.compat}</div>}
                      {editKey === p.key ? (
                        <div className="mt-1 space-y-1.5"><div className="flex items-center gap-1.5"><input autoFocus={editFocus === "price"} value={editPrice} onChange={e => setEditPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격 수정 (모바일)" />{photoPicker(editPhoto, setEditPhoto, "사진")}</div><input autoFocus={editFocus === "link"} value={editLink} onChange={e => setEditLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크 수정 (모바일)" />{p.kind === "연장" && <div className="flex gap-1.5"><input value={editBrand} onChange={e => setEditBrand(e.target.value.slice(0, 50))} placeholder="브랜드" className={inp} aria-label="브랜드 수정 (모바일)" /><input value={editModel} onChange={e => setEditModel(e.target.value.slice(0, 100))} placeholder="제품명" className={inp} aria-label="제품명 수정 (모바일)" /></div>}{p.kind === "연장" && <div className="flex gap-1.5"><input list="voltage-list" value={editVoltage} onChange={e => setEditVoltage(e.target.value.slice(0, 20))} placeholder="전압 (예: 18V)" className={inp} aria-label="전압 수정 (모바일)" />{batterySelect(editBattery, setEditBattery, "배터리 포함 여부 수정 (모바일)")}</div>}{p.kind === "연장" && <input value={editTags} onChange={e => setEditTags(e.target.value.slice(0, 120))} placeholder="태그 (쉼표로)" className={inp} aria-label="태그 수정 (모바일)" />}{p.kind === "연장" && <input value={editCompat} onChange={e => setEditCompat(e.target.value.slice(0, 100))} placeholder="호환성" className={inp} aria-label="호환성 수정 (모바일)" />}</div>
                      ) : p.price > 0 && <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300" onClick={() => startEdit(p, "price")}>{won(p.price)}원</div>}
                      {editKey !== p.key && p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block rounded-md bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white">구매 링크 ↗</a>}
                      {editing && a && <div className="text-[11px] leading-tight text-zinc-500">{a.byName} 추가</div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {editKey === p.key ? (
                        <>
                          <button type="button" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => void rename(p)} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">저장</button>
                          <button type="button" disabled={busy} onClick={() => setEditKey(null)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">취소</button>
                        </>
                      ) : (
                        <>
                          {editing && <button type="button" disabled={busy} onClick={() => startEdit(p)} className="whitespace-nowrap rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold disabled:opacity-40 dark:bg-zinc-800">수정</button>}
                          {editing && <button type="button" disabled={busy} onClick={() => del(p)} className="whitespace-nowrap rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                        </>
                      )}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="no-scrollbar mt-4 hidden overflow-x-auto rounded-xl border border-black/10 md:block dark:border-white/10">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
                  {editing && <th className={`${cell} w-9 text-center`}><input type="checkbox" aria-label="목록 전체 선택 (모든 쪽)" title={`목록의 ${shown.length}개 품목을 모두 선택 (다른 쪽 포함)`} checked={shown.length > 0 && shown.every(r => checked.includes(r.key))} onChange={e => setChecked(c => (e.target.checked ? [...new Set([...c, ...shown.map(r => r.key)])] : c.filter(k => !shown.some(r => r.key === k))))} className="h-4 w-4 accent-red-600" /></th>}
                  <th className={`${cell} ${kindTab === "연장" ? "w-8" : "w-12"} text-center`}>#</th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-12" : "w-14"} text-center`}>사진</th>
                  {showTradeCol && <th className={`${cell} ${kindTab === "연장" ? "w-20" : "w-32"}`} aria-sort={sort?.key === "trade" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("trade")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "trade" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">공정<span aria-hidden className="text-[10px]">{sort?.key === "trade" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>}
                  {showCatCol && <th className={`${cell} w-40`} aria-sort={sort?.key === "category" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("category")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "category" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">카테고리<span aria-hidden className="text-[10px]">{sort?.key === "category" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>}
                  <th className={`${cell}`} aria-sort={sort?.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("name")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "name" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">품목<span aria-hidden className="text-[10px]">{sort?.key === "name" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>
                  {kindTab === "연장" && <><th className={`${cell} w-20`}>브랜드</th><th className={`${cell} w-24`}>제품명</th><th className={`${cell} w-14`}>전압</th><th className={`${cell} w-20`}>배터리</th><th className={`${cell} w-24`}>호환성</th></>}
                  <th className={`${cell} ${kindTab === "연장" ? "w-20" : "w-28"} text-right`}>가격</th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-12" : "w-24"} text-center`}>링크</th>
                  {editing && <th className={`${cell} ${kindTab === "연장" ? "w-16" : "w-24"}`} aria-sort={sort?.key === "by" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("by")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "by" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">추가한 사람<span aria-hidden className="text-[10px]">{sort?.key === "by" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>}
                  {editing && <th className={`${cell} ${kindTab === "연장" ? "w-40" : "w-40"}`} />}
                </tr>
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} colSpan={spanAll}>
                    <div className="flex flex-wrap items-end gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                      <span className="self-center">공정</span>
                      <select value={sel} onChange={e => { setSel(e.target.value); setCatSel(firstCat(e.target.value)); }} className="self-center rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-white/15" aria-label="공정">
                        <option value="">공정 선택</option>
                        {trades.map(t => <option key={t}>{t}</option>)}
                      </select>
                      {sel && kindTab === "연장" ? <span className="self-center font-normal text-zinc-500">연장은 공정별로만 구분해요 (카테고리 없음)</span> : sel ? (
                        <div className="flex flex-1 flex-wrap items-end gap-1 self-end border-b border-black/15 dark:border-white/15" role="tablist" aria-label="추가할 카테고리">
                          {cats.map(c => (
                            <button key={c} type="button" role="tab" aria-selected={catSel === c} onClick={() => setCatSel(c)} className={`rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${catSel === c ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{c}</button>
                          ))}
                        </div>
                      ) : <span className="self-center font-normal text-zinc-500">공정을 먼저 고르세요</span>}
                    </div>
                  </td>
                </tr>
                {editing && (
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} />
                  <td className={`${cell} text-center text-xs font-bold text-blue-700 dark:text-blue-300`}>＋</td>
                  <td className={`${cell} text-center`}>{photoPicker(newPhoto, setNewPhoto, "")}</td>
                  {(showTradeCol || showCatCol) && <td className={`${cell} text-xs font-bold text-zinc-600 dark:text-zinc-300`} colSpan={(showTradeCol ? 1 : 0) + (showCatCol ? 1 : 0)}>{kindTab === "연장" ? (sel ? `${sel} › 연장` : "공정을 고르세요") : sel && catSel ? `${sel} › ${catSel}` : "공정·카테고리를 고르세요"}</td>}
                  <td className={cell}><input value={name} onChange={e => setName(e.target.value.slice(0, 100))} placeholder="추가할 품목 이름" className={inp} aria-label="품목 이름" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />{kindTab === "연장" && <input value={newTags} onChange={e => setNewTags(e.target.value.slice(0, 120))} placeholder="태그 (쉼표로, 예: 18V, 그라인더)" className={`${inp} mt-1`} aria-label="태그" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />}</td>
                  {kindTab === "연장" && <><td className={cell}><input value={newBrand} onChange={e => setNewBrand(e.target.value.slice(0, 50))} placeholder="브랜드" className={inp} aria-label="브랜드" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td><td className={cell}><input value={newModel} onChange={e => setNewModel(e.target.value.slice(0, 100))} placeholder="제품명" className={inp} aria-label="제품명" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td><td className={cell}><input list="voltage-list" value={newVoltage} onChange={e => setNewVoltage(e.target.value.slice(0, 20))} placeholder="18V" className={inp} aria-label="전압" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td><td className={cell}>{batterySelect(newBattery, setNewBattery, "배터리 포함 여부")}</td><td className={cell}><input value={newCompat} onChange={e => setNewCompat(e.target.value.slice(0, 100))} placeholder="호환성" className={inp} aria-label="호환성" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td></>}
                  <td className={cell}><input value={newPrice} onChange={e => setNewPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td>
                  <td className={cell}><input value={newLink} onChange={e => setNewLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크" onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && add()} /></td>
                  <td className={cell} colSpan={2}><button type="button" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={add} className="w-full rounded-md bg-blue-600 py-1.5 text-sm font-bold text-white disabled:opacity-50">추가</button></td>
                </tr>
                )}
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={spanAll} className={`${cell} py-8 text-center text-zinc-500`}>내 공정에 {kindTab}이(가) 없어요. 위에서 추가해 보세요.</td></tr>
                )}
                {rows.map((p, k) => {
                  const i = start + k;
                  const a = addedBy.get(p.key);
                  const head = !sort && (k === 0 || groupOf(shown[i - 1]) !== groupOf(p)); // 묶음(신규 / 카테고리)이 바뀔 때 제목 줄
                  return (
                    <Fragment key={p.key}>
                    {head && (
                      <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                        <td colSpan={spanAll} className="border border-black/10 px-3 py-1.5 text-xs font-extrabold text-blue-700 dark:border-white/10 dark:text-blue-300">{starSet.has(p.key) ? <>★ 즐겨찾기 <span className="font-normal text-zinc-500">{starCount}개 · 나에게만 보이는 별표예요</span></> : freshAt(p) ? <>신규 추가 <span className="font-normal text-zinc-500">{freshCount}개 · 최근 14일 이내에 추가한 품목이에요</span></> : <>{p.trade}{p.category ? ` › ${p.category}` : ""} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개</span></>}</td>
                      </tr>
                    )}
                    <tr onClick={rowClick(p.key)} className={checked.includes(p.key) ? "bg-red-50/60 dark:bg-red-500/5" : editing ? "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40" : hl.includes(p.key) ? "cursor-pointer bg-blue-100 hover:bg-blue-200/80 dark:bg-blue-500/25 dark:hover:bg-blue-500/35" : "cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-500/10"}>
                      {editing && <td className={`${cell} text-center`}><input type="checkbox" aria-label={`${p.name} 삭제할 품목으로 선택`} checked={checked.includes(p.key)} onChange={e => setChecked(c => (e.target.checked ? [...c, p.key] : c.filter(k => k !== p.key)))} className="h-4 w-4 accent-red-600" /></td>}
                      <td className={`${cell} text-center text-xs text-zinc-400`}>{i + 1}</td>
                      <td className={`${cell} text-center`}>{editKey === p.key ? photoPicker(editPhoto, setEditPhoto, "") : thumbPick(p, "h-9 w-9")}</td>
                      {showTradeCol && <td className={`${cell} whitespace-nowrap`}>{p.trade}</td>}
                      {showCatCol && <td className={`${cell} whitespace-nowrap`}>{p.category}</td>}
                      <td className={`${cell} font-semibold ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 수정"} onClick={() => { if (editKey !== p.key) startEdit(p, "name"); }}>{editKey === p.key ? <><input autoFocus={editFocus === "name"} value={editName} onChange={e => setEditName(e.target.value.slice(0, 100))} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} className={inp} aria-label="품목 이름 수정" />{p.kind === "연장" && <input autoFocus={editFocus === "tags"} value={editTags} onChange={e => setEditTags(e.target.value.slice(0, 120))} placeholder="태그 (쉼표로, 예: 18V, 그라인더)" className={`${inp} mt-1`} aria-label="태그 수정" onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} />}</> : <>{p.name}<span className="ml-1 align-middle" onClick={e => e.stopPropagation()}>{starBtn(p)}</span>{p.copyOf && <span className="ml-1.5 align-middle rounded-full bg-sky-100 px-1.5 py-0 text-[11px] font-bold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200" title={`재고·가격·링크·사진은 원본(${p.copyOf})과 같아요`}>🔗 {p.copyOf} 연결</span>}{p.kind === "연장" && tagChips(p)}</>}</td>
                      {kindTab === "연장" && (["brand", "model"] as const).map(f => (
                        <td key={f} className={`${cell} text-sm ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : f === "brand" ? "눌러서 브랜드 입력" : "눌러서 제품명 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, f); }}>
                          {editKey === p.key ? <input autoFocus={editFocus === f} value={f === "brand" ? editBrand : editModel} onChange={e => (f === "brand" ? setEditBrand(e.target.value.slice(0, 50)) : setEditModel(e.target.value.slice(0, 100)))} placeholder={f === "brand" ? "브랜드" : "제품명"} className={inp} aria-label={f === "brand" ? "브랜드 수정" : "제품명 수정"} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : (f === "brand" ? p.brand : p.model) || <span className="text-zinc-300">—</span>}
                        </td>
                      ))}
                      {kindTab === "연장" && (
                        <td className={`${cell} text-sm whitespace-nowrap ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 전압 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "voltage"); }}>
                          {editKey === p.key ? <input autoFocus={editFocus === "voltage"} list="voltage-list" value={editVoltage} onChange={e => setEditVoltage(e.target.value.slice(0, 20))} placeholder="18V" className={inp} aria-label="전압 수정" onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.voltage || <span className="text-zinc-300">—</span>}
                        </td>
                      )}
                      {kindTab === "연장" && (
                        <td className={`${cell} text-sm ${editKey === p.key ? "" : editing ? "cursor-pointer hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 배터리 여부 선택"} onClick={() => { if (editKey !== p.key) startEdit(p, "battery"); }}>
                          {editKey === p.key ? batterySelect(editBattery, setEditBattery, "배터리 포함 여부 수정") : batteryBadge(p.battery)}
                        </td>
                      )}
                      {kindTab === "연장" && (
                        <td className={`${cell} text-sm ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 호환성 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "compat"); }}>
                          {editKey === p.key ? <input autoFocus={editFocus === "compat"} value={editCompat} onChange={e => setEditCompat(e.target.value.slice(0, 100))} placeholder="호환성" className={inp} aria-label="호환성 수정" onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.compat || <span className="text-zinc-300">—</span>}
                        </td>
                      )}
                      <td className={`${cell} text-right tabular-nums ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 가격 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "price"); }}>{editKey === p.key ? <input autoFocus={editFocus === "price"} value={editPrice} onChange={e => setEditPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격 수정" onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.price > 0 ? won(p.price) : <span className="text-zinc-300">—</span>}</td>
                      <td className={`${cell} text-center ${editKey === p.key ? "" : editing ? "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10" : ""}`} title={editKey === p.key ? undefined : "눌러서 링크 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "link"); }}>{editKey === p.key ? <input autoFocus={editFocus === "link"} value={editLink} onChange={e => setEditLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크 수정" onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={p.link} aria-label={`${p.name} 구매 링크 열기`} className="inline-block whitespace-nowrap rounded-md bg-orange-500 px-2 py-0.5 text-xs font-bold text-white hover:bg-orange-600">{kindTab === "연장" ? "↗" : "링크 ↗"}</a> : <span className="text-zinc-300">—</span>}</td>
                      {editing && <td className={`${cell} whitespace-nowrap`}>{a ? a.byName : <span className="text-zinc-400">기존 품목</span>}</td>}
                      {editing && (
                      <td className={`${cell} text-center`}>
                        {editKey === p.key ? (
                          <div className="flex justify-center gap-1">
                            <button type="button" disabled={busy} onMouseDown={e => e.preventDefault()} onClick={() => void rename(p)} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">저장</button>
                            <button type="button" disabled={busy} onClick={() => setEditKey(null)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">취소</button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-1">
                            {editing && <button type="button" disabled={busy} onClick={() => startEdit(p)} className="whitespace-nowrap rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold disabled:opacity-40 dark:bg-zinc-800">수정</button>}
                            {editing && <button type="button" disabled={busy} onClick={() => del(p)} className="whitespace-nowrap rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                          </div>
                        )}
                      </td>
                      )}
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {peek && (
            <div className="pointer-events-none fixed z-50 rounded-xl border border-black/10 bg-white p-1.5 shadow-2xl dark:border-white/15 dark:bg-zinc-900" style={{ left: Math.max(8, peek.x - 150), top: Math.max(8, Math.min(peek.y - 60, (typeof window !== "undefined" ? window.innerHeight : 800) - 150)) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={peek.src} alt="" className="h-28 w-28 rounded-lg bg-white object-contain" />
            </div>
          )}
          {voltageList}
          {pages > 1 && (
            <nav className="mt-3 flex flex-wrap items-center justify-center gap-1" aria-label="쪽 이동">
              <button type="button" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold disabled:opacity-35 dark:bg-zinc-800">이전</button>
              {pageNums.map((n, j) => (
                <Fragment key={n}>
                  {j > 0 && n - pageNums[j - 1] > 1 && <span className="px-1 text-zinc-400">…</span>}
                  <button type="button" onClick={() => setPage(n)} aria-current={n === cur ? "page" : undefined} className={`min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-bold ${n === cur ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{n}</button>
                </Fragment>
              ))}
              <button type="button" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold disabled:opacity-35 dark:bg-zinc-800">다음</button>
              <span className="ml-2 text-xs text-zinc-500">{start + 1}–{Math.min(start + PAGE, shown.length)} / {shown.length}개</span>
            </nav>
          )}

        </>
      )}
      <button type="button" onClick={() => { setEditing(v => !v); setEditKey(null); setChecked([]); setErr(""); }} aria-pressed={editing} title="눌러야 표의 칸·사진을 고칠 수 있어요" className={`fixed right-4 z-50 rounded-full px-5 py-3 text-sm font-extrabold shadow-lg ring-2 ring-white/70 transition-[bottom] dark:ring-black/40 ${checked.length > 0 || hl.length > 0 || cart.length > 0 ? "bottom-20" : "bottom-5"} ${editing ? "bg-blue-600 text-white" : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"}`}>{editing ? "✔ 편집 끝내기" : "✏️ 편집하기"}</button>
      {checked.length === 0 && (hl.length > 0 || cart.length > 0) && (() => {
        const cartItems = cart.flatMap(k => { const it = items.find(i => i.key === k); return it ? [it] : []; });
        const total = cartItems.reduce((n, i) => n + i.price, 0);
        const none = cartItems.filter(i => !(i.price > 0)).length;
        const hlItems = items.filter(i => hl.includes(i.key)); // 선택한(강조한) 품목의 가격 합계 (가격 미등록은 제외)
        const hlTotal = hlItems.reduce((n, i) => n + i.price, 0);
        const hlNone = hlItems.filter(i => !(i.price > 0)).length;
        return (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] backdrop-blur dark:border-white/10 dark:bg-zinc-900/95" role="status" aria-live="polite">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
              {hl.length > 0 && (
                <>
                  <span className="text-sm font-extrabold text-blue-700 dark:text-blue-300">{hl.length}개 선택</span>
                  <button type="button" onClick={addToCart} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-extrabold text-white">선택한 품목 담기</button>
                  <button type="button" onClick={() => setHl([])} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">선택 해제</button>
                </>
              )}
              {cartItems.length > 0 && (
                <span className={`${hl.length > 0 ? "" : "ml-auto "}flex flex-wrap items-center gap-2 text-sm text-zinc-500`}>
                  <button type="button" onClick={() => setCartOpen(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white">🛒 담은 품목 {cartItems.length}개 보기</button>
                  <span>{none > 0 && `가격 미등록 ${none}개 제외 · `}담은 품목 합계 <b className="ml-1 text-lg font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{won(total)}원</b></span>
                </span>
              )}
              {hl.length > 0 && (
                <span className="ml-auto text-sm text-zinc-500">{hlNone > 0 && `가격 미등록 ${hlNone}개 제외 · `}선택한 품목 합계 <b className="ml-1 text-lg font-extrabold tabular-nums text-zinc-900 dark:text-zinc-50">{won(hlTotal)}원</b></span>
              )}
            </div>
          </div>
        );
      })()}
      {(checked.length > 0 || hl.length > 0 || cart.length > 0) && <div className="h-24" aria-hidden />}
      <Modal open={cartOpen} onClose={() => setCartOpen(false)}>
        {(() => {
          const cartItems = cart.flatMap(k => { const it = items.find(i => i.key === k); return it ? [it] : []; });
          const total = cartItems.reduce((n, i) => n + i.price, 0);
          return (
            <>
              <h2 className="text-lg font-bold">담은 품목 {cartItems.length}개</h2>
              {cartItems.length === 0 ? <p className="mt-4 text-center text-sm text-zinc-500">담은 품목이 없어요.</p> : (
                <ul className="mt-3 max-h-[55vh] divide-y divide-black/10 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
                  {cartItems.map(i => (
                    <li key={i.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{i.name}</div>
                        <div className="text-[11px] text-zinc-500">{i.kind} · {i.trade}{i.category ? ` › ${i.category}` : ""}</div>
                      </div>
                      <span className="shrink-0 tabular-nums text-zinc-700 dark:text-zinc-200">{i.price > 0 ? `${won(i.price)}원` : "—"}</span>
                      <button type="button" aria-label={`${i.name} 빼기`} onClick={() => setCart(c => c.filter(k => k !== i.key))} className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs font-bold dark:bg-zinc-800">빼기</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between text-sm"><span className="text-zinc-500">합계</span><b className="text-lg tabular-nums">{won(total)}원</b></div>
              <div className="mt-4 flex gap-2">
                <button type="button" disabled={cartItems.length === 0} onClick={() => printItems(cartItems, "장비조사 담은 품목")} className="flex-1 rounded-xl bg-blue-50 py-3 font-bold text-blue-700 disabled:opacity-40 dark:bg-blue-500/15 dark:text-blue-300">🖨 인쇄</button>
                <button type="button" disabled={cartItems.length === 0} onClick={() => { setCart([]); setCartOpen(false); }} className="flex-1 rounded-xl bg-red-50 py-3 font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">모두 비우기</button>
                <button type="button" onClick={() => setCartOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
              </div>
            </>
          );
        })()}
      </Modal> {/* 하단 합계 시트에 목록 끝이 가려지지 않게 */}
    </div>
  );
}
