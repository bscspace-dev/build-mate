"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { shrink } from "@/components/admin/AddProduct";
import type { InventoryEntry } from "@/lib/types";

type Prod = { key: string; kind: "상비품" | "자재" | "연장"; stock: number; price: number; image: string; link: string; brand: string; model: string; battery: string; voltage: string; trade: string; category: string; name: string };
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

// 장비조사: 창고장비현황의 상비품이 공정(대분류)별로 엑셀처럼 목록으로 먼저 채워져 있다. 할 수 있는 일은 추가와 삭제뿐이다.
//  · 필요 없는 상비품 삭제 → 창고장비현황의 휴지통으로 간다(거기서 복원할 수 있다).
//  · 필요한 상비품 추가 → 고른 공정·카테고리로 창고장비현황에도 같이 등록된다.
//  · 추가·삭제한 사람과 시각이 남는다. 최고 관리자·개발팀은 모든 공정을 보고, 팀마다 맡을 공정을 정한다.
type Setup = { trades: string[]; categories: Record<string, string[]>; excluded: { trades: string[]; categories: string[] } };
export default function InventoryAdmin({ trades, categories, products, log, admin, setup }: { trades: string[]; categories: Record<string, string[]>; products: Prod[]; log: InventoryEntry[]; admin: boolean; setup: Setup | null }) {
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
  const [sel, setSel] = useState(trades.length === 1 ? trades[0] : ""); // 고른 공정: 목록도 그 공정의 품목만 보이고, 추가할 때도 이 공정에 들어간다
  const firstCat = (t: string) => categories[t]?.[0] ?? ""; // 공정의 첫 카테고리 (창고장비현황 순서)
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
  // 조사 제외 설정(모든 권한이 있는 사람): 장비조사에서 뺄 공정·카테고리를 고른다. 누르면 바로 저장되고, 제외한 것은 모두에게 보이지 않는다.
  const [setupOpen, setSetupOpen] = useState(false);
  const [exListOpen, setExListOpen] = useState(false); // 제외된 항목 목록 펼침 (처음에는 접혀 있다)
  const [ex, setEx] = useState(setup?.excluded ?? { trades: [], categories: [] });
  async function toggleEx(kind: "trade" | "category", name: string) {
    const next = kind === "trade"
      ? { ...ex, trades: ex.trades.includes(name) ? ex.trades.filter(x => x !== name) : [...ex.trades, name] }
      : { ...ex, categories: ex.categories.includes(name) ? ex.categories.filter(x => x !== name) : [...ex.categories, name] };
    const prev = ex;
    setEx(next);
    if (await post({ action: "excludeSave", excludedTrades: next.trades, excludedCategories: next.categories })) router.refresh();
    else setEx(prev);
  }

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
  const [editFocus, setEditFocus] = useState<"name" | "price" | "link" | "brand" | "model" | "battery" | "voltage">("name");
  // 사진 미리보기: 목록의 사진(썸네일)에 마우스를 올리면 커서 왼쪽에 작은 사진을 띄운다 (수정 중에는 띄우지 않는다)
  const [peek, setPeek] = useState<{ src: string; x: number; y: number } | null>(null);
  const peekProps = (p: Prod) => p.image && editKey !== p.key ? {
    onMouseEnter: (e: React.MouseEvent) => setPeek({ src: p.image, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setPeek({ src: p.image, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => setPeek(null),
  } : {};
  const startEdit = (p: Prod, f: "name" | "price" | "link" | "brand" | "model" | "battery" | "voltage" = "name") => { setPeek(null); setEditVoltage(p.voltage); setEditLink(p.link); setEditBrand(p.brand); setEditModel(p.model); setEditBattery(p.battery); setEditKey(p.key); setEditName(p.name); setEditPrice(p.price ? String(p.price) : ""); setEditPhoto(null); setEditFocus(f); };
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
    <label className={`mx-auto flex ${size} cursor-pointer items-center justify-center overflow-hidden rounded hover:ring-2 hover:ring-blue-500`} title={p.image ? "눌러서 사진 바꾸기" : "눌러서 사진 찾기"} {...peekProps(p)}>
      {p.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" loading="lazy" className="h-full w-full bg-white object-contain" />
      ) : <span className="text-base text-zinc-400" aria-hidden>📷</span>}
      <input type="file" accept="image/*" className="sr-only" aria-label={`${p.name} 사진 ${p.image ? "바꾸기" : "찾기"}`} onChange={e => { changePhoto(p, e.target.files?.[0] ?? null); e.target.value = ""; }} />
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
    if (!category) return setErr(flat ? "이 공정에는 카테고리가 없어서 연장을 추가할 수 없어요. 창고장비현황에서 카테고리를 먼저 만들어 주세요." : "카테고리를 골라 주세요.");
    if (!name.trim()) return setErr("품목 이름을 적어 주세요.");
    const j = await post({ action: "add", trade: sel, category, name, kind: kindTab, price: Number(newPrice || 0), ...(flat ? { brand: newBrand.trim(), model: newModel.trim(), battery: newBattery, voltage: newVoltage.trim() } : {}) });
    if (j) {
      const newLinkUrl = newLink.trim();
      let linkSaved = "";
      if (typeof j.key === "string" && newLinkUrl) { const lj = await post({ action: "link", key: j.key, url: newLinkUrl }); if (lj && typeof lj.url === "string") linkSaved = lj.url; } // 링크는 등록된 품목에 이어서 저장한다
      let img = "";
      if (typeof j.key === "string" && newPhoto) img = (await uploadPhoto(j.key, newPhoto)) ?? ""; // 사진은 등록된 품목에 이어서 올린다
      if (typeof j.key === "string") setAddedNow(x => ({ ...x, [j.key as string]: Date.now() }));
      if (typeof j.key === "string") setItems(x => [...x, { key: j.key as string, kind: kindTab, stock: 0, price: Number(newPrice || 0), image: img, link: linkSaved, brand: flat ? newBrand.trim() : "", model: flat ? newModel.trim() : "", battery: flat ? newBattery : "", voltage: flat ? newVoltage.trim() : "", trade: sel, category: flat ? "" : catSel, name: name.trim().replace(/\s+/g, " ") }]); // 새로고침을 기다리지 않고 바로 보여 준다
      setName(""); setNewPrice(""); setNewPhoto(null); setNewLink(""); setNewBrand(""); setNewModel(""); setNewBattery(""); setNewVoltage("");
      router.refresh(); // 뒤에서 서버 값으로 맞춘다
    }
  }
  // 품목 이름 바꾸기 (창고장비현황에도 같은 이름으로 바뀐다)
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  async function rename(p: Prod) {
    const n = editName.trim().replace(/\s+/g, " ");
    if (!n) return setErr("품목 이름을 적어 주세요.");
    const pr = Number(editPrice || 0);
    const lk = editLink.trim();
    const isTool = p.kind === "연장"; // 연장은 브랜드·제품명도 함께 고친다
    const br = editBrand.trim(), md = editModel.trim();
    const toolSame = !isTool || (br === p.brand && md === p.model && editBattery === p.battery && editVoltage.trim() === p.voltage);
    if (n === p.name && pr === p.price && !editPhoto && lk === p.link && toolSame) return setEditKey(null);
    if (n !== p.name || pr !== p.price || !toolSame) {
      if (!(await post({ action: "rename", key: p.key, name: n, price: pr, ...(isTool ? { brand: br, model: md, battery: editBattery, voltage: editVoltage.trim() } : {}) }))) return;
    }
    let linkNow = p.link;
    if (lk !== p.link) { const lj = await post({ action: "link", key: p.key, url: lk }); if (!lj) return; linkNow = typeof lj.url === "string" ? lj.url : lk; }
    let img = p.image;
    if (editPhoto) { const up = await uploadPhoto(p.key, editPhoto); if (up) img = up; else return; }
    setItems(x => x.map(i => (i.key === p.key ? { ...i, name: n, price: pr, image: img, link: linkNow, ...(isTool ? { brand: br, model: md, battery: editBattery, voltage: editVoltage.trim() } : {}) } : i)));
    setEditKey(null); setEditPhoto(null);
    router.refresh();
  }
  async function delChecked() {
    const keys = checked.filter(k => items.some(i => i.key === k));
    if (keys.length === 0) return;
    if (!window.confirm(`체크한 ${keys.length}개를 삭제할까요?\n창고장비현황의 휴지통으로 이동해요. (거기서 복원할 수 있어요)`)) return;
    const j = await post({ action: "deleteMany", keys });
    if (j) {
      const gone = new Set(((Array.isArray(j.removed) ? j.removed : keys) as string[]));
      setItems(x => x.filter(i => !gone.has(i.key)));
      setChecked([]);
      router.refresh();
    }
  }
  async function del(p: Prod) {
    if (!window.confirm(`“${p.name}”을(를) 삭제할까요?\n창고장비현황의 휴지통으로 이동해요. (거기서 복원할 수 있어요)`)) return;
    if (await post({ action: "delete", key: p.key })) {
      setItems(x => x.filter(i => i.key !== p.key));
      router.refresh();
    }
  }
  // 품목마다 가장 최근에 '추가'한 기록 (없으면 처음부터 있던 품목)
  const addedBy = new Map<string, InventoryEntry>();
  for (const e of [...log].reverse()) if (e.action === "add") addedBy.set(e.productKey, e); // log 는 최신순이라 뒤집어서 최신 것이 남게
  const cats = sel ? categories[sel] ?? [] : [];
  // 공정 → 카테고리 순서로 묶어서 보여 준다 (카테고리 순서는 창고장비현황을 따른다)
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
  const inScope = (p: Prod) => p.kind === kindTab && (!sel || p.trade === sel) && (kindTab === "연장" || !catSel || p.category === catSel);
  const holdCounts = { all: items.filter(inScope).length, own: items.filter(p => inScope(p) && p.stock > 0).length, none: items.filter(p => inScope(p) && p.stock <= 0).length };
  const shown = items
    .filter(p => inScope(p) && (kindTab !== "연장" || holdTab === "all" || (holdTab === "own") === (p.stock > 0)))
    .map((p, i) => ({ p, i, f: freshAt(p) }))
    .sort((x, y) => sort ? (sort.key === "added" ? cmpAdded(x.p, y.p, sort.dir) : sort.dir * sortVal(x.p, sort.key).localeCompare(sortVal(y.p, sort.key), "ko", { numeric: true })) || x.i - y.i : (x.f || y.f ? (!x.f ? 1 : !y.f ? -1 : y.f - x.f) : trades.indexOf(x.p.trade) - trades.indexOf(y.p.trade) || catRank(x.p) - catRank(y.p) || x.i - y.i))
    .map(x => x.p);
  const groupOf = (p: Prod) => (freshAt(p) ? "신규" : `${p.trade}›${p.category}`);
  const freshCount = shown.filter(p => freshAt(p) > 0).length;
  const countIn = (t: string, c: string) => shown.filter(x => !freshAt(x) && x.trade === t && x.category === c).length;
  // 목록이 길면 쪽으로 나눈다 (공정·카테고리를 바꾸면 1쪽으로)
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [sel, catSel, sort, holdTab, kindTab]);
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
          <button key={k} type="button" role="tab" aria-selected={holdTab === k} onClick={() => pickHold(k)} title={k === "own" ? "창고장비현황 재고가 1개 이상" : k === "none" ? "창고장비현황 재고가 0" : "보유·미보유 모두"} className={`rounded-t-lg border border-b-0 px-4 py-1.5 text-xs font-bold ${holdTab === k ? "border-zinc-700 bg-zinc-700 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label} <small className="opacity-70">{holdCounts[k]}</small></button>
        ))}
      </div>}
      {admin && setup && ex.trades.length + ex.categories.length > 0 && (
        <div className="mt-2 rounded-xl bg-zinc-100 text-xs dark:bg-zinc-800">
          <button type="button" onClick={() => setExListOpen(o => !o)} aria-expanded={exListOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left font-bold text-zinc-600 dark:text-zinc-300">
            <span aria-hidden className="w-3">{exListOpen ? "▼" : "▶"}</span>
            장비조사에서 제외된 항목 <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-500/20 dark:text-red-300">{ex.trades.length + ex.categories.length}</span>
            <span className="font-normal text-zinc-500">{exListOpen ? "눌러서 접기" : "눌러서 펼치고 다시 추가하기"}</span>
          </button>
          {exListOpen && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-black/5 px-3 py-2 dark:border-white/10">
              {ex.trades.map(t => (
                <button key={"t" + t} type="button" disabled={busy} onClick={() => void toggleEx("trade", t)} title="다시 장비조사에 넣기" className="rounded-full border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-600 disabled:opacity-50 dark:border-red-500/40 dark:bg-zinc-900 dark:text-red-300">{t} 공정 · ＋ 다시 추가</button>
              ))}
              {ex.categories.map(c => (
                <button key={"c" + c} type="button" disabled={busy} onClick={() => void toggleEx("category", c)} title="다시 장비조사에 넣기" className="rounded-full border border-red-300 bg-white px-2.5 py-1 font-semibold text-red-600 disabled:opacity-50 dark:border-red-500/40 dark:bg-zinc-900 dark:text-red-300">{c} 카테고리 · ＋ 다시 추가</button>
              ))}
            </div>
          )}
        </div>
      )}
      {admin && setup && (
        <div className="mt-2">
          <button type="button" onClick={() => setSetupOpen(o => !o)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">{setupOpen ? "조사 제외 설정 닫기" : `조사 제외 설정${ex.trades.length + ex.categories.length > 0 ? ` (제외 ${ex.trades.length + ex.categories.length})` : ""}`}</button>
          {setupOpen && (
            <section className="mt-2 rounded-2xl border border-black/10 p-3 dark:border-white/10">
              <p className="mb-2 text-xs text-zinc-500">장비조사에서 뺄 <b>공정</b> 또는 <b>카테고리</b>를 누르세요. 누르면 바로 저장되고, 제외한 것은 모든 사람의 장비조사에서 보이지 않아요. (창고장비현황·가격조사에는 영향이 없어요)</p>
              <div className="space-y-2.5">
                {setup.trades.map(t => (
                  <div key={t} className="flex flex-wrap items-center gap-1.5">
                    <button type="button" disabled={busy} onClick={() => void toggleEx("trade", t)} aria-pressed={ex.trades.includes(t)} className={`rounded-full border px-3 py-1 text-sm font-bold ${ex.trades.includes(t) ? "border-red-300 bg-red-50 text-red-600 line-through dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300" : "border-blue-600 bg-blue-600 text-white"}`}>{t}</button>
                    <span className="text-zinc-300">›</span>
                    {(setup.categories[t] ?? []).map(c => (
                      <button key={c} type="button" disabled={busy || ex.trades.includes(t)} onClick={() => void toggleEx("category", c)} aria-pressed={ex.categories.includes(c)} className={`rounded-full border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${ex.categories.includes(c) ? "border-red-300 bg-red-50 text-red-600 line-through dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300" : "border-black/15 dark:border-white/15"}`}>{c}</button>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <p className="mt-1 text-xs text-zinc-500">필요 없는 {kindTab}은(는) <b>삭제</b>(창고장비현황 휴지통으로 이동), 필요한 {kindTab}은(는) 맨 위 줄에서 공정·카테고리를 고르고 <b>추가</b>하세요. 추가한 품목은 창고장비현황의 같은 공정·카테고리에 바로 들어가요.</p>

      {checked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm dark:bg-red-500/10">
          <b className="text-red-700 dark:text-red-300">{checked.length}개 선택</b>
          <button type="button" disabled={busy} onClick={() => void delChecked()} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">선택한 품목 삭제</button>
          <button type="button" onClick={() => setChecked([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">선택 해제</button>
        </div>
      )}
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
              <div className="flex gap-2">
                <input value={name} onChange={e => setName(e.target.value.slice(0, 100))} placeholder="추가할 품목 이름" className={inp} aria-label="품목 이름 (모바일)" onKeyDown={e => e.key === "Enter" && add()} />
                <button type="button" disabled={busy} onClick={add} className="shrink-0 rounded-md bg-blue-600 px-5 text-sm font-bold text-white disabled:opacity-50">추가</button>
              </div>
            </div>
            {shown.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">내 공정에 {kindTab}이(가) 없어요. 위에서 추가해 보세요.</p>}
            {rows.map((p, k) => {
              const i = start + k;
              const a = addedBy.get(p.key);
              const head = !sort && (k === 0 || groupOf(shown[i - 1]) !== groupOf(p));
              return (
                <Fragment key={p.key}>
                  {head && <div className="px-1 pt-1.5 text-xs font-extrabold text-blue-700 dark:text-blue-300">{freshAt(p) ? <>신규 추가 <span className="font-normal text-zinc-500">{freshCount}개</span></> : <>{p.trade}{p.category ? ` › ${p.category}` : ""} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개</span></>}</div>}
                  <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${checked.includes(p.key) ? "border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/5" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
                    <input type="checkbox" aria-label={`${p.name} 삭제할 품목으로 선택`} checked={checked.includes(p.key)} onChange={e => setChecked(c => (e.target.checked ? [...c, p.key] : c.filter(x => x !== p.key)))} className="h-4 w-4 shrink-0 accent-red-600" />
                    <div className="shrink-0">{thumbPick(p, "h-10 w-10")}</div>
                    <div className="min-w-0 flex-1">
                      {editKey === p.key
                        ? <input autoFocus={editFocus === "name"} value={editName} onChange={e => setEditName(e.target.value.slice(0, 100))} onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} className={inp} aria-label="품목 이름 수정" />
                        : <div className="break-words text-sm font-semibold leading-snug" onClick={() => startEdit(p, "name")}>{p.name}</div>}
                      {editKey !== p.key && p.kind === "연장" && (p.brand || p.model) && <div className="text-[11px] text-zinc-500">{[p.brand, p.model].filter(Boolean).join(" · ")}</div>}
                      {editKey !== p.key && p.kind === "연장" && (p.voltage || p.battery) && <div className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300">{[p.voltage, p.battery].filter(Boolean).join(" · ")}</div>}
                      {editKey === p.key ? (
                        <div className="mt-1 space-y-1.5"><div className="flex items-center gap-1.5"><input autoFocus={editFocus === "price"} value={editPrice} onChange={e => setEditPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격 수정 (모바일)" />{photoPicker(editPhoto, setEditPhoto, "사진")}</div><input autoFocus={editFocus === "link"} value={editLink} onChange={e => setEditLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크 수정 (모바일)" />{p.kind === "연장" && <div className="flex gap-1.5"><input value={editBrand} onChange={e => setEditBrand(e.target.value.slice(0, 50))} placeholder="브랜드" className={inp} aria-label="브랜드 수정 (모바일)" /><input value={editModel} onChange={e => setEditModel(e.target.value.slice(0, 100))} placeholder="제품명" className={inp} aria-label="제품명 수정 (모바일)" /></div>}{p.kind === "연장" && <div className="flex gap-1.5"><input list="voltage-list" value={editVoltage} onChange={e => setEditVoltage(e.target.value.slice(0, 20))} placeholder="전압 (예: 18V)" className={inp} aria-label="전압 수정 (모바일)" />{batterySelect(editBattery, setEditBattery, "배터리 포함 여부 수정 (모바일)")}</div>}</div>
                      ) : p.price > 0 && <div className="text-xs font-bold text-zinc-600 dark:text-zinc-300" onClick={() => startEdit(p, "price")}>{won(p.price)}원</div>}
                      {editKey !== p.key && p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block rounded-md bg-orange-500 px-2 py-0.5 text-[11px] font-bold text-white">구매 링크 ↗</a>}
                      {a && <div className="text-[11px] leading-tight text-zinc-500">{a.byName} 추가</div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {editKey === p.key ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => void rename(p)} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">저장</button>
                          <button type="button" disabled={busy} onClick={() => setEditKey(null)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">취소</button>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled={busy} onClick={() => startEdit(p)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold disabled:opacity-40 dark:bg-zinc-800">수정</button>
                          <button type="button" disabled={busy} onClick={() => del(p)} className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">삭제</button>
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
                  <th className={`${cell} w-9 text-center`}><input type="checkbox" aria-label="이 쪽 전체 선택" checked={rows.length > 0 && rows.every(r => checked.includes(r.key))} onChange={e => setChecked(c => (e.target.checked ? [...new Set([...c, ...rows.map(r => r.key)])] : c.filter(k => !rows.some(r => r.key === k))))} className="h-4 w-4 accent-red-600" /></th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-10" : "w-12"} text-center`}>#</th>
                  <th className={`${cell} w-14 text-center`}>사진</th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-24" : "w-32"}`} aria-sort={sort?.key === "trade" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("trade")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "trade" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">공정<span aria-hidden className="text-[10px]">{sort?.key === "trade" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>
                  {kindTab !== "연장" && <th className={`${cell} w-40`} aria-sort={sort?.key === "category" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("category")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "category" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">카테고리<span aria-hidden className="text-[10px]">{sort?.key === "category" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>}
                  <th className={`${cell}`} aria-sort={sort?.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("name")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "name" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">품목<span aria-hidden className="text-[10px]">{sort?.key === "name" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>
                  {kindTab === "연장" && <><th className={`${cell} w-24`}>브랜드</th><th className={`${cell} w-28`}>제품명</th><th className={`${cell} w-16`}>전압</th><th className={`${cell} w-24`}>배터리</th></>}
                  <th className={`${cell} ${kindTab === "연장" ? "w-20" : "w-28"} text-right`}>가격</th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-20" : "w-24"} text-center`}>링크</th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-20" : "w-24"}`} aria-sort={sort?.key === "by" ? (sort.dir === 1 ? "ascending" : "descending") : "none"}><button type="button" onClick={() => clickSort("by")} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === "by" ? "text-blue-700 dark:text-blue-300" : ""}`} title="눌러서 오름차순 / 내림차순 정렬">추가한 사람<span aria-hidden className="text-[10px]">{sort?.key === "by" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span></button></th>
                  <th className={`${cell} ${kindTab === "연장" ? "w-28" : "w-32"}`} />
                </tr>
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} colSpan={kindTab === "연장" ? 13 : 10}>
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
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} />
                  <td className={`${cell} text-center text-xs font-bold text-blue-700 dark:text-blue-300`}>＋</td>
                  <td className={`${cell} text-center`}>{photoPicker(newPhoto, setNewPhoto, "")}</td>
                  <td className={`${cell} text-xs font-bold text-zinc-600 dark:text-zinc-300`} colSpan={kindTab === "연장" ? 1 : 2}>{kindTab === "연장" ? (sel ? `${sel} › 연장` : "공정을 고르세요") : sel && catSel ? `${sel} › ${catSel}` : "공정·카테고리를 고르세요"}</td>
                  <td className={cell}><input value={name} onChange={e => setName(e.target.value.slice(0, 100))} placeholder="추가할 품목 이름" className={inp} aria-label="품목 이름" onKeyDown={e => e.key === "Enter" && add()} /></td>
                  {kindTab === "연장" && <><td className={cell}><input value={newBrand} onChange={e => setNewBrand(e.target.value.slice(0, 50))} placeholder="브랜드" className={inp} aria-label="브랜드" onKeyDown={e => e.key === "Enter" && add()} /></td><td className={cell}><input value={newModel} onChange={e => setNewModel(e.target.value.slice(0, 100))} placeholder="제품명" className={inp} aria-label="제품명" onKeyDown={e => e.key === "Enter" && add()} /></td><td className={cell}><input list="voltage-list" value={newVoltage} onChange={e => setNewVoltage(e.target.value.slice(0, 20))} placeholder="18V" className={inp} aria-label="전압" onKeyDown={e => e.key === "Enter" && add()} /></td><td className={cell}>{batterySelect(newBattery, setNewBattery, "배터리 포함 여부")}</td></>}
                  <td className={cell}><input value={newPrice} onChange={e => setNewPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격" onKeyDown={e => e.key === "Enter" && add()} /></td>
                  <td className={cell}><input value={newLink} onChange={e => setNewLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크" onKeyDown={e => e.key === "Enter" && add()} /></td>
                  <td className={cell} colSpan={2}><button type="button" disabled={busy} onClick={add} className="w-full rounded-md bg-blue-600 py-1.5 text-sm font-bold text-white disabled:opacity-50">추가</button></td>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={kindTab === "연장" ? 13 : 10} className={`${cell} py-8 text-center text-zinc-500`}>내 공정에 {kindTab}이(가) 없어요. 위에서 추가해 보세요.</td></tr>
                )}
                {rows.map((p, k) => {
                  const i = start + k;
                  const a = addedBy.get(p.key);
                  const head = !sort && (k === 0 || groupOf(shown[i - 1]) !== groupOf(p)); // 묶음(신규 / 카테고리)이 바뀔 때 제목 줄
                  return (
                    <Fragment key={p.key}>
                    {head && (
                      <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                        <td colSpan={kindTab === "연장" ? 13 : 10} className="border border-black/10 px-3 py-1.5 text-xs font-extrabold text-blue-700 dark:border-white/10 dark:text-blue-300">{freshAt(p) ? <>신규 추가 <span className="font-normal text-zinc-500">{freshCount}개 · 최근 14일 이내에 추가한 품목이에요</span></> : <>{p.trade}{p.category ? ` › ${p.category}` : ""} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개</span></>}</td>
                      </tr>
                    )}
                    <tr className={checked.includes(p.key) ? "bg-red-50/60 dark:bg-red-500/5" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40"}>
                      <td className={`${cell} text-center`}><input type="checkbox" aria-label={`${p.name} 삭제할 품목으로 선택`} checked={checked.includes(p.key)} onChange={e => setChecked(c => (e.target.checked ? [...c, p.key] : c.filter(k => k !== p.key)))} className="h-4 w-4 accent-red-600" /></td>
                      <td className={`${cell} text-center text-xs text-zinc-400`}>{i + 1}</td>
                      <td className={`${cell} text-center`}>{editKey === p.key ? photoPicker(editPhoto, setEditPhoto, "") : thumbPick(p, "h-9 w-9")}</td>
                      <td className={`${cell} whitespace-nowrap`}>{p.trade}</td>
                      {kindTab !== "연장" && <td className={`${cell} whitespace-nowrap`}>{p.category}</td>}
                      <td className={`${cell} font-semibold ${editKey === p.key ? "" : "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : "눌러서 수정"} onClick={() => { if (editKey !== p.key) startEdit(p, "name"); }}>{editKey === p.key ? <input autoFocus={editFocus === "name"} value={editName} onChange={e => setEditName(e.target.value.slice(0, 100))} onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} className={inp} aria-label="품목 이름 수정" /> : p.name}</td>
                      {kindTab === "연장" && (["brand", "model"] as const).map(f => (
                        <td key={f} className={`${cell} text-sm ${editKey === p.key ? "" : "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : f === "brand" ? "눌러서 브랜드 입력" : "눌러서 제품명 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, f); }}>
                          {editKey === p.key ? <input autoFocus={editFocus === f} value={f === "brand" ? editBrand : editModel} onChange={e => (f === "brand" ? setEditBrand(e.target.value.slice(0, 50)) : setEditModel(e.target.value.slice(0, 100)))} placeholder={f === "brand" ? "브랜드" : "제품명"} className={inp} aria-label={f === "brand" ? "브랜드 수정" : "제품명 수정"} onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : (f === "brand" ? p.brand : p.model) || <span className="text-zinc-300">—</span>}
                        </td>
                      ))}
                      {kindTab === "연장" && (
                        <td className={`${cell} text-sm whitespace-nowrap ${editKey === p.key ? "" : "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : "눌러서 전압 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "voltage"); }}>
                          {editKey === p.key ? <input autoFocus={editFocus === "voltage"} list="voltage-list" value={editVoltage} onChange={e => setEditVoltage(e.target.value.slice(0, 20))} placeholder="18V" className={inp} aria-label="전압 수정" onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.voltage || <span className="text-zinc-300">—</span>}
                        </td>
                      )}
                      {kindTab === "연장" && (
                        <td className={`${cell} text-sm ${editKey === p.key ? "" : "cursor-pointer hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : "눌러서 배터리 여부 선택"} onClick={() => { if (editKey !== p.key) startEdit(p, "battery"); }}>
                          {editKey === p.key ? batterySelect(editBattery, setEditBattery, "배터리 포함 여부 수정") : batteryBadge(p.battery)}
                        </td>
                      )}
                      <td className={`${cell} text-right tabular-nums ${editKey === p.key ? "" : "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : "눌러서 가격 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "price"); }}>{editKey === p.key ? <input autoFocus={editFocus === "price"} value={editPrice} onChange={e => setEditPrice(priceNum(e.target.value))} inputMode="numeric" placeholder="가격(원)" className={`${inp} text-right`} aria-label="가격 수정" onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.price > 0 ? won(p.price) : <span className="text-zinc-300">—</span>}</td>
                      <td className={`${cell} text-center ${editKey === p.key ? "" : "cursor-text hover:bg-blue-50/70 dark:hover:bg-blue-500/10"}`} title={editKey === p.key ? undefined : "눌러서 링크 입력"} onClick={() => { if (editKey !== p.key) startEdit(p, "link"); }}>{editKey === p.key ? <input autoFocus={editFocus === "link"} value={editLink} onChange={e => setEditLink(e.target.value.slice(0, 500))} placeholder="구매 링크" className={inp} aria-label="구매 링크 수정" onKeyDown={e => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") setEditKey(null); }} /> : p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={p.link} aria-label={`${p.name} 구매 링크 열기`} className="inline-block rounded-md bg-orange-500 px-2 py-0.5 text-xs font-bold text-white hover:bg-orange-600">링크 ↗</a> : <span className="text-zinc-300">—</span>}</td>
                      <td className={`${cell} whitespace-nowrap`}>{a ? a.byName : <span className="text-zinc-400">기존 품목</span>}</td>
                      <td className={`${cell} text-center`}>
                        {editKey === p.key ? (
                          <div className="flex justify-center gap-1">
                            <button type="button" disabled={busy} onClick={() => void rename(p)} className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">저장</button>
                            <button type="button" disabled={busy} onClick={() => setEditKey(null)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">취소</button>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-1">
                            <button type="button" disabled={busy} onClick={() => startEdit(p)} className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-bold disabled:opacity-40 dark:bg-zinc-800">수정</button>
                            <button type="button" disabled={busy} onClick={() => del(p)} className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">삭제</button>
                          </div>
                        )}
                      </td>
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
    </div>
  );
}
