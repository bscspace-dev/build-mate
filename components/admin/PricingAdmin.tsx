"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { printElement } from "@/lib/print-client";
import { vendorColor } from "@/lib/vendor-color";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-export";
import type { InventoryEntry, VendorShipping } from "@/lib/types";

type Prod = { key: string; kind: "상비품" | "자재"; trade: string; category: string; name: string; price: number; incl: number | null; base?: string; image?: string }; // base = 판매 옵션 행이면 원래 품목 키 // incl = 포함가로 직접 적어 둔 금액 (없으면 null)
type Entry = InventoryEntry & { productCategory: string };
type Info = { url: string; vendor: string; unit: string };
type Field = "price" | "qty" | "ship";

const PICK_KEY = "bm_pricing_pick";
const BASE = "border border-black/10 px-2.5 dark:border-white/10";
// 행 간격(칸 위아래 여백): 좁게 / 보통 / 넓게
const PADS = { tight: "py-0.5", normal: "py-1.5", wide: "py-3.5" } as const;
type Density = keyof typeof PADS;
const DENSITY_KEY = "bm_row_density";
const VATMODE_KEY = "bm_pricing_vatmode"; // 적는 금액 기준: ex = 부가세 별도(공급가), in = 부가세 포함가
const HIDE_KEY = "bm_pricing_hidden"; // 조사에서 제외한 품목 (새로 조사를 시작할 때까지 유지)
const VAT_RATE = 0.1; // 부가세 10%
const num = "text-right tabular-nums";
// 같은 구매처는 같은 색으로 보여 준다 (이름에서 색을 정한다)
const vendorChip = (name: string) => <span className={`inline-block max-w-full truncate rounded-md px-1.5 py-0.5 align-middle text-xs font-bold ${vendorColor(name)}`}>{name}</span>;
// 가격조사 표의 열 (너비 px, 0 = 남는 폭). 머리글 오른쪽 끝을 끌어서 너비를 조절한다.
const COLS = [{ k: "chk", w: 32 }, { k: "no", w: 28 }, { k: "name", w: 0 }, { k: "per", w: 88 }, { k: "price", w: 80 }, { k: "qty", w: 52 }, { k: "pieces", w: 72 }, { k: "vat", w: 64 }, { k: "ship", w: 68 }, { k: "total", w: 84 }, { k: "vendor", w: 140 }, { k: "unit", w: 64 }];
const COLW_KEY = "bm_pricing_colw";
const WORK_KEY = "bm_pricing_work"; // 적어 둔 수량·배송비·필요 개수 (새로고침해도 이어서 보이게 이 브라우저에 자동 저장)
const won = (n: number) => n.toLocaleString("ko-KR");
const digits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);
const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
/** 판매단위 글자를 입수(숫자)와 단위 이름으로 나눈다. 숫자가 없으면 입수 1. */
const parseUnit = (u: string): { n: number; label: string } => {
  const m = /^\s*(\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(u);
  if (!m) return { n: 1, label: u.trim() };
  const n = Number(m[1].replace(/,/g, ""));
  return { n: n > 0 ? n : 1, label: m[2].trim() };
};
const vatOn = (supply: number) => Math.round(supply * VAT_RATE);
/** 구매 기록 한 건의 공급가액·부가세·배송비·합계 */
const entryMoney = (e: { price: number; qty: number; shipping: number }) => { const supply = e.price * e.qty; const vat = vatOn(supply); return { supply, vat, ship: e.shipping, total: supply + vat + e.shipping }; };

// 가격조사: 장비조사와 같은 상비품 목록(공정 → 카테고리)에 금액·수량·부가세·배송비·합계를 적는다.
//  · 공급가(부가세 별도 단가)는 창고장비현황의 품목 가격과 같다. 고치면 창고장비현황 가격도 바뀐다.
//  · 부가세 = 공급가 × 수량 × 10% (공급가를 입력하면 자동 계산), 합계 = 공급가 × 수량 + 부가세 + 배송비.
//  · 수량·배송비는 '구매 예정' 값으로, 적는 즉시 이 브라우저에 자동 저장된다(새로 조사 시작·구매완료 때 비워진다). 저장본을 불러오면 그 값으로 채워진다.
//  · 구매처 칸을 누르면 구매처 이름과 구매 링크를 등록한다 (품목마다 한 번만, 바꿀 때까지 유지).
//  · 구매완료를 누르면 수량이 창고장비현황 재고에 더해지고, 구매완료 탭에 구매처·배송비와 함께 남는다.
export default function PricingAdmin({ trades, categories, products, log, links, vendorShip, favorites, snapshots, admin }: { trades: string[]; categories: Record<string, string[]>; products: Prod[]; log: Entry[]; links: Record<string, Info>; vendorShip: Record<string, VendorShipping>; favorites: string[]; snapshots: { id: string; name: string; at: string; byName: string; count: number; excluded: number }[]; admin: boolean }) {
  const router = useRouter();
  const [density, setDensity] = useState<Density>("normal");
  useEffect(() => { try { const v = localStorage.getItem(DENSITY_KEY); if (v === "tight" || v === "normal" || v === "wide") setDensity(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickDensity = (d: Density) => { setDensity(d); try { localStorage.setItem(DENSITY_KEY, d); } catch { /* 저장이 막힌 환경 */ } };
  const cell = `${BASE} ${PADS[density]}`;
  // 적는 금액 기준: 부가세 별도(공급가) / 부가세 포함(인터넷 구매가처럼 부가세가 합쳐진 금액). 포함으로 적으면 공급가·부가세를 자동으로 나눈다.
  const [vatMode, setVatMode] = useState<"ex" | "in">("ex");
  useEffect(() => { try { if (localStorage.getItem(VATMODE_KEY) === "in") setVatMode("in"); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickVatMode = (m: "ex" | "in") => { setVatMode(m); try { localStorage.setItem(VATMODE_KEY, m); } catch { /* 저장이 막힌 환경 */ } };
  // 열 너비 조절: 머리글 오른쪽 끝을 끌면 그 열의 너비가 바뀌고(두 번 누르면 원래대로), 이 브라우저에 기억한다
  const [colW, setColW] = useState<Record<string, number>>({});
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(COLW_KEY) ?? "null"); if (v && typeof v === "object") setColW(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const wOf = (k: string) => colW[k] ?? COLS.find(c => c.k === k)?.w ?? 0;
  const saveColW = (next: Record<string, number>) => { setColW(next); try { if (Object.keys(next).length) localStorage.setItem(COLW_KEY, JSON.stringify(next)); else localStorage.removeItem(COLW_KEY); } catch { /* 저장이 막힌 환경 */ } };
  function startResize(k: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = wOf(k) || (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 120);
    let last = startW;
    const move = (ev: MouseEvent) => { last = Math.max(36, Math.round(startW + ev.clientX - startX)); setColW(x => ({ ...x, [k]: last })); };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); saveColW({ ...colWRef.current, [k]: last }); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }
  const colWRef = useRef(colW);
  colWRef.current = colW;
  const [incl, setIncl] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"survey" | "buy" | "done">("survey");
  const [sel, setSel] = useState(trades.length === 1 ? trades[0] : "");
  const firstCat = (t: string) => categories[t]?.[0] ?? "";
  const [catSel, setCatSel] = useState(() => firstCat(sel));
  // 고른 공정·카테고리는 다른 것으로 바꿀 때까지 그대로 둔다 (이 브라우저에 기억)
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

  const [checked, setChecked] = useState<string[]>([]); // 체크한 품목만 합계에 넣는다
  const [bulkQty, setBulkQty] = useState(""); // 체크한 품목의 수량을 한꺼번에 바꿀 값
  // 조사에서 제외한 품목: 체크한 품목을 이번 조사 목록에서 뺀다. 새로 조사를 시작(초기화)하기 전까지 유지되고, 저장본에 함께 저장된다 (이 브라우저에 보관).
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(HIDE_KEY) ?? "null") as { keys?: string[] } | string[] | null;
      const keys = Array.isArray(v) ? v : v?.keys;
      if (Array.isArray(keys)) setHidden(keys.filter(k => typeof k === "string"));
    } catch { /* 저장이 막힌 환경 */ }
  }, []);
  const saveHidden = (keys: string[]) => {
    setHidden(keys);
    try { localStorage.setItem(HIDE_KEY, JSON.stringify({ keys })); } catch { /* 저장이 막힌 환경 */ }
  };
  function excludeChecked() {
    if (checked.length === 0) return;
    if (!window.confirm(`체크한 ${checked.length}개를 이번 조사 목록에서 제외할까요?\n창고장비현황 품목은 그대로예요. 제외한 품목은 새로 조사를 시작하거나 되돌리기 전까지 숨겨져요.`)) return;
    saveHidden([...new Set([...hidden, ...checked])]);
    setChecked([]);
  }
  // 새로 조사 시작: 수량·배송비·체크·제외를 모두 처음 상태로
  function resetSurvey() {
    if (!window.confirm("새로 조사를 시작할까요?\n입력한 수량·배송비, 체크, 제외한 품목이 모두 초기화돼요. (저장해 둔 저장본은 그대로예요)")) return;
    setQtys({});
    setShips({});
    setIncl({});
    setDraft({});
    setChecked([]);
    saveHidden([]);
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 구매처별 배송 정책(기본 배송비·무료배송 기준): 키는 구매처 이름(소문자). 설정 창에서 고치고, 가격조사 표의 배송비에 자동 반영된다.
  const normV = (v: string) => v.trim().toLowerCase();
  const [vsMap, setVsMap] = useState(vendorShip);
  useEffect(() => setVsMap(vendorShip), [vendorShip]);
  const [vsOpen, setVsOpen] = useState(false);
  const [kindTab, setKindTab] = useState<"상비품" | "자재">("상비품"); // 가격조사의 종류 탭: 상비품 / 자재 (이 브라우저에 기억)
  useEffect(() => { try { const v = localStorage.getItem("bm_pricing_kind"); if (v === "상비품" || v === "자재") setKindTab(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickKind = (k: "상비품" | "자재") => {
    setKindTab(k); setChecked([]);
    // 지금 고른 카테고리에 이 종류의 품목이 없으면, 품목이 있는 카테고리로 옮긴다 (없으면 전체)
    const has = (c: string) => products.some(p => p.kind === k && (!sel || p.trade === sel) && (!c || p.category === c));
    if (catSel && !has(catSel)) setCatSel((categories[sel] ?? []).find(has) ?? ""); try { localStorage.setItem("bm_pricing_kind", k); } catch { /* 저장이 막힌 환경 */ } };
  // 품목 사진 미리보기: 사진이 등록된 품목 이름에 마우스를 올리면 커서 옆에 큰 사진을 띄운다
  const [peek, setPeek] = useState<{ src: string; x: number; y: number } | null>(null);
  const peekEditing = useRef(false); // 이름을 고치는 중에는 사진을 띄우지 않는다
  const peekProps = (p: { image?: string }) => p.image ? {
    onMouseEnter: (e: React.MouseEvent) => { if (!peekEditing.current) setPeek({ src: p.image!, x: e.clientX, y: e.clientY }); },
    onMouseMove: (e: React.MouseEvent) => { if (!peekEditing.current) setPeek({ src: p.image!, x: e.clientX, y: e.clientY }); },
    onMouseLeave: () => setPeek(null),
    onFocusCapture: () => { peekEditing.current = true; setPeek(null); },
    onBlurCapture: () => { peekEditing.current = false; },
  } : {};
  // 판매 옵션 접기: 기본은 접힌 상태이고, 펼쳐 둔 기본 품목(open)만 옵션 행을 보인다 (계산·합계는 그대로). 이 브라우저에 기억한다.
  const [open, setOpen] = useState<string[]>([]);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("bm_pricing_open") ?? "null"); if (Array.isArray(v)) setOpen(v.filter((k): k is string => typeof k === "string")); } catch { /* 저장이 막힌 환경 */ } }, []);
  const saveOpen = (next: string[]) => { setOpen(next); try { localStorage.setItem("bm_pricing_open", JSON.stringify(next)); } catch { /* 저장이 막힌 환경 */ } };
  // 구매하기 탭에 올린 품목(키 목록): 가격조사에서 체크하고 '다음'을 누르면 담긴다. 이 브라우저에 기억한다.
  const [cart, setCart] = useState<string[]>([]);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("bm_pricing_cart") ?? "null"); if (Array.isArray(v)) setCart(v.filter((k): k is string => typeof k === "string")); } catch { /* 저장이 막힌 환경 */ } }, []);
  const saveCart = (next: string[]) => { setCart(next); try { localStorage.setItem("bm_pricing_cart", JSON.stringify(next)); } catch { /* 저장이 막힌 환경 */ } };
  const toggleFold = (base: string) => saveOpen(open.includes(base) ? open.filter(k => k !== base) : [...open, base]);
  const [vsQ, setVsQ] = useState(""); // 구매처 검색
  const [vsNew, setVsNew] = useState(""); // 새로 등록할 구매처 이름
  // (아래 usageNames 는 favs·links·log 가 정해진 뒤에 계산한다)
  const [vsDraft, setVsDraft] = useState<Record<string, { fee: string; free: string }>>({});

  async function post(body: object): Promise<Record<string, unknown> | null> {
    if (busy) return null;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ menu: "pricing", ...body }) });
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

  // 금액·수량·배송비 칸을 눌러 바로 고친다: 칸을 벗어나거나 Enter 를 누르면 반영된다 (바뀐 게 없으면 저장하지 않는다).
  //  · 금액은 창고장비현황 가격으로 저장되고, 수량·배송비는 서버에는 저장하지 않고 이 브라우저에만 자동 저장한다.
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [ships, setShips] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, Partial<Record<Field, string>>>>({});
  // 자동 저장: 수량·배송비·필요 개수·포함가를 바꿀 때마다 이 브라우저에 저장하고, 다시 열면 이어서 보여 준다.
  // 지워지는 때: 새로 조사 시작, 구매완료(그 품목), 저장본 불러오기(불러온 값으로 바뀐다)
  const [workReady, setWorkReady] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(WORK_KEY) ?? "null") as { qtys?: Record<string, number>; ships?: Record<string, number>; incl?: Record<string, number> } | null;
      if (v) { setQtys(v.qtys ?? {}); setShips(v.ships ?? {}); setIncl(v.incl ?? {}); }
    } catch { /* 저장이 막힌 환경 */ }
    setWorkReady(true);
  }, []);
  useEffect(() => {
    if (!workReady) return;
    const pos = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, n]) => n > 0));
    try { localStorage.setItem(WORK_KEY, JSON.stringify({ qtys: pos(qtys), ships: pos(ships), incl: pos(incl) })); } catch { /* 저장이 막힌 환경 */ }
  }, [workReady, qtys, ships, incl]);
  // 공급가 단가: 포함 기준으로 적었으면 포함가 ÷ 1.1 (창고장비현황에는 공급가로 저장된다)
  const priceOf = (p: Prod) => (draft[p.key]?.price !== undefined ? (vatMode === "in" ? Math.round(Number(draft[p.key].price || 0) / (1 + VAT_RATE)) : Number(draft[p.key].price || 0)) : p.price);
  const unitInclOf = (p: Prod) => (draft[p.key]?.price !== undefined ? Number(draft[p.key].price || 0) : incl[p.key] ?? p.incl ?? p.price + vatOn(p.price)); // 부가세 포함 단가
  const qtyOf = (p: { key: string }) => (draft[p.key]?.qty !== undefined ? Number(draft[p.key].qty || 0) : qtys[p.key] ?? 0);
  const manualShip = (p: { key: string }) => (draft[p.key]?.ship !== undefined ? Number(draft[p.key].ship || 0) : ships[p.key] ?? 0);
  const shipOf = (p: { key: string }) => autoShips[p.key] ?? manualShip(p); // 구매처 배송 정책이 있으면 자동, 없으면 직접 적은 값
  const piecesOf = (p: Prod) => parseUnit(unitOf(p)).n * qtyOf(p); // 총 낱개 수 = 입수 × 수량
  const piecesText = (p: Prod) => (qtyOf(p) > 0 ? `${won(piecesOf(p))}${parseUnit(unitOf(p)).label}` : "—");
  const goodsIn = (p: Prod) => unitInclOf(p) * qtyOf(p); // (포함 기준) 부가세 포함 물품 금액
  const supplyOf = (p: Prod) => (vatMode === "in" ? Math.round(goodsIn(p) / (1 + VAT_RATE)) : priceOf(p) * qtyOf(p)); // 공급가액
  const vatOf = (p: Prod) => (vatMode === "in" ? goodsIn(p) - supplyOf(p) : vatOn(supplyOf(p))); // 부가세
  // 구매처 배송 정책 자동 적용: 수량을 적은 품목을 구매처별로 묶어 물품 합계(부가세 포함)가 무료 기준 이상이면 그 구매처 품목 모두 무료배송,
  // 미달이면 기본 배송비를 그 구매처의 첫 품목 한 곳에만 붙인다(나머지는 0). 낱개당 원가에는 품목 금액 비율로 나눈 몫(shipShare)을 녹인다.
  // 정책이 없는 구매처는 직접 적은 배송비를 쓴다.
  const computeShips = (list: Prod[]) => {
    const groups = new Map<string, { p: Prod; goods: number }[]>();
    for (const p of list) {
      if (hidden.includes(p.key) || qtyOf(p) <= 0) continue;
      const v = normV(links[p.key]?.vendor ?? "");
      if (!v || !vsMap[v]) continue;
      groups.set(v, [...(groups.get(v) ?? []), { p, goods: supplyOf(p) + vatOf(p) }]);
    }
    const autoShips: Record<string, number> = {};
    const shipShare: Record<string, number> = {};
    const freeShip = new Set<string>();
    for (const [v, rows] of groups) {
      const { fee, freeOver } = vsMap[v];
      const sumGoods = rows.reduce((a, r) => a + r.goods, 0);
      if (freeOver > 0 && sumGoods >= freeOver) { rows.forEach(r => { autoShips[r.p.key] = 0; shipShare[r.p.key] = 0; freeShip.add(r.p.key); }); continue; }
      let left = fee;
      rows.forEach((r, i) => {
        autoShips[r.p.key] = i === 0 ? fee : 0; // 배송비는 첫 품목 한 곳에만
        const share = i === rows.length - 1 ? left : Math.round(sumGoods > 0 ? (fee * r.goods) / sumGoods : fee / rows.length);
        shipShare[r.p.key] = Math.max(0, Math.min(left, share));
        left -= shipShare[r.p.key];
      });
    }
    return { autoShips, shipShare, freeShip };
  };
  const { autoShips, shipShare, freeShip } = computeShips(products);
  const totalOf = (p: Prod) => supplyOf(p) + vatOf(p) + shipOf(p); // 합계 (포함 기준이면 적은 포함가 × 수량 + 배송비 그대로)
  async function commit(p: Prod) {
    const d = draft[p.key];
    if (!d) return;
    const np = priceOf(p);
    const clear = () => setDraft(x => { const { [p.key]: _drop, ...rest } = x; return rest; });
    if (d.qty !== undefined) setQtys(x => ({ ...x, [p.key]: Number(d.qty || 0) }));
    if (d.price !== undefined && vatMode === "in") setIncl(x => ({ ...x, [p.key]: Number(d.price || 0) }));
    if (d.ship !== undefined) setShips(x => ({ ...x, [p.key]: Number(d.ship || 0) }));
    if (np === p.price) return clear();
    if (await post({ action: "rename", key: p.key, name: p.name, price: np, incl: vatMode === "in" ? Number(d.price || 0) : null })) router.refresh(); // 금액은 창고장비현황 가격으로 저장 (포함가로 적었으면 그 값도 그대로 저장)
    clear();
  }
  const numCell = (p: Prod, field: Field, value: number, max: number, extra = "") => (
    <input
      value={draft[p.key]?.[field] !== undefined ? draft[p.key][field] : won(value)}
      onFocus={e => { setDraft(x => ({ ...x, [p.key]: { ...x[p.key], [field]: value === 0 ? "" : String(value) } })); e.currentTarget.select(); }}
      onChange={e => setDraft(x => ({ ...x, [p.key]: { ...x[p.key], [field]: digits(e.target.value, max) } }))}
      onBlur={() => void commit(p)}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(x => { const { [p.key]: _d, ...rest } = x; return rest; }); e.currentTarget.blur(); } }}
      inputMode="numeric"
      disabled={busy}
      title="눌러서 바로 수정"
      data-qty={field === "qty" ? p.key : undefined}
      aria-label={`${p.name} ${field === "price" ? "금액" : field === "qty" ? "수량" : "배송비"}`}
      className={`w-full bg-transparent px-2.5 ${PADS[density]} text-right tabular-nums outline-none hover:bg-blue-50/70 focus:bg-white focus:ring-2 focus:ring-blue-500 dark:hover:bg-blue-500/10 dark:focus:bg-zinc-900 ${extra}`}
    />
  );

  // 구매처·구매 링크: 구매처 칸을 누르면 이름과 링크를 등록·수정·삭제하고, 링크가 있으면 줄 오른쪽에 '구매하기'가 생긴다
  const [linkP, setLinkP] = useState<Prod | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkVendor, setLinkVendor] = useState("");
  const [linkUnit, setLinkUnit] = useState("");
  // 판매단위: 칸에 바로 적고, 칸을 벗어나거나 Enter 를 누르면 저장된다 (구매처·링크는 그대로 둔다)
  const [unitDraft, setUnitDraft] = useState<Record<string, string>>({});
  const [unitSaved, setUnitSaved] = useState<Record<string, string>>({});
  const unitRaw = (p: Prod) => unitDraft[p.key] ?? unitSaved[p.key] ?? links[p.key]?.unit ?? ""; // 적어 둔 판매단위 (비어 있을 수 있다)
  const unitOf = (p: Prod) => unitRaw(p).trim() || "개"; // 판매단위를 따로 적지 않으면 기본값 "개"
  async function commitUnit(p: Prod) {
    const v = unitDraft[p.key];
    if (v === undefined) return;
    const nv = v.trim().replace(/\s+/g, " ").slice(0, 20);
    const info = links[p.key];
    const clear = () => setUnitDraft(x => { const { [p.key]: _d, ...rest } = x; return rest; });
    if (nv === (unitSaved[p.key] ?? info?.unit ?? "")) return clear();
    if (await post({ action: "link", key: p.key, url: info?.url ?? "", vendor: info?.vendor ?? "", unit: nv })) {
      setUnitSaved(x => ({ ...x, [p.key]: nv }));
      router.refresh();
    }
    clear();
  }
  // 판매 옵션(묶음·단품 등): 같은 품목에 판매단위가 다른 행을 더한다. 옵션 행은 구매처·링크·금액·수량·배송비를 따로 갖는다.
  const baseKeyOf = (p: { key: string; base?: string }) => p.base ?? p.key;
  const hasOpts = (p: { key: string; base?: string }) => products.some(x => x.base === baseKeyOf(p));
  async function addOpt(p: Prod) {
    if (await post({ action: "optAdd", key: baseKeyOf(p) })) { if (!open.includes(baseKeyOf(p))) saveOpen([...open, baseKeyOf(p)]); router.refresh(); } // 새 옵션은 바로 보이게 펼친다
  }
  async function delOpt(p: Prod) {
    if (!window.confirm(`“${p.name}”의 ${unitOf(p) || "이"} 판매 옵션을 지울까요?\n이 옵션에 적어 둔 구매처·링크·금액이 사라져요. (이미 구매완료한 내역은 그대로예요)`)) return;
    if (await post({ action: "optDel", key: p.key })) router.refresh();
  }
  // 낱개당 단가(공급가 ÷ 입수): 같은 품목의 옵션끼리 어느 쪽이 싼지 비교한다
  // 낱개당 원가(부가세 포함): 수량을 적었으면 배송비까지 합계에 녹여 (합계 ÷ 총 낱개), 아니면 단가 ÷ 입수
  const perPiece = (p: Prod) => { const n = parseUnit(unitOf(p)).n; return qtyOf(p) > 0 ? (supplyOf(p) + vatOf(p) + (shipShare[p.key] ?? shipOf(p))) / (n * qtyOf(p)) : unitInclOf(p) / n; };
  const groupOf = (p: Prod) => products.filter(x => baseKeyOf(x) === baseKeyOf(p));
  const cheapest = (p: Prod) => { const g = groupOf(p).filter(x => priceOf(x) > 0); return g.length > 1 && g.every(x => perPiece(x) >= perPiece(p) - 1e-9) && perPiece(p) > 0; };
  const compareText = (p: Prod) => {
    const q = qtyOf(p) > 0;
    if (priceOf(p) <= 0) return null;
    return <span className="ml-1 inline-flex flex-wrap items-center gap-1 text-[11px] font-normal text-zinc-500">낱개당 {won(Math.round(perPiece(p)))}원{q && <span>(배송비 포함)</span>}{hasOpts(p) && cheapest(p) && <b className="rounded bg-emerald-100 px-1 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">최저</b>}</span>;
  };
  // 배송비 칸: 구매처에 배송 정책이 있으면 자동 값(무료면 '무료배송')을 보여 주고, 없으면 직접 적는다
  const shipCell = (p: Prod) => autoShips[p.key] === undefined ? numCell(p, "ship", shipOf(p), 7) : (
    <div className={`px-2.5 ${PADS[density]} text-right`} title={`${links[p.key]?.vendor} 배송 정책으로 자동 계산`}>
      {autoShips[p.key] === 0 ? (freeShip.has(p.key) ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">무료배송</span> : <span className="text-[11px] text-zinc-400" title="이 구매처의 배송비는 첫 품목에 한 번만 붙어요">↑ 합산</span>) : <span className="tabular-nums">{won(autoShips[p.key])}<small className="ml-0.5 text-[10px] text-zinc-400">자동</small></span>}
    </div>
  );
  async function addVendor() {
    const name = vsNew.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return;
    if (usageNames.some(v => normV(v) === normV(name))) { setVsQ(name); setVsNew(""); return; } // 이미 있으면 검색으로 찾아 준다
    await toggleFav(name, true);
    setVsNew("");
    setVsQ(name);
  }
  async function saveVs(name: string) {
    const k = normV(name), d = vsDraft[k];
    if (!d) return;
    const fee = Number(d.fee || 0), freeOver = Number(d.free || 0);
    if (await post({ action: "vendorShip", vendor: name, fee, freeOver })) {
      setVsMap(m => { const n = { ...m }; if (fee > 0 || freeOver > 0) n[k] = { fee, freeOver }; else delete n[k]; return n; });
      setVsDraft(x => { const { [k]: _d, ...rest } = x; return rest; });
      router.refresh();
    }
  }
  // 옵션이 있는 기본 품목에 붙는 접기·펼치기 버튼
  const foldBtn = (p: Prod) => {
    if (p.base || !hasOpts(p)) return null;
    const n = products.filter(x => x.base === p.key).length;
    const shut = !open.includes(p.key);
    return <button type="button" onClick={() => toggleFold(p.key)} aria-expanded={!shut} title={shut ? "옵션 행 펼치기" : "옵션 행 접기"} className="rounded border border-blue-300 bg-blue-50 px-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300">{shut ? "▶" : "▼"} 옵션 {n}개</button>;
  };
  // 품목 이름: 칸에 바로 고친다 (칸을 벗어나거나 Enter 를 누르면 저장 · Esc 는 취소). 창고장비현황의 이름도 같이 바뀐다.
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});
  const [nameSaved, setNameSaved] = useState<Record<string, string>>({});
  const nameOf = (p: Prod) => nameDraft[p.key] ?? nameSaved[p.key] ?? p.name;
  async function commitName(p: Prod) {
    const v = nameDraft[p.key];
    if (v === undefined) return;
    const nv = v.trim().replace(/\s+/g, " ").slice(0, 100);
    const clear = () => setNameDraft(x => { const { [p.key]: _d, ...rest } = x; return rest; });
    if (!nv) { setErr("품목 이름을 적어 주세요."); return clear(); }
    if (nv === (nameSaved[p.key] ?? p.name)) return clear();
    if (await post({ action: "rename", key: p.key, name: nv, price: p.price })) { // 금액은 그대로 두고 이름만 바꾼다
      setNameSaved(x => ({ ...x, [p.key]: nv }));
      router.refresh();
    }
    clear();
  }
  const nameInput = (p: Prod, cls: string) => p.base ? (
    <span className="block truncate py-1 pl-6 pr-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400" title="같은 품목의 다른 판매 옵션">└ {unitRaw(p) || "옵션"}</span>
  ) : (
    <input
      value={nameOf(p)}
      onChange={e => setNameDraft(x => ({ ...x, [p.key]: e.target.value.slice(0, 100) }))}
      onBlur={() => void commitName(p)}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setNameDraft(x => { const { [p.key]: _d, ...rest } = x; return rest; }); e.currentTarget.blur(); } }}
      disabled={busy}
      title="눌러서 이름 바꾸기"
      aria-label={`${p.name} 품목 이름`}
      className={cls}
    />
  );
  const unitInput = (p: Prod, cls: string) => (
    <input
      value={unitRaw(p)}
      onChange={e => setUnitDraft(x => ({ ...x, [p.key]: e.target.value.slice(0, 20) }))}
      onBlur={() => void commitUnit(p)}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setUnitDraft(x => { const { [p.key]: _d, ...rest } = x; return rest; }); e.currentTarget.blur(); } }}
      placeholder="개"
      disabled={busy}
      title="바로 적어요 (예: 박스, 10개입, 롤)"
      aria-label={`${p.name} 판매단위`}
      className={cls}
    />
  );
  // 자주 가는 구매처: 고정한 곳(★)을 맨 앞에, 그 다음은 많이 쓴 순서대로 칩으로 보여 주고, 누르면 구매처 이름이 채워진다 (모두 같이 쓴다)
  const [favs, setFavs] = useState(favorites);
  useEffect(() => setFavs(favorites), [favorites]);
  const sameV = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const usage = new Map<string, { name: string; n: number }>();
  const countV = (name: string) => { const k = name.trim().toLowerCase(); if (!k) return; const cur = usage.get(k); usage.set(k, { name: cur?.name ?? name.trim(), n: (cur?.n ?? 0) + 1 }); };
  Object.values(links).forEach(i => countV(i.vendor));
  log.filter(e => e.action === "buy").forEach(e => countV(e.vendor));
  const vendorChips = [
    ...favs.map(v => ({ name: v, fav: true })),
    ...[...usage.values()].filter(u => !favs.some(f => sameV(f, u.name))).sort((a, b) => b.n - a.n).slice(0, 10).map(u => ({ name: u.name, fav: false })),
  ];
  const usageNames = (() => {
    const names = new Map<string, string>();
    [...favs, ...Object.values(links).map(i => i.vendor), ...log.map(e => e.vendor)].forEach(v => { if (v && v.trim() && !names.has(normV(v))) names.set(normV(v), v.trim()); });
    Object.keys(vsMap).forEach(k => { if (!names.has(k)) names.set(k, k); });
    return [...names.values()].sort((a, b) => a.localeCompare(b, "ko"));
  })();
  async function toggleFav(name: string, on: boolean) {
    const prev = favs;
    setFavs(on ? [...favs, name] : favs.filter(f => !sameV(f, name)));
    if (!(await post({ action: "favVendor", vendor: name, on }))) setFavs(prev);
  }
  async function saveLink(url: string, vendor: string, unit: string) {
    if (!linkP) return;
    if (await post({ action: "link", key: linkP.key, url, vendor, unit })) {
      setLinkP(null);
      router.refresh();
    }
  }
  // 금액·수량·배송비 저장 / 불러오기: 지금 보이는 품목의 값을 이름 붙여 저장해 두고, 나중에 그대로 되돌린다
  const [snapOpen, setSnapOpen] = useState(false);
  const [snapName, setSnapName] = useState("");
  async function snapSave() {
    if (!snapName.trim()) return setErr("저장본 이름을 적어 주세요.");
    if (shown.length === 0 && hidden.length === 0) return setErr("저장할 품목이 없어요.");
    if (await post({ action: "snapSave", name: snapName, items: shown.map(p => ({ key: p.key, qty: qtyOf(p), ship: shipOf(p) })), excluded: hidden })) {
      setSnapName("");
      router.refresh();
    }
  }
  async function snapLoad(s: { id: string; name: string; count: number; excluded: number }) {
    if (!window.confirm(`“${s.name}” (${s.count}개 품목${s.excluded > 0 ? ` · 제외 ${s.excluded}개` : ""})을 불러올까요?\n저장해 둔 수량·배송비·제외 상태로 채워져요. 금액은 지금 창고장비현황 가격 그대로 두어요.`)) return;
    const j = await post({ action: "snapLoad", id: s.id });
    if (j) {
      const items = (Array.isArray(j.items) ? j.items : []) as { key: string; qty: number; ship?: number }[];
      setQtys(Object.fromEntries(items.map(i => [i.key, i.qty]))); // 저장했을 때 그대로 (저장본에 없는 품목은 0)
      setShips(Object.fromEntries(items.map(i => [i.key, i.ship ?? 0])));
      saveHidden(((Array.isArray(j.excluded) ? j.excluded : []) as string[]).filter(k => typeof k === "string")); // 제외한 품목도 그대로
      setChecked([]);
      setSnapOpen(false);
      router.refresh();
    }
  }
  async function snapDelete(s: { id: string; name: string }) {
    if (!window.confirm(`저장본 “${s.name}”을(를) 삭제할까요?`)) return;
    if (await post({ action: "snapDelete", id: s.id })) router.refresh();
  }
  // 체크한 품목의 수량을 모두 같은 값으로 한 번에 바꾼다 (구매 예정 수량이라 이 화면에만 반영된다)
  function applyBulkQty() {
    const n = Number(bulkQty);
    if (bulkQty.trim() === "" || !Number.isInteger(n) || n < 0) return setErr("바꿀 수량을 0 이상의 숫자로 적어 주세요.");
    const keys = picked.map(x => x.key);
    if (keys.length === 0) return setErr("수량을 바꿀 품목을 먼저 체크해 주세요.");
    setErr("");
    setDraft(x => Object.fromEntries(Object.entries(x).map(([k, d]) => (keys.includes(k) ? [k, { ...d, qty: undefined }] : [k, d]))));
    setQtys(x => ({ ...x, ...Object.fromEntries(keys.map(k => [k, n])) }));
  }
  const cats = sel ? categories[sel] ?? [] : [];
  const catRank = (p: Prod) => (categories[p.trade] ?? []).indexOf(p.category);
  const shown = products
    .filter(p => p.kind === kindTab && (!sel || p.trade === sel) && (!catSel || p.category === catSel) && !hidden.includes(p.key))
    .map((p, i) => ({ p, i }))
    .sort((x, y) => trades.indexOf(x.p.trade) - trades.indexOf(y.p.trade) || catRank(x.p) - catRank(y.p) || x.i - y.i)
    .map(x => x.p);
  const folded = (p: Prod) => !!p.base && !open.includes(p.base);
  const rowNo = new Map(shown.filter(x => !folded(x)).map((x, k) => [x.key, k + 1]));
  const on = (p: Prod) => checked.includes(p.key);
  const inGroup = (t: string, c: string) => shown.filter(x => x.trade === t && x.category === c);
  const sumIn = (t: string, c: string) => inGroup(t, c).filter(on).reduce((a, x) => a + totalOf(x), 0);
  const checkedIn = (t: string, c: string) => inGroup(t, c).filter(on).length;
  const countIn = (t: string, c: string) => inGroup(t, c).length;
  const picked = shown.filter(on);
  // ── 구매하기 탭: 담은 품목을 구매처별로 묶고, 배송비는 담은 품목끼리만 계산한다
  const cartRows = products.filter(p => cart.includes(p.key) && !hidden.includes(p.key));
  const cs = computeShips(cartRows);
  const shipC = (p: Prod) => cs.autoShips[p.key] ?? manualShip(p);
  const totalC = (p: Prod) => supplyOf(p) + vatOf(p) + shipC(p);
  const perPieceC = (p: Prod) => { const n = parseUnit(unitOf(p)).n; return qtyOf(p) > 0 ? (supplyOf(p) + vatOf(p) + (cs.shipShare[p.key] ?? shipC(p))) / (n * qtyOf(p)) : 0; };
  const vendorOf = (p: Prod) => (links[p.key]?.vendor ?? "").trim();
  const buyGroups = (() => {
    const m = new Map<string, Prod[]>();
    cartRows.forEach(p => m.set(vendorOf(p), [...(m.get(vendorOf(p)) ?? []), p]));
    return [...m.entries()].sort(([x], [y]) => (x === "" ? 1 : y === "" ? -1 : x.localeCompare(y, "ko")));
  })();
  const buyReady = cartRows.filter(p => qtyOf(p) > 0);
  // 체크한 품목(수량이 있는 것)을 구매하기 탭으로 옮긴다
  function goBuy() {
    const list = picked.filter(p => qtyOf(p) > 0);
    if (list.length === 0) return setErr("체크한 품목 중 수량이 적힌 품목이 없어요. 수량을 먼저 적어 주세요.");
    const skip = picked.length - list.length;
    setErr(skip > 0 ? `수량이 없는 ${skip}개는 옮기지 않았어요.` : "");
    saveCart([...new Set([...cart, ...list.map(p => p.key)])]);
    setChecked([]);
    setTab("buy");
  }
  // 구매하기 탭에서 구매완료 처리: 수량이 재고에 더해지고 구매완료 탭에 기록된다
  async function buyRows(rows: Prod[], label: string) {
    const list = rows.filter(p => qtyOf(p) > 0);
    if (list.length === 0) return setErr("수량이 적힌 품목이 없어요.");
    const sumAll = list.reduce((a, p) => a + totalC(p), 0);
    if (!window.confirm(`${label} ${list.length}개를 구매완료로 처리할까요?\n합계 ${won(sumAll)}원 (부가세·배송비 포함)\n수량이 창고장비현황 재고에 더해지고, 구매완료 탭에 기록돼요.`)) return;
    if (await post({ action: "buyMany", items: list.map(p => ({ key: p.key, qty: qtyOf(p), ship: shipC(p) })) })) {
      const ks = list.map(p => p.key);
      setQtys(x => ({ ...x, ...Object.fromEntries(ks.map(k => [k, 0])) })); // 구매완료하면 수량·배송비는 다시 0
      setShips(x => ({ ...x, ...Object.fromEntries(ks.map(k => [k, 0])) }));
      saveCart(cart.filter(k => !ks.includes(k)));
      router.refresh();
    }
  }
  const sum = (f: (p: Prod) => number) => picked.reduce((a, x) => a + f(x), 0);
  const total = sum(totalOf);
  const totalQty = sum(qtyOf);
  const totalSupply = sum(supplyOf);
  const totalVat = sum(vatOf);
  const totalShip = sum(shipOf);
  const allOn = shown.length > 0 && picked.length === shown.length;
  const toggle = (keys: string[], v: boolean) => setChecked(c => (v ? [...new Set([...c, ...keys])] : c.filter(k => !keys.includes(k))));
  const done = log.filter(e => e.action === "buy" && (!sel || e.category === sel) && (!catSel || e.productCategory === catSel));
  // 구매완료 내역서: 날짜별로 묶어 견적서·이력서처럼 보여 주고, 엑셀·PDF·인쇄로 내보낸다
  const [openDays, setOpenDays] = useState<string[]>([]); // 펼쳐 둔 날짜 (처음에는 모두 접혀 있다)
  const todayKst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [dFrom, setDFrom] = useState(todayKst); // 기간 기본값은 오늘 (전체 기간을 누르면 전체)
  const [dTo, setDTo] = useState(todayKst);
  const day = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const dayLabel = (d: string) => `${d} (${new Date(d + "T12:00:00+09:00").toLocaleDateString("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" })})`;
  const doneShown = done.filter(e => (!dFrom || day(e.createdAt) >= dFrom) && (!dTo || day(e.createdAt) <= dTo));
  const byDay = new Map<string, Entry[]>();
  for (const e of [...doneShown].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) byDay.set(day(e.createdAt), [...(byDay.get(day(e.createdAt)) ?? []), e]);
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
  const money = (list: Entry[]) => list.reduce((a, e) => { const m = entryMoney(e); return { supply: a.supply + m.supply, vat: a.vat + m.vat, ship: a.ship + m.ship, total: a.total + m.total }; }, { supply: 0, vat: 0, ship: 0, total: 0 });
  const amount = (list: Entry[]) => money(list).total;
  const qtySum = (list: Entry[]) => list.reduce((a, e) => a + e.qty, 0);
  const scopeText = [sel || "전체 공정", catSel || "전체 카테고리"].join(" › ");
  async function deleteDay(d: string, list: Entry[]) {
    if (!window.confirm(`${dayLabel(d)} 구매 내역서 ${list.length}건(합계 ${won(amount(list))}원)을 삭제할까요?\n구매 기록만 지워지고, 이미 창고장비현황 재고에 더해진 수량은 그대로예요.`)) return;
    if (await post({ action: "doneDelete", ids: list.map(e => e.id) })) router.refresh();
  }
  function exportDone(list: Entry[], label: string) {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const rows: (string | number | null)[][] = sorted.map(e => { const m = entryMoney(e); return [day(e.createdAt), when(e.createdAt).slice(11), e.category, e.productCategory || "", e.name, e.vendor || "", e.unit || "", e.price, e.qty, m.vat, m.ship, m.total, e.byName]; });
    const all = money(sorted);
    rows.push(["합계", "", "", "", `${sorted.length}건`, "", "", "", qtySum(sorted), all.vat, all.ship, all.total, ""]);
    const daily = [...new Set(sorted.map(e => day(e.createdAt)))].map(d => { const l = sorted.filter(e => day(e.createdAt) === d); const m = money(l); return [d, l.length, qtySum(l), m.supply, m.vat, m.ship, m.total] as (string | number)[]; });
    daily.push(["합계", sorted.length, qtySum(sorted), all.supply, all.vat, all.ship, all.total]);
    downloadBlob(buildXlsx([
      { name: "구매내역", header: ["구매일", "시각", "공정", "카테고리", "품목", "구매처", "판매단위", "공급가(원)", "수량", "부가세(원)", "배송비(원)", "합계(원)", "구매한 사람"], widths: [12, 8, 12, 16, 36, 16, 10, 12, 8, 12, 12, 14, 12], rows },
      { name: "일자별 합계", header: ["구매일", "건수", "수량", "공급가 합계(원)", "부가세(원)", "배송비(원)", "합계(원)"], widths: [12, 8, 8, 14, 12, 12, 14], rows: daily },
    ]), `구매내역_${label}.xlsx`);
  }

  // 구매하기 탭 엑셀: 구매처별로 정렬한 구매 목록
  function exportBuy() {
    const rows: (string | number | null)[][] = buyGroups.flatMap(([v, list]) => list.filter(p => qtyOf(p) > 0).map(p => [v || "구매처 미등록", p.trade, p.category, nameOf(p), unitOf(p), qtyOf(p), vatMode === "in" ? unitInclOf(p) : priceOf(p), Math.round(perPieceC(p)), shipC(p), totalC(p), links[p.key]?.url ?? ""]));
    rows.push(["합계", "", "", `${rows.length}개`, "", rows.reduce((a, r) => a + Number(r[5]), 0), "", "", rows.reduce((a, r) => a + Number(r[8]), 0), rows.reduce((a, r) => a + Number(r[9]), 0), ""]);
    downloadBlob(buildXlsx([{ name: "구매목록", header: ["구매처", "공정", "카테고리", "품목", "판매단위", "수량", vatMode === "in" ? "포함가(원)" : "공급가(원)", "낱개당(원)", "배송비(원)", "합계(원)", "구매 링크"], widths: [16, 10, 14, 34, 12, 8, 12, 12, 12, 14, 40], rows }]), `구매목록_${todayKst}.xlsx`);
  }
  // 구매완료 전에도 지금 조사표를 엑셀·PDF·인쇄로 내보낸다: 체크한 품목이 있으면 그것만, 없으면 지금 목록에 보이는 품목 전체
  const sheetRows = picked.length > 0 ? picked : shown;
  const sheetScope = picked.length > 0 ? `체크한 ${picked.length}개` : `보이는 ${shown.length}개`;
  const unitPriceOf = (p: Prod) => (vatMode === "in" ? unitInclOf(p) : priceOf(p)); // 표에 보이는 단가 (포함가 또는 공급가)
  function exportSurvey() {
    const priceHead = vatMode === "in" ? "포함가(원)" : "공급가(원)";
    const rows: (string | number | null)[][] = sheetRows.map(p => [p.trade, p.category, nameOf(p), links[p.key]?.vendor ?? "", unitOf(p), unitPriceOf(p), qtyOf(p), qtyOf(p) > 0 ? piecesOf(p) : 0, supplyOf(p), vatOf(p), shipOf(p), totalOf(p), links[p.key]?.url ?? ""]);
    rows.push(["합계", "", `${sheetRows.length}개`, "", "", "", sheetRows.reduce((a, x) => a + qtyOf(x), 0), "", sheetRows.reduce((a, x) => a + supplyOf(x), 0), sheetRows.reduce((a, x) => a + vatOf(x), 0), sheetRows.reduce((a, x) => a + shipOf(x), 0), sheetRows.reduce((a, x) => a + totalOf(x), 0), ""]);
    downloadBlob(buildXlsx([{ name: "가격조사", header: ["공정", "카테고리", "품목", "구매처", "판매단위", priceHead, "수량", "총 낱개", "공급가액(원)", "부가세(원)", "배송비(원)", "합계(원)", "구매 링크"], widths: [10, 14, 34, 14, 12, 12, 8, 10, 14, 12, 12, 14, 40], rows }]), `가격조사_${todayKst}.xlsx`);
  }
  const printSurvey = () => void printElement(document.getElementById("pricing-survey-print"), { title: "가격조사", heading: `가격조사 · ${scopeText} · ${todayKst}`, landscape: true });
  const pick = (t: string) => { setSel(t); setCatSel(firstCat(t)); };
  const H = (k: string, content: React.ReactNode, right = false, center = false) => (
    <th className={`${cell} relative ${right ? "text-right" : ""} ${center ? "text-center" : ""}`}>
      {content}
      <span onMouseDown={e => startResize(k, e)} onDoubleClick={() => { const { [k]: _d, ...rest } = colW; saveColW(rest); }} role="separator" aria-orientation="vertical" title="끌어서 열 너비 조절 (두 번 누르면 원래대로)" className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize select-none hover:bg-blue-400/40" />
    </th>
  );
  const th = (w: string, right = false) => `${cell} ${w}${right ? " text-right" : ""}`;

  // 저장·불러오기 줄과 체크 줄은 표 위와 아래에 똑같이 둔다 (목록이 길 때 아래에서도 바로 쓰도록)
  const saveBar = (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <input value={snapName} onChange={e => setSnapName(e.target.value.slice(0, 30))} onKeyDown={e => { if (e.key === "Enter") void snapSave(); }} placeholder="저장본 이름 (예: 11월 구매 계획)" aria-label="저장본 이름" className="w-56 rounded-lg border border-black/15 bg-transparent px-3 py-1.5 outline-none focus:border-blue-500 dark:border-white/15" />
      <button type="button" disabled={busy} onClick={() => void snapSave()} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-50 dark:bg-zinc-800">현재 금액·수량 저장</button>
      <button type="button" onClick={resetSurvey} className="ml-auto rounded-lg bg-amber-100 px-3 py-1.5 font-bold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">새로 조사 시작</button>
      <button type="button" disabled={sheetRows.length === 0} onClick={exportSurvey} title={`${sheetScope} 품목을 엑셀로`} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white disabled:opacity-40">엑셀</button>
      <button type="button" disabled={sheetRows.length === 0} onClick={printSurvey} title={`${sheetScope} 품목을 PDF·인쇄로`} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-40 dark:bg-zinc-800">PDF·인쇄</button>
      <button type="button" onClick={() => saveColW({})} title="표 열 너비를 처음 상태로" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold text-zinc-500 dark:bg-zinc-800">열 너비 초기화</button>
      <button type="button" onClick={() => setVsOpen(true)} title="구매처마다 기본 배송비와 무료배송 기준 금액을 정해요" className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">🚚 구매처 배송비</button>
      <button type="button" onClick={() => setSnapOpen(true)} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">불러오기 {snapshots.length > 0 && <span className="text-zinc-500">{snapshots.length}</span>}</button>
    </div>
  );
  const qtyRows = shown.filter(x => qtyOf(x) > 0);
  const topSum = (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
      <b>수량을 적은 {qtyRows.length}개 · 합계 {won(qtyRows.reduce((a, x) => a + totalOf(x), 0))}원</b>
      <span className="text-xs text-zinc-500">공급가액 {won(qtyRows.reduce((a, x) => a + supplyOf(x), 0))} + 부가세 {won(qtyRows.reduce((a, x) => a + vatOf(x), 0))} + 배송비 {won(qtyRows.reduce((a, x) => a + shipOf(x), 0))} · 품목을 체크하면 체크한 품목만 합산해요</span>
    </div>
  );
  const checkBar = picked.length > 0 ? (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm dark:bg-blue-500/10">
      <b className="text-blue-700 dark:text-blue-300">체크 {picked.length}개 · 합계 {won(total)}원</b>
      <span className="text-xs text-zinc-500">공급가액 {won(totalSupply)} + 부가세 {won(totalVat)} + 배송비 {won(totalShip)}</span>
      <span className="inline-flex items-center gap-1">
        <input value={bulkQty} onChange={e => setBulkQty(digits(e.target.value, 7))} onKeyDown={e => { if (e.key === "Enter") applyBulkQty(); }} inputMode="numeric" placeholder="수량" aria-label="체크한 품목 수량 일괄 변경" className="w-16 rounded-lg border border-black/15 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
        <button type="button" onClick={applyBulkQty} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">선택 수량 전체 변경</button>
      </span>
      <button type="button" onClick={goBuy} className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-extrabold text-white">다음 ▶ 구매하기로 ({picked.filter(p => qtyOf(p) > 0).length}개)</button>
      <button type="button" onClick={excludeChecked} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">조사에서 제외</button>
      <button type="button" onClick={() => setChecked([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">체크 해제</button>
    </div>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">가격조사</h1>
        <span className="text-sm text-zinc-500">{admin ? `모든 공정 · ${kindTab}` : trades.length ? `내 공정: ${trades.join(" · ")}` : ""}</span>
      </div>

      <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-black/10 text-sm dark:border-white/10" role="tablist" aria-label="가격조사 탭">
        {([["survey", "가격조사"], ["buy", `구매하기 ${buyReady.length}`], ["done", `구매완료 ${done.length}`]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-1.5 font-bold ${tab === k ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {tab === "survey"
          ? <><b>공급가</b>(부가세 별도 단가)는 창고장비현황에 등록된 가격 그대로예요 (여기서 고치면 창고장비현황 가격도 바뀌어요). 공급가를 입력하면 <b>부가세(10%)</b>가 자동으로 계산돼요. 부가세 = 공급가 × 수량 × 10%, 합계 = 공급가 × 수량 + 부가세 + 배송비예요. 수량·배송비는 적는 즉시 이 브라우저에 자동 저장돼서 새로고침해도 이어서 보여요 (<b>새로 조사 시작</b>이나 구매완료 때 비워져요). 다른 기기와 나누려면 저장본으로 저장하고 <b>불러오기</b>로 채워요. <b>구매처</b> 칸을 누르면 구매처 이름과 구매 링크를 등록해요. 구매할 품목을 체크하고 아래 <b>다음</b>을 누르면 <b>구매하기</b> 탭으로 옮겨져 구매처별로 정리돼요.</>
          : tab === "buy" ? <>가격조사에서 고른 품목을 <b>구매처별</b>로 묶어 보여 줘요. 구매 사이트 링크로 들어가 구매한 뒤 <b>구매완료</b>를 누르면 수량이 창고장비현황 재고에 더해지고 구매완료 탭에 기록돼요. <b>인쇄</b>로 구매처별 목록을 뽑을 수 있어요.</> : <>구매완료한 내역이에요. 구매한 수량은 이미 창고장비현황 재고에 더해졌어요. 금액을 바꾼 이력은 변경이력 메뉴에서 확인해요.</>}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span className="font-bold">적는 금액 기준</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-black/10 dark:border-white/10" role="radiogroup" aria-label="적는 금액 기준">
          {([["ex", "부가세 별도 (공급가)"], ["in", "부가세 포함 (인터넷 구매가)"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={vatMode === m} onClick={() => pickVatMode(m)} className={`px-2.5 py-1 font-bold ${vatMode === m ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
          ))}
        </div>
        {vatMode === "in" && <span>포함가를 적으면 공급가·부가세를 자동으로 나눠요 (공급가 = 포함가 ÷ 1.1)</span>}
      </div>
      <div className="mt-2 hidden items-center gap-1.5 text-xs text-zinc-500 md:flex">
        행 간격
        <div className="inline-flex overflow-hidden rounded-lg border border-black/10 dark:border-white/10" role="radiogroup" aria-label="행 간격">
          {([["tight", "좁게"], ["normal", "보통"], ["wide", "넓게"]] as const).map(([d, label]) => (
            <button key={d} type="button" role="radio" aria-checked={density === d} onClick={() => pickDensity(d)} className={`px-2.5 py-1 font-bold ${density === d ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
          ))}
        </div>
      </div>

      {err && <p className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">{err}</p>}

      {trades.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-zinc-500 dark:border-white/15">내 팀이 맡은 공정이 아직 없어요. 최고 관리자나 개발팀에 팀의 ‘관여 공정’ 설정을 요청해 주세요.</p>
      ) : tab === "buy" ? (
        <div className="mt-4">
          {cartRows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-zinc-500 dark:border-white/15">구매할 품목이 없어요. <button type="button" onClick={() => setTab("survey")} className="font-bold text-blue-700 underline dark:text-blue-300">가격조사</button> 탭에서 품목을 체크하고 아래 <b>다음</b>을 누르면 이곳으로 옮겨져요.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
                <b>구매할 {buyReady.length}개 · 합계 {won(buyReady.reduce((a, p) => a + totalC(p), 0))}원</b>
                <span className="text-xs text-zinc-500">구매처 {buyGroups.length}곳{cartRows.length > buyReady.length && ` · 수량 없는 ${cartRows.length - buyReady.length}개는 제외`}</span>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={exportBuy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">엑셀</button>
                  <button type="button" disabled={busy || buyReady.length === 0} onClick={() => void buyRows(cartRows, "전체")} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">전체 구매완료</button>
                </span>
              </div>
              {buyGroups.map(([v, rows], gi) => {
                const ready = rows.filter(p => qtyOf(p) > 0);
                const gsum = ready.reduce((a, p) => a + totalC(p), 0);
                const gship = ready.reduce((a, p) => a + shipC(p), 0);
                const free = ready.length > 0 && ready.every(p => cs.freeShip.has(p.key));
                return (
                  <section key={v || "__none"} id={`buy-group-${gi}`} className="mt-4 rounded-xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
                    <div className="flex flex-wrap items-center gap-2 border-b-2 border-zinc-800 pb-2 dark:border-zinc-300">
                      <h2 className="text-base font-extrabold">{v ? vendorChip(v) : <span className="rounded-md bg-zinc-200 px-1.5 py-0.5 text-xs font-bold dark:bg-zinc-700">구매처 미등록</span>}</h2>
                      <span className="text-sm font-bold text-blue-700 dark:text-blue-300">{ready.length}개 · {won(gsum)}원</span>
                      <span className="text-xs text-zinc-500">{free ? "무료배송" : gship > 0 ? `배송비 ${won(gship)}원 포함` : ""}</span>
                      <span className="no-print ml-auto flex gap-1.5">
                        <button type="button" onClick={() => void printElement(document.getElementById(`buy-group-${gi}`), { title: `구매 목록 ${v || "구매처 미등록"}`, heading: `구매 목록 · ${v || "구매처 미등록"} · ${todayKst}`, landscape: true })} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">인쇄·PDF</button>
                        <button type="button" disabled={busy || ready.length === 0} onClick={() => void buyRows(rows, v || "구매처 미등록")} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40">이 구매처 구매완료</button>
                      </span>
                    </div>
                    <div className="no-scrollbar mt-2 overflow-x-auto print-show">
                      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                        <thead>
                          <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
                            <th className={th("w-8") + " text-center"}>#</th>
                            <th className={cell}>품목</th>
                            <th className={th("w-20")}>판매단위</th>
                            <th className={th("w-20", true)}>수량</th>
                            <th className={th("w-24", true)}>{vatMode === "in" ? "포함가" : "공급가"}</th>
                            <th className={th("w-24", true)}>낱개당</th>
                            <th className={th("w-24", true)}>배송비</th>
                            <th className={th("w-24", true)}>합계</th>
                            <th className={th("w-28") + " no-print"}>구매 사이트</th>
                            <th className={th("w-12") + " no-print"} />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p, i) => (
                            <tr key={p.key} className={qtyOf(p) > 0 ? "" : "opacity-50"}>
                              <td className={`${cell} text-center text-xs text-zinc-400`}>{i + 1}</td>
                              <td className={`${cell} font-semibold`} {...peekProps(p)}>{p.name}{p.base && <span className="ml-1 text-xs font-normal text-zinc-500">({unitRaw(p) || "옵션"})</span>}</td>
                              <td className={`${cell} text-xs`}>{unitOf(p) || "—"}</td>
                              <td className={`${cell} ${num} p-0 font-bold`}>{numCell(p, "qty", qtyOf(p), 7, "font-bold")}</td>
                              <td className={`${cell} ${num}`}>{won(vatMode === "in" ? unitInclOf(p) : priceOf(p))}</td>
                              <td className={`${cell} ${num}`}>{qtyOf(p) > 0 ? won(Math.round(perPieceC(p))) : "—"}</td>
                              <td className={`${cell} ${num}`}>{cs.autoShips[p.key] === undefined ? won(shipC(p)) : cs.freeShip.has(p.key) ? <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">무료배송</span> : cs.autoShips[p.key] === 0 ? <span className="text-[11px] text-zinc-400">↑ 합산</span> : won(cs.autoShips[p.key])}</td>
                              <td className={`${cell} ${num} font-bold`}>{won(totalC(p))}</td>
                              <td className={`${cell} no-print`}>{links[p.key]?.url ? <a href={links[p.key].url} target="_blank" rel="noopener noreferrer" className="inline-block whitespace-nowrap rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">구매 사이트 ↗</a> : <span className="text-xs text-zinc-400">링크 없음</span>}</td>
                              <td className={`${cell} no-print text-center`}><button type="button" onClick={() => saveCart(cart.filter(k => k !== p.key))} title="구매하기 목록에서 빼기" aria-label={`${p.name} 빼기`} className="rounded-md px-1.5 py-0.5 text-xs font-bold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10">✕</button></td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/60">
                            <td colSpan={3} className={`${cell} text-right`}>{v || "구매처 미등록"} 합계</td>
                            <td className={`${cell} ${num}`}>{won(ready.reduce((a, p) => a + qtyOf(p), 0))}</td>
                            <td className={cell} />
                            <td className={cell} />
                            <td className={`${cell} ${num}`}>{won(gship)}</td>
                            <td className={`${cell} ${num}`}>{won(gsum)}원</td>
                            <td className={cell + " no-print"} colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </div>
      ) : tab === "survey" ? (
        <>
          <div className="mt-4 flex items-end gap-1 border-b border-black/15 dark:border-white/15" role="tablist" aria-label="품목 종류">
            {(["상비품", "자재"] as const).map(k => (
              <button key={k} type="button" role="tab" aria-selected={kindTab === k} onClick={() => pickKind(k)} className={`rounded-t-lg border border-b-0 px-5 py-2 text-sm font-extrabold ${kindTab === k ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{k} <small className="font-bold opacity-70">{products.filter(p => p.kind === k && !p.base).length}</small></button>
            ))}
          </div>
          {saveBar}
          {hidden.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
              <span className="text-zinc-600 dark:text-zinc-300">제외한 품목 <b>{hidden.length}</b>개 (새로 조사를 시작하기 전까지 숨겨져요)</span>
              <button type="button" onClick={() => saveHidden([])} className="rounded-lg bg-white px-3 py-1 text-xs font-bold dark:bg-zinc-700">모두 되돌리기</button>
            </div>
          )}
          {checkBar ?? topSum}
          <p className="mt-1 text-right text-[11px] text-zinc-500">엑셀·PDF·인쇄는 {picked.length > 0 ? `체크한 ${picked.length}개` : "지금 목록에 보이는 품목 전체"}를 내보내요.</p>
          <div id="pricing-survey-print" className="hidden">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead>
                <tr className="bg-zinc-100">
                  {["#", "품목", "구매처", "판매단위", vatMode === "in" ? "포함가" : "공급가", "수량", "총 낱개", "부가세", "배송비", "합계"].map(h => <th key={h} className="border border-zinc-400 px-1.5 py-1 font-bold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {sheetRows.map((p, i) => (
                  <tr key={p.key}>
                    <td className="border border-zinc-400 px-1.5 py-1 text-center">{i + 1}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 font-semibold">{nameOf(p)}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{links[p.key]?.vendor ?? ""}</td>
                    <td className="border border-zinc-400 px-1.5 py-1">{unitOf(p)}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(unitPriceOf(p))}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right font-bold">{won(qtyOf(p))}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right">{piecesText(p)}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(vatOf(p))}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(shipOf(p))}</td>
                    <td className="border border-zinc-400 px-1.5 py-1 text-right font-bold">{won(totalOf(p))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-100 font-bold">
                  <td colSpan={5} className="border border-zinc-400 px-1.5 py-1 text-right">합계 ({sheetRows.length}개)</td>
                  <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(sheetRows.reduce((a, x) => a + qtyOf(x), 0))}</td>
                  <td className="border border-zinc-400 px-1.5 py-1" />
                  <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(sheetRows.reduce((a, x) => a + vatOf(x), 0))}</td>
                  <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(sheetRows.reduce((a, x) => a + shipOf(x), 0))}</td>
                  <td className="border border-zinc-400 px-1.5 py-1 text-right">{won(sheetRows.reduce((a, x) => a + totalOf(x), 0))}원</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* 좁은 화면(모바일): 표 대신 카드 — 옆으로 밀어야 하는 표는 잘려 보여서 불편하다 */}
          <div className="mt-4 space-y-2 md:hidden">
            <select value={sel} onChange={e => pick(e.target.value)} className="w-full rounded-lg border border-black/15 bg-transparent px-2 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15" aria-label="공정 선택 (모바일)">
              {trades.length !== 1 && <option value="">전체 공정</option>}
              {trades.map(t => <option key={t}>{t}</option>)}
            </select>
            {sel && (
              <div className="no-scrollbar flex items-end gap-1 overflow-x-auto border-b border-black/15 dark:border-white/15" role="tablist" aria-label="카테고리 선택 (모바일)">
                {["", ...cats].map(c => (
                  <button key={c || "__all"} type="button" role="tab" aria-selected={catSel === c} onClick={() => setCatSel(c)} className={`shrink-0 rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${catSel === c ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 text-zinc-600 dark:border-white/15 dark:text-zinc-300"}`}>{c || "전체"}</button>
                ))}
              </div>
            )}
            {shown.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">이 목록에는 {kindTab} 품목이 없어요. 창고장비현황이나 장비조사에서 추가해 주세요.</p>}
            {shown.map((p, i) => {
              const head = i === 0 || shown[i - 1].trade !== p.trade || shown[i - 1].category !== p.category;
              const info = links[p.key];
              if (folded(p)) return null;
              return (
                <Fragment key={p.key}>
                  {head && (
                    <label className="flex cursor-pointer items-center gap-2 px-1 pt-2 text-xs font-extrabold text-blue-700 dark:text-blue-300">
                      <input type="checkbox" aria-label={`${p.category} 전체 체크`} checked={checkedIn(p.trade, p.category) === countIn(p.trade, p.category)} onChange={e => toggle(inGroup(p.trade, p.category).map(x => x.key), e.target.checked)} className="h-5 w-5 accent-blue-600" />
                      <span>{p.trade} › {p.category} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개{checkedIn(p.trade, p.category) > 0 && <> · 체크 {checkedIn(p.trade, p.category)}개 {won(sumIn(p.trade, p.category))}원</>}</span></span>
                    </label>
                  )}
                  <div className={`rounded-xl border p-3 ${on(p) ? "border-blue-300 bg-blue-50/50 dark:border-blue-500/40 dark:bg-blue-500/5" : "border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900"}`}>
                    <div className="flex items-start gap-2.5">
                      <input type="checkbox" aria-label={`${p.name} 합계에 넣기`} checked={on(p)} onChange={e => toggle([p.key], e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5"><span className="shrink-0 text-xs text-zinc-400">{rowNo.get(p.key) ?? i + 1}</span>{nameInput(p, "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-semibold outline-none hover:border-black/15 focus:border-blue-500 dark:hover:border-white/15")}</div>
                        {(compareText(p) || foldBtn(p)) && <div className="flex flex-wrap items-center gap-1 pl-5">{foldBtn(p)}{compareText(p)}</div>}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <button type="button" onClick={() => { setLinkP(p); setLinkVendor(info?.vendor ?? ""); setLinkUnit(info?.unit ?? ""); setLinkUrl(info?.url ?? ""); setErr(""); }} className="text-left text-xs">{info?.vendor ? vendorChip(info.vendor) : <span className="text-zinc-400">구매처 등록</span>}</button>
                          {unitInput(p, "w-24 rounded-md border border-black/15 bg-transparent px-2 py-0.5 text-xs outline-none placeholder:text-zinc-400 focus:border-blue-500 dark:border-white/15")}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([["price", vatMode === "in" ? "포함가" : "공급가", vatMode === "in" ? unitInclOf(p) : p.price, 9], ["qty", "수량", qtyOf(p), 7], ["ship", "배송비", shipOf(p), 7]] as const).map(([f, label, v, max]) => (
                        <div key={f}>
                          <div className="mb-0.5 text-[11px] font-bold text-zinc-500">{label}</div>
                          <div className="overflow-hidden rounded-lg border border-black/15 dark:border-white/15">{f === "ship" ? shipCell(p) : numCell(p, f, v, max, f === "qty" ? "font-bold" : "")}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span>판매단위 {unitOf(p) || "—"}</span>
                      <span className="font-semibold text-zinc-800 dark:text-zinc-100">총 낱개 {piecesText(p)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-zinc-500">
                      <span>공급가액 {won(supplyOf(p))} + 부가세 {won(vatOf(p))} + 배송비 {won(shipOf(p))}</span>
                      <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">합계 {won(totalOf(p))}원</span>
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      {info?.url && <a href={info.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white">구매 사이트 ↗</a>}
                      {!p.base && <button type="button" disabled={busy} onClick={() => void addOpt(p)} className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-bold text-blue-700 disabled:opacity-40 dark:text-blue-300">＋ 판매단위</button>}
                      {p.base && <button type="button" disabled={busy} onClick={() => void delOpt(p)} className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">옵션 삭제</button>}
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="no-scrollbar mt-4 hidden overflow-x-auto rounded-xl border border-black/10 md:block dark:border-white/10">
            <table className="w-full min-w-[56rem] table-fixed border-collapse text-left text-sm">
              <colgroup>{COLS.map(c => <col key={c.k} style={wOf(c.k) ? { width: wOf(c.k) } : undefined} />)}</colgroup>
              <thead>
                <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
                  {H("chk", <input type="checkbox" aria-label="보이는 품목 전체 체크" checked={allOn} onChange={e => toggle(shown.map(x => x.key), e.target.checked)} className="h-4 w-4 accent-blue-600" />, false, true)}
                  {H("no", "#", false, true)}
                  {H("name", "품목")}
                  {H("per", "낱개당", true)}
                  {H("price", vatMode === "in" ? "포함가" : "공급가", true)}
                  {H("qty", "수량", true)}
                  {H("pieces", "총 낱개", true)}
                  {H("vat", "부가세 10%", true)}
                  {H("ship", "배송비", true)}
                  {H("total", "합계", true)}
                  {H("vendor", "구매처")}
                  {H("unit", "판매단위")}
                </tr>
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} colSpan={12}>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                      공정
                      <select value={sel} onChange={e => pick(e.target.value)} className="rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm font-normal outline-none focus:border-blue-500 dark:border-white/15" aria-label="공정 선택">
                        {trades.length !== 1 && <option value="">전체 공정</option>}
                        {trades.map(t => <option key={t}>{t}</option>)}
                      </select>
                      카테고리
                      {sel ? (
                        <div className="flex flex-1 flex-wrap items-end gap-1 border-b border-black/15 dark:border-white/15 self-end" role="tablist" aria-label="카테고리 선택">
                          {["", ...cats].map(c => (
                            <button key={c || "__all"} type="button" role="tab" aria-selected={catSel === c} onClick={() => setCatSel(c)} className={`rounded-t-lg border border-b-0 px-3.5 py-1.5 text-xs font-bold ${catSel === c ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300"}`}>{c || "전체"}</button>
                          ))}
                        </div>
                      ) : <span className="font-normal text-zinc-500">공정을 먼저 선택</span>}
                    </div>
                  </td>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={12} className={`${cell} py-8 text-center text-zinc-500`}>이 목록에는 {kindTab} 품목이 없어요. 창고장비현황이나 장비조사에서 추가해 주세요.</td></tr>
                )}
                {shown.map((p, i) => {
                  const head = i === 0 || shown[i - 1].trade !== p.trade || shown[i - 1].category !== p.category;
                  const info = links[p.key];
                  if (folded(p)) return null;
                  return (
                    <Fragment key={p.key}>
                      {head && (
                        <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                          <td colSpan={12} className="border border-black/10 px-3 py-1.5 text-xs font-extrabold text-blue-700 dark:border-white/10 dark:text-blue-300"><label className="mr-2 inline-flex cursor-pointer items-center gap-1.5 align-middle"><input type="checkbox" aria-label={`${p.category} 전체 체크`} checked={checkedIn(p.trade, p.category) === countIn(p.trade, p.category)} onChange={e => toggle(inGroup(p.trade, p.category).map(x => x.key), e.target.checked)} className="h-4 w-4 accent-blue-600" /></label>{p.trade} › {p.category} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개{checkedIn(p.trade, p.category) > 0 && <> · 체크 {checkedIn(p.trade, p.category)}개 합계 {won(sumIn(p.trade, p.category))}원</>}</span></td>
                        </tr>
                      )}
                      <tr className={`group ${on(p) ? "bg-blue-50/50 dark:bg-blue-500/5" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40"}`}>
                        <td className={`${cell} text-center`}><input type="checkbox" aria-label={`${p.name} 합계에 넣기`} checked={on(p)} onChange={e => toggle([p.key], e.target.checked)} className="h-4 w-4 accent-blue-600" /></td>
                        <td className={`${cell} text-center text-xs text-zinc-400`}>{rowNo.get(p.key) ?? i + 1}</td>
                        <td className={`${cell} relative p-0`} {...peekProps(p)}>{nameInput(p, `w-full bg-transparent px-2.5 ${PADS[density]} text-left text-sm font-semibold outline-none hover:bg-blue-50/70 focus:bg-white focus:ring-2 focus:ring-blue-500 dark:hover:bg-blue-500/10 dark:focus:bg-zinc-900`)}{p.base && <button type="button" disabled={busy} onClick={() => void delOpt(p)} title="이 판매 옵션 지우기" className="absolute right-1 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300">✕ 삭제</button>}{!p.base && <button type="button" disabled={busy} onClick={() => void addOpt(p)} title="같은 품목의 다른 판매단위(묶음·단품) 추가" className="absolute right-1 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 border-blue-600 bg-white px-1.5 py-0.5 text-[11px] font-bold text-blue-700 disabled:opacity-40 dark:bg-zinc-900 dark:text-blue-300">＋단위</button>}{foldBtn(p) && <div className="-mt-0.5 pb-1 pl-2.5">{foldBtn(p)}</div>}</td>
                        <td className={`${cell} ${num} text-xs`} title={qtyOf(p) > 0 ? "부가세·배송비를 포함한 실제 낱개당 원가" : "부가세 포함 단가 ÷ 입수"}>{priceOf(p) > 0 ? <><span className="font-semibold">{won(Math.round(perPiece(p)))}원</span>{hasOpts(p) && cheapest(p) && <b className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">최저</b>}{qtyOf(p) > 0 && <div className="text-[10px] text-zinc-400">배송비 포함</div>}</> : <span className="text-zinc-400">—</span>}</td>
                        <td className={`${cell} ${num} p-0`}>{numCell(p, "price", vatMode === "in" ? unitInclOf(p) : p.price, 9)}</td>
                        <td className={`${cell} ${num} p-0 font-bold`}>{numCell(p, "qty", qtyOf(p), 7, "font-bold")}</td>
                        <td className={`${cell} ${num} text-xs`}><div className="font-semibold">{piecesText(p)}</div></td>
                        <td className={`${cell} ${num} text-zinc-600 dark:text-zinc-300`}>{won(vatOf(p))}</td>
                        <td className={`${cell} ${num} p-0`}>{shipCell(p)}</td>
                        <td className={`${cell} ${num} font-bold`}>{won(totalOf(p))}</td>
                        <td className={`${cell} overflow-hidden p-0`}>
                          <div className="flex items-center"><button type="button" onClick={() => { setLinkP(p); setLinkVendor(info?.vendor ?? ""); setLinkUnit(info?.unit ?? ""); setLinkUrl(info?.url ?? ""); setErr(""); }} title="눌러서 구매처·판매단위·구매 링크 등록" className={`block min-w-0 flex-1 truncate px-2.5 ${PADS[density]} text-left hover:bg-blue-50/70 dark:hover:bg-blue-500/10`}>{info?.vendor ? vendorChip(info.vendor) : <span className="text-zinc-400">구매처 등록</span>}</button>{info?.url && <a href={info.url} target="_blank" rel="noopener noreferrer" title={`${info.vendor || "구매 사이트"} 바로가기 (새 탭)`} aria-label={`${p.name} 구매 사이트 바로가기`} className="mr-1 shrink-0 rounded-md bg-orange-500 px-1.5 py-0.5 text-[11px] font-bold text-white hover:bg-orange-600">↗</a>}</div>
                        </td>
                        <td className={`${cell} overflow-hidden p-0`}>
                          {unitInput(p, `w-full bg-transparent px-2.5 ${PADS[density]} text-left text-sm outline-none placeholder:text-zinc-400 hover:bg-blue-50/70 focus:bg-white focus:ring-2 focus:ring-blue-500 dark:hover:bg-blue-500/10 dark:focus:bg-zinc-900`)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              {shown.length > 0 && (
                <tfoot>
                  <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/60">
                    <td colSpan={5} className={`${cell} text-right`}>{picked.length > 0 ? `체크한 ${picked.length}개 합계` : "체크한 품목이 없어요 · 합계할 품목을 체크하세요"}</td>
                    <td className={`${cell} ${num}`}>{won(totalQty)}</td>
                    <td className={cell} />
                    <td className={`${cell} ${num}`}>{won(totalVat)}</td>
                    <td className={`${cell} ${num}`}>{won(totalShip)}</td>
                    <td className={`${cell} ${num}`}>{won(total)}원</td>
                    <td className={cell} colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {checkBar ?? <p className="mt-3 text-xs text-zinc-500">체크한 품목이 없어요. 품목을 체크하면 합계와 구매완료 버튼이 여기에도 나와요.</p>}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
            <input value={snapName} onChange={e => setSnapName(e.target.value.slice(0, 30))} onKeyDown={e => { if (e.key === "Enter") void snapSave(); }} placeholder="저장본 이름 (예: 11월 구매 계획)" aria-label="저장본 이름 (아래)" className="w-56 rounded-lg border border-black/15 bg-transparent px-3 py-1.5 outline-none focus:border-blue-500 dark:border-white/15" />
            <button type="button" disabled={busy} onClick={() => void snapSave()} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-50 dark:bg-zinc-800">현재 금액·수량 저장</button>
          </div>
          {err && <p className="mt-2 text-right text-sm font-semibold text-red-600 dark:text-red-300" role="alert">{err}</p>}
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <input type="date" value={dFrom} onChange={e => setDFrom(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-2.5 py-1.5 dark:border-white/15" aria-label="시작일" />
            <span className="text-zinc-400">~</span>
            <input type="date" value={dTo} onChange={e => setDTo(e.target.value)} className="rounded-lg border border-black/15 bg-transparent px-2.5 py-1.5 dark:border-white/15" aria-label="종료일" />
            {(dFrom || dTo) && <button type="button" onClick={() => { setDFrom(""); setDTo(""); }} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">전체 기간</button>}
            {(dFrom !== todayKst || dTo !== todayKst) && <button type="button" onClick={() => { setDFrom(todayKst); setDTo(todayKst); }} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">오늘</button>}
            <span className="text-xs text-zinc-500">{scopeText} · {days.length}일 · {doneShown.length}건 · 합계 {won(amount(doneShown))}원</span>
            <div className="ml-auto flex gap-1.5">
              {days.length > 0 && <button type="button" onClick={() => setOpenDays(openDays.length === days.length ? [] : [...days])} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">{openDays.length === days.length ? "모두 접기" : "모두 펼치기"}</button>}
              <button type="button" disabled={doneShown.length === 0} onClick={() => exportDone(doneShown, `${dFrom || "처음"}_${dTo || "현재"}`)} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white disabled:opacity-40">전체 엑셀</button>
              <button type="button" disabled={doneShown.length === 0} onClick={() => void printElement(document.getElementById("pricing-done-all"), { title: "구매 내역서", heading: `구매 내역서 · ${scopeText}`, landscape: true })} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-40 dark:bg-zinc-800">전체 PDF·인쇄</button>
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">PDF·인쇄를 누르면 인쇄 창이 열려요. 프린터로 출력하거나, 대상에서 “PDF로 저장”을 고르면 PDF 파일로 저장돼요.</p>

          {days.length === 0 && <p className="mt-4 rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-zinc-500 dark:border-white/15">{dFrom || dTo ? "이 기간에 구매완료한 내역이 없어요. “전체 기간”을 눌러 다른 날짜를 확인해 보세요." : "구매완료한 내역이 없어요."}</p>}
          <div id="pricing-done-all" className="mt-4 space-y-5">
            {days.map(d => {
              const list = byDay.get(d)!;
              const m = money(list);
              return (
                <section key={d} id={`pricing-done-${d}`} className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                  <div className={`flex flex-wrap items-center gap-2 ${openDays.includes(d) ? "border-b-2 border-zinc-800 pb-2 dark:border-zinc-300" : ""}`}>
                    <button type="button" onClick={() => setOpenDays(o => (o.includes(d) ? o.filter(x => x !== d) : [...o, d]))} aria-expanded={openDays.includes(d)} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-left">
                      <span className="w-4 text-xs text-zinc-500" aria-hidden>{openDays.includes(d) ? "▼" : "▶"}</span>
                      <h2 className="text-lg font-extrabold">구매 내역서</h2>
                      <span className="text-sm font-bold">{dayLabel(d)}</span>
                      <span className="text-xs text-zinc-500">{scopeText}</span>
                      <span className="text-sm font-bold text-blue-700 dark:text-blue-300">{list.length}건 · {won(m.total)}원</span>
                    </button>
                    <div className="ml-auto flex gap-1.5 no-print">
                      <button type="button" onClick={() => exportDone(list, d)} className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">엑셀</button>
                      {admin && <button type="button" disabled={busy} onClick={() => void deleteDay(d, list)} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-40 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                      <button type="button" onClick={() => void printElement(document.getElementById(`pricing-done-${d}`), { title: `구매 내역서 ${d}`, heading: `구매 내역서 · ${dayLabel(d)}`, landscape: true })} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">PDF·인쇄</button>
                    </div>
                  </div>
                  <div className={`no-scrollbar mt-2 overflow-x-auto print-show ${openDays.includes(d) ? "" : "hidden"}`}>
                    <div className="space-y-2 md:hidden">
                      {list.map((e, i) => {
                        const em = entryMoney(e);
                        return (
                          <div key={e.id} className="rounded-lg border border-black/10 p-2.5 text-sm dark:border-white/10">
                            <div className="break-words font-semibold"><span className="mr-1.5 text-xs font-normal text-zinc-400">{i + 1}</span>{e.name}</div>
                            <div className="text-xs text-zinc-500">{e.category} › {e.productCategory || "—"}{e.vendor ? <> · {vendorChip(e.vendor)}</> : ""}{e.unit ? ` · ${e.unit}` : ""} · {e.byName} {when(e.createdAt).slice(11)}</div>
                            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-zinc-600 dark:text-zinc-300">
                              <span>{won(e.price)} × {won(e.qty)} + 부가세 {won(em.vat)} + 배송비 {won(em.ship)}</span>
                              <b className="text-sm text-zinc-900 dark:text-zinc-50">{won(em.total)}원</b>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-between rounded-lg bg-zinc-100 px-3 py-2 text-sm font-bold dark:bg-zinc-800"><span>합계 ({list.length}건 · 수량 {won(qtySum(list))})</span><span>{won(m.total)}원</span></div>
                    </div>
                    <table className="hidden w-full min-w-[60rem] table-fixed border-collapse text-left text-sm md:table">
                      <thead>
                        <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
                          <th className={th("w-9") + " text-center"}>#</th>
                          <th className={th("w-[5.5rem]")}>공정</th>
                          <th className={th("w-[6.5rem]")}>카테고리</th>
                          <th className={cell}>품목</th>
                          <th className={th("w-24")}>구매처</th>
                          <th className={th("w-[5.5rem]", true)}>공급가</th>
                          <th className={th("w-[3.75rem]", true)}>수량</th>
                          <th className={th("w-20", true)}>부가세</th>
                          <th className={th("w-20", true)}>배송비</th>
                          <th className={th("w-24", true)}>합계</th>
                          <th className={th("w-28")}>구매한 사람</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((e, i) => {
                          const em = entryMoney(e);
                          return (
                            <tr key={e.id}>
                              <td className={`${cell} text-center text-xs text-zinc-400`}>{i + 1}</td>
                              <td className={`${cell} whitespace-nowrap`}>{e.category}</td>
                              <td className={`${cell} whitespace-nowrap`}>{e.productCategory || "—"}</td>
                              <td className={`${cell} font-semibold`}>{e.name}</td>
                              <td className={`${cell} truncate`}>{e.vendor ? vendorChip(e.vendor) : <span className="text-zinc-400">—</span>}{e.unit && <span className="ml-1 text-xs text-zinc-500">{e.unit}</span>}</td>
                              <td className={`${cell} ${num}`}>{won(e.price)}</td>
                              <td className={`${cell} ${num} font-bold`}>{won(e.qty)}</td>
                              <td className={`${cell} ${num}`}>{won(em.vat)}</td>
                              <td className={`${cell} ${num}`}>{won(em.ship)}</td>
                              <td className={`${cell} ${num} font-bold`}>{won(em.total)}</td>
                              <td className={`${cell} whitespace-nowrap text-xs`}>{e.byName} · {when(e.createdAt).slice(11)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/60">
                          <td colSpan={6} className={`${cell} text-right`}>합계 ({list.length}건)</td>
                          <td className={`${cell} ${num}`}>{won(qtySum(list))}</td>
                          <td className={`${cell} ${num}`}>{won(m.vat)}</td>
                          <td className={`${cell} ${num}`}>{won(m.ship)}</td>
                          <td className={`${cell} ${num}`}>{won(m.total)}원</td>
                          <td className={cell} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              );
            })}
            {days.length > 1 && (
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-bold dark:bg-zinc-800">
                <span>기간 합계</span>
                <span>수량 {won(qtySum(doneShown))}</span>
                <span>공급가 {won(money(doneShown).supply)}</span>
                <span>부가세 {won(money(doneShown).vat)}</span>
                <span>배송비 {won(money(doneShown).ship)}</span>
                <span>합계 {won(amount(doneShown))}원</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* 품목 사진 미리보기 (이름에 마우스를 올렸을 때) */}
      {peek && (
        <div className="pointer-events-none fixed z-50 rounded-xl border border-black/10 bg-white p-1.5 shadow-2xl dark:border-white/15 dark:bg-zinc-900" style={{ left: Math.max(8, peek.x - 150), top: Math.max(8, Math.min(peek.y - 60, (typeof window !== "undefined" ? window.innerHeight : 800) - 150)) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={peek.src} alt="" className="h-28 w-28 rounded-lg bg-white object-contain" />
        </div>
      )}

      {/* 구매처별 배송비·무료배송 기준 */}
      <Modal open={vsOpen} onClose={() => !busy && setVsOpen(false)} wide>
        <h2 className="text-lg font-bold">구매처 배송비 설정</h2>
        <p className="mt-1 text-sm text-zinc-500">구매처마다 <b>기본 배송비</b>와 <b>무료배송 기준</b>(물품 합계, 부가세 포함)을 적어 두면, 수량을 적은 같은 구매처 품목의 합계가 기준 이상일 때 <b>무료배송</b>으로, 미달이면 기본 배송비를 품목 금액 비율로 나눠 자동 계산해요. 설정이 없는 구매처는 배송비를 직접 적어요.</p>
        {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={vsQ} onChange={e => setVsQ(e.target.value.slice(0, 40))} placeholder="🔍 구매처 검색" aria-label="구매처 검색" className="min-w-[10rem] flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
          <input value={vsNew} onChange={e => setVsNew(e.target.value.slice(0, 40))} onKeyDown={e => { if (e.key === "Enter") void addVendor(); }} placeholder="새 구매처 이름" aria-label="새 구매처 이름" className="min-w-[9rem] flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
          <button type="button" disabled={busy || !vsNew.trim()} onClick={() => void addVendor()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">+ 구매처 등록</button>
        </div>
        {(() => {
          const q = normV(vsQ).replace(/\s+/g, "");
          const list = usageNames.filter(n => !q || normV(n).replace(/\s+/g, "").includes(q));
          return (
            <ul className="mt-3 max-h-[55vh] divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
              {list.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">{q ? "검색 결과가 없어요. 위에서 새 구매처로 등록할 수 있어요." : "등록된 구매처가 아직 없어요. 위에서 구매처를 등록해 주세요."}</li>}
              {list.map(name => {
                const k = normV(name), cur = vsMap[k], d = vsDraft[k];
                const feeV = d?.fee ?? (cur?.fee ? String(cur.fee) : ""), freeV = d?.free ?? (cur?.freeOver ? String(cur.freeOver) : "");
                const set = (patch: Partial<{ fee: string; free: string }>) => setVsDraft(x => ({ ...x, [k]: { fee: feeV, free: freeV, ...patch } }));
                return (
                  <li key={k} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                    <span className="min-w-[7rem] flex-1">{vendorChip(name)}</span>
                    <label className="flex items-center gap-1 text-xs font-bold text-zinc-500">기본 배송비
                      <input value={feeV} onChange={e => set({ fee: digits(e.target.value, 7) })} inputMode="numeric" placeholder="0" aria-label={`${name} 기본 배송비`} className="w-24 rounded-md border border-black/15 bg-transparent px-2 py-1 text-right text-sm font-normal outline-none focus:border-blue-500 dark:border-white/15" />원
                    </label>
                    <label className="flex items-center gap-1 text-xs font-bold text-zinc-500">무료 기준
                      <input value={freeV} onChange={e => set({ free: digits(e.target.value, 9) })} inputMode="numeric" placeholder="없음" aria-label={`${name} 무료배송 기준`} className="w-28 rounded-md border border-black/15 bg-transparent px-2 py-1 text-right text-sm font-normal outline-none focus:border-blue-500 dark:border-white/15" />원 이상
                    </label>
                    <button type="button" disabled={busy || !d} onClick={() => void saveVs(name)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-30">저장</button>
                  </li>
                );
              })}
            </ul>
          );
        })()}
        <div className="mt-4"><button type="button" onClick={() => setVsOpen(false)} className="w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button></div>
      </Modal>

      {/* 저장해 둔 금액·수량 불러오기 */}
      <Modal open={snapOpen} onClose={() => !busy && setSnapOpen(false)} wide>
        <h2 className="text-lg font-bold">저장한 금액·수량 불러오기</h2>
        <p className="mt-1 text-sm text-zinc-500">저장해 둔 구매 예정 수량·배송비·제외한 품목으로 채워요. 금액은 바꾸지 않고 지금 창고장비현황 가격을 그대로 써요.</p>
        {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
        <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
          {snapshots.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">저장해 둔 금액·수량이 없어요. 목록에서 “현재 금액·수량 저장”을 눌러 보세요.</li>}
          {snapshots.map(s => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="mr-auto min-w-0">
                <div className="truncate font-bold">{s.name}</div>
                <div className="text-xs text-zinc-500">{when(s.at)} · {s.byName} · {s.count}개 품목{s.excluded > 0 && ` · 제외 ${s.excluded}개`}</div>
              </div>
              <button type="button" disabled={busy} onClick={() => void snapLoad(s)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">불러오기</button>
              <button type="button" disabled={busy} onClick={() => void snapDelete(s)} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300">삭제</button>
            </li>
          ))}
        </ul>
        <div className="mt-4"><button type="button" onClick={() => setSnapOpen(false)} className="w-full rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button></div>
      </Modal>

      {/* 구매처·구매 링크 등록: 구매처 칸을 누르면 열린다. 링크를 등록하면 줄 오른쪽에 '구매하기' 버튼이 생긴다 */}
      <Modal open={linkP !== null} onClose={() => !busy && setLinkP(null)}>
        {linkP && (
          <>
            <h2 className="text-lg font-bold">구매처 · 판매단위 · 구매 링크</h2>
            <p className="mt-1 text-sm text-zinc-500">{linkP.name}</p>
            {vendorChips.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-bold text-zinc-500">자주 가는 구매처 <span className="font-normal">· 눌러서 채우기 · ★로 고정(모두 같이 써요)</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {vendorChips.map(c => (
                    <span key={c.name} className={`inline-flex items-center overflow-hidden rounded-lg text-sm font-bold ${vendorColor(c.name)}`}>
                      <button type="button" onClick={() => setLinkVendor(c.name)} className="px-2.5 py-1">{c.name}</button>
                      <button type="button" disabled={busy} onClick={() => void toggleFav(c.name, !c.fav)} aria-label={c.fav ? `${c.name} 고정 해제` : `${c.name} 자주 가는 구매처로 고정`} title={c.fav ? "고정 해제" : "자주 가는 구매처로 고정"} className="border-l border-black/10 px-1.5 py-1 disabled:opacity-50 dark:border-white/10">{c.fav ? "★" : "☆"}</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <label className="mt-3 block text-sm font-bold" htmlFor="pvendor">구매처</label>
            <input id="pvendor" value={linkVendor} onChange={e => setLinkVendor(e.target.value.slice(0, 40))} onKeyDown={e => { if (e.key === "Enter") void saveLink(linkUrl, linkVendor, linkUnit); }} autoFocus placeholder="예: 쿠팡, ○○철물" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            <label className="mt-3 block text-sm font-bold" htmlFor="punit">판매단위 <span className="font-normal text-zinc-500">(예: 박스, 10개입, 롤)</span></label>
            <input id="punit" value={linkUnit} onChange={e => setLinkUnit(e.target.value.slice(0, 20))} onKeyDown={e => { if (e.key === "Enter") void saveLink(linkUrl, linkVendor, linkUnit); }} placeholder="판매 단위" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            <label className="mt-3 block text-sm font-bold" htmlFor="plink">구매 링크 <span className="font-normal text-zinc-500">(선택)</span></label>
            <input id="plink" value={linkUrl} onChange={e => setLinkUrl(e.target.value.slice(0, 2000))} onKeyDown={e => { if (e.key === "Enter") void saveLink(linkUrl, linkVendor, linkUnit); }} inputMode="url" placeholder="https://…" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex gap-2">
              {(links[linkP.key]?.url || links[linkP.key]?.vendor || links[linkP.key]?.unit) && <button type="button" disabled={busy} onClick={() => void saveLink("", "", "")} className="rounded-xl bg-red-50 px-4 py-3 font-bold text-red-600 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
              <button type="button" disabled={busy} onClick={() => setLinkP(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void saveLink(linkUrl, linkVendor, linkUnit)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">저장</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
