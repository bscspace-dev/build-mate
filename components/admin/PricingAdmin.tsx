"use client";

import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { printElement } from "@/lib/print-client";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-export";
import type { InventoryEntry } from "@/lib/types";

type Prod = { key: string; trade: string; category: string; name: string; price: number };
type Entry = InventoryEntry & { productCategory: string };
type Info = { url: string; vendor: string };
type Field = "price" | "qty" | "ship";

const PICK_KEY = "bm_pricing_pick";
const BASE = "border border-black/10 px-2.5 dark:border-white/10";
// 행 간격(칸 위아래 여백): 좁게 / 보통 / 넓게
const PADS = { tight: "py-0.5", normal: "py-1.5", wide: "py-3.5" } as const;
type Density = keyof typeof PADS;
const DENSITY_KEY = "bm_row_density";
const HIDE_KEY = "bm_pricing_hidden"; // 조사에서 제외한 품목 (새로 조사를 시작할 때까지 유지)
const VAT_RATE = 0.1; // 부가세 10%
const num = "text-right tabular-nums";
const won = (n: number) => n.toLocaleString("ko-KR");
const digits = (s: string, max: number) => s.replace(/\D/g, "").slice(0, max);
const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16);
const vatOn = (supply: number) => Math.round(supply * VAT_RATE);
/** 구매 기록 한 건의 공급가액·부가세·배송비·합계 */
const entryMoney = (e: { price: number; qty: number; shipping: number }) => { const supply = e.price * e.qty; const vat = vatOn(supply); return { supply, vat, ship: e.shipping, total: supply + vat + e.shipping }; };

// 가격조사: 장비조사와 같은 상비품 목록(공정 → 카테고리)에 금액·수량·부가세·배송비·합계를 적는다.
//  · 공급가(부가세 별도 단가)는 창고장비현황의 품목 가격과 같다. 고치면 창고장비현황 가격도 바뀐다.
//  · 부가세 = 공급가 × 수량 × 10% (공급가를 입력하면 자동 계산), 합계 = 공급가 × 수량 + 부가세 + 배송비.
//  · 수량·배송비는 '구매 예정' 값으로 열 때마다 0에서 시작한다. 저장해 둔 값을 불러오면 그 값으로 채워진다.
//  · 구매처 칸을 누르면 구매처 이름과 구매 링크를 등록한다 (품목마다 한 번만, 바꿀 때까지 유지).
//  · 구매완료를 누르면 수량이 창고장비현황 재고에 더해지고, 구매완료 탭에 구매처·배송비와 함께 남는다.
export default function PricingAdmin({ trades, categories, products, log, links, snapshots, admin }: { trades: string[]; categories: Record<string, string[]>; products: Prod[]; log: Entry[]; links: Record<string, Info>; snapshots: { id: string; name: string; at: string; byName: string; count: number; excluded: number }[]; admin: boolean }) {
  const router = useRouter();
  const [density, setDensity] = useState<Density>("normal");
  useEffect(() => { try { const v = localStorage.getItem(DENSITY_KEY); if (v === "tight" || v === "normal" || v === "wide") setDensity(v); } catch { /* 저장이 막힌 환경 */ } }, []);
  const pickDensity = (d: Density) => { setDensity(d); try { localStorage.setItem(DENSITY_KEY, d); } catch { /* 저장이 막힌 환경 */ } };
  const cell = `${BASE} ${PADS[density]}`;
  const [tab, setTab] = useState<"survey" | "done">("survey");
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
    setDraft({});
    setChecked([]);
    saveHidden([]);
  }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
  //  · 금액은 창고장비현황 가격으로 저장되고, 수량·배송비는 이 화면에서만 들고 있는다 (열 때마다 0에서 시작).
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [ships, setShips] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, Partial<Record<Field, string>>>>({});
  const priceOf = (p: Prod) => (draft[p.key]?.price !== undefined ? Number(draft[p.key].price || 0) : p.price);
  const qtyOf = (p: { key: string }) => (draft[p.key]?.qty !== undefined ? Number(draft[p.key].qty || 0) : qtys[p.key] ?? 0);
  const shipOf = (p: { key: string }) => (draft[p.key]?.ship !== undefined ? Number(draft[p.key].ship || 0) : ships[p.key] ?? 0);
  const supplyOf = (p: Prod) => priceOf(p) * qtyOf(p); // 공급가액
  const vatOf = (p: Prod) => vatOn(supplyOf(p)); // 부가세
  const totalOf = (p: Prod) => supplyOf(p) + vatOf(p) + shipOf(p); // 합계
  async function commit(p: Prod) {
    const d = draft[p.key];
    if (!d) return;
    const np = priceOf(p);
    const clear = () => setDraft(x => { const { [p.key]: _drop, ...rest } = x; return rest; });
    if (d.qty !== undefined) setQtys(x => ({ ...x, [p.key]: Number(d.qty || 0) }));
    if (d.ship !== undefined) setShips(x => ({ ...x, [p.key]: Number(d.ship || 0) }));
    if (np === p.price) return clear();
    if (await post({ action: "rename", key: p.key, name: p.name, price: np })) router.refresh(); // 금액은 창고장비현황 가격으로 저장
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
  async function saveLink(url: string, vendor: string) {
    if (!linkP) return;
    if (await post({ action: "link", key: linkP.key, url, vendor })) {
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
    if (!window.confirm(`“${s.name}” (${s.count}개 품목${s.excluded > 0 ? ` · 제외 ${s.excluded}개` : ""})을 불러올까요?\n저장해 둔 금액·수량·배송비·제외 상태 그대로 바뀌어요. 금액은 창고장비현황 가격에도 반영돼요.`)) return;
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
  async function buy(p: Prod) {
    if (qtyOf(p) <= 0) {
      // 수량이 아직 없으면 그 줄의 수량 칸으로 보내 준다
      setErr("수량을 먼저 적어 주세요. 수량 칸에 숫자를 입력한 뒤 구매완료를 눌러요.");
      const els = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-qty="${p.key}"]`));
      (els.find(x => x.offsetParent !== null) ?? els[0])?.focus(); // 표·카드 중 지금 보이는 쪽
      return;
    }
    const q = qtyOf(p);
    if (!window.confirm(`“${p.name}” ${q}개를 구매완료로 처리할까요?\n합계 ${won(totalOf(p))}원 (공급가액 ${won(supplyOf(p))} + 부가세 ${won(vatOf(p))} + 배송비 ${won(shipOf(p))})\n창고장비현황 재고에 ${q}개가 더해져요.`)) return;
    if (await post({ action: "buy", key: p.key, qty: q, ship: shipOf(p) })) {
      setQtys(x => ({ ...x, [p.key]: 0 })); // 구매완료하면 수량·배송비는 다시 0
      setShips(x => ({ ...x, [p.key]: 0 }));
      router.refresh();
    }
  }
  // 체크한 품목을 한꺼번에 구매완료 (수량이 적힌 것만)
  async function buyChecked() {
    const list = picked.filter(p => qtyOf(p) > 0);
    if (list.length === 0) return setErr("체크한 품목 중 수량이 적힌 품목이 없어요.");
    const skip = picked.length - list.length;
    const sum = list.reduce((a, p) => a + totalOf(p), 0);
    if (!window.confirm(`체크한 ${list.length}개를 구매완료로 처리할까요?\n합계 ${won(sum)}원 (부가세·배송비 포함) · 수량이 창고장비현황 재고에 더해져요.${skip > 0 ? `\n(수량이 없는 ${skip}개는 건너뛰어요)` : ""}`)) return;
    if (await post({ action: "buyMany", items: list.map(p => ({ key: p.key, qty: qtyOf(p), ship: shipOf(p) })) })) {
      setQtys(x => ({ ...x, ...Object.fromEntries(list.map(p => [p.key, 0])) })); // 구매완료하면 수량·배송비는 다시 0
      setShips(x => ({ ...x, ...Object.fromEntries(list.map(p => [p.key, 0])) }));
      setChecked([]);
      router.refresh();
    }
  }
  const cats = sel ? categories[sel] ?? [] : [];
  const catRank = (p: Prod) => (categories[p.trade] ?? []).indexOf(p.category);
  const shown = products
    .filter(p => (!sel || p.trade === sel) && (!catSel || p.category === catSel) && !hidden.includes(p.key))
    .map((p, i) => ({ p, i }))
    .sort((x, y) => trades.indexOf(x.p.trade) - trades.indexOf(y.p.trade) || catRank(x.p) - catRank(y.p) || x.i - y.i)
    .map(x => x.p);
  const on = (p: Prod) => checked.includes(p.key);
  const inGroup = (t: string, c: string) => shown.filter(x => x.trade === t && x.category === c);
  const sumIn = (t: string, c: string) => inGroup(t, c).filter(on).reduce((a, x) => a + totalOf(x), 0);
  const checkedIn = (t: string, c: string) => inGroup(t, c).filter(on).length;
  const countIn = (t: string, c: string) => inGroup(t, c).length;
  const picked = shown.filter(on);
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
    const rows: (string | number | null)[][] = sorted.map(e => { const m = entryMoney(e); return [day(e.createdAt), when(e.createdAt).slice(11), e.category, e.productCategory || "", e.name, e.vendor || "", e.price, e.qty, m.vat, m.ship, m.total, e.byName]; });
    const all = money(sorted);
    rows.push(["합계", "", "", "", `${sorted.length}건`, "", "", qtySum(sorted), all.vat, all.ship, all.total, ""]);
    const daily = [...new Set(sorted.map(e => day(e.createdAt)))].map(d => { const l = sorted.filter(e => day(e.createdAt) === d); const m = money(l); return [d, l.length, qtySum(l), m.supply, m.vat, m.ship, m.total] as (string | number)[]; });
    daily.push(["합계", sorted.length, qtySum(sorted), all.supply, all.vat, all.ship, all.total]);
    downloadBlob(buildXlsx([
      { name: "구매내역", header: ["구매일", "시각", "공정", "카테고리", "품목", "구매처", "공급가(원)", "수량", "부가세(원)", "배송비(원)", "합계(원)", "구매한 사람"], widths: [12, 8, 12, 16, 36, 16, 12, 8, 12, 12, 14, 12], rows },
      { name: "일자별 합계", header: ["구매일", "건수", "수량", "공급가 합계(원)", "부가세(원)", "배송비(원)", "합계(원)"], widths: [12, 8, 8, 14, 12, 12, 14], rows: daily },
    ]), `구매내역_${label}.xlsx`);
  }

  const pick = (t: string) => { setSel(t); setCatSel(firstCat(t)); };
  const th = (w: string, right = false) => `${cell} ${w}${right ? " text-right" : ""}`;

  // 저장·불러오기 줄과 체크 줄은 표 위와 아래에 똑같이 둔다 (목록이 길 때 아래에서도 바로 쓰도록)
  const saveBar = (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
      <input value={snapName} onChange={e => setSnapName(e.target.value.slice(0, 30))} onKeyDown={e => { if (e.key === "Enter") void snapSave(); }} placeholder="저장본 이름 (예: 11월 구매 계획)" aria-label="저장본 이름" className="w-56 rounded-lg border border-black/15 bg-transparent px-3 py-1.5 outline-none focus:border-blue-500 dark:border-white/15" />
      <button type="button" disabled={busy} onClick={() => void snapSave()} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold disabled:opacity-50 dark:bg-zinc-800">현재 금액·수량 저장</button>
      <button type="button" onClick={resetSurvey} className="ml-auto rounded-lg bg-amber-100 px-3 py-1.5 font-bold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">새로 조사 시작</button>
      <button type="button" onClick={() => setSnapOpen(true)} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">불러오기 {snapshots.length > 0 && <span className="text-zinc-500">{snapshots.length}</span>}</button>
    </div>
  );
  const checkBar = picked.length > 0 ? (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm dark:bg-blue-500/10">
      <b className="text-blue-700 dark:text-blue-300">체크 {picked.length}개 · 합계 {won(total)}원</b>
      <span className="text-xs text-zinc-500">공급가액 {won(totalSupply)} + 부가세 {won(totalVat)} + 배송비 {won(totalShip)}</span>
      <button type="button" disabled={busy} onClick={() => void buyChecked()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">체크한 항목 구매완료</button>
      <button type="button" onClick={excludeChecked} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">조사에서 제외</button>
      <button type="button" onClick={() => setChecked([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">체크 해제</button>
    </div>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">가격조사</h1>
        <span className="text-sm text-zinc-500">{admin ? "모든 공정 · 상비품" : trades.length ? `내 공정: ${trades.join(" · ")}` : ""}</span>
      </div>

      <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-black/10 text-sm dark:border-white/10" role="tablist" aria-label="가격조사 탭">
        {([["survey", "가격조사"], ["done", `구매완료 ${done.length}`]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-1.5 font-bold ${tab === k ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {tab === "survey"
          ? <><b>공급가</b>(부가세 별도 단가)는 창고장비현황에 등록된 가격 그대로예요 (여기서 고치면 창고장비현황 가격도 바뀌어요). 공급가를 입력하면 <b>부가세(10%)</b>가 자동으로 계산돼요. 부가세 = 공급가 × 수량 × 10%, 합계 = 공급가 × 수량 + 부가세 + 배송비예요. 수량·배송비는 열 때마다 0에서 시작하고, 저장해 둔 값은 <b>불러오기</b>로 채워요. <b>구매처</b> 칸을 누르면 구매처 이름과 구매 링크를 등록해요. <b>구매완료</b>를 누르면 수량이 창고장비현황 재고에 더해지고 수량·배송비는 0으로 돌아가요.</>
          : <>구매완료한 내역이에요. 구매한 수량은 이미 창고장비현황 재고에 더해졌어요. 금액을 바꾼 이력은 변경이력 메뉴에서 확인해요.</>}
      </p>

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
      ) : tab === "survey" ? (
        <>
          {saveBar}
          {hidden.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
              <span className="text-zinc-600 dark:text-zinc-300">제외한 품목 <b>{hidden.length}</b>개 (새로 조사를 시작하기 전까지 숨겨져요)</span>
              <button type="button" onClick={() => saveHidden([])} className="rounded-lg bg-white px-3 py-1 text-xs font-bold dark:bg-zinc-700">모두 되돌리기</button>
            </div>
          )}
          {checkBar}
          {/* 좁은 화면(모바일): 표 대신 카드 — 옆으로 밀어야 하는 표는 잘려 보여서 불편하다 */}
          <div className="mt-4 space-y-2 md:hidden">
            <div className="grid grid-cols-2 gap-2">
              <select value={sel} onChange={e => pick(e.target.value)} className="w-full rounded-lg border border-black/15 bg-transparent px-2 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15" aria-label="공정 선택 (모바일)">
                {trades.length !== 1 && <option value="">전체 공정</option>}
                {trades.map(t => <option key={t}>{t}</option>)}
              </select>
              <select value={catSel} onChange={e => setCatSel(e.target.value)} disabled={!sel} className="w-full rounded-lg border border-black/15 bg-transparent px-2 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/15" aria-label="카테고리 선택 (모바일)">
                <option value="">{sel ? "전체 카테고리" : "공정을 먼저"}</option>
                {cats.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            {shown.length === 0 && <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">내 공정에 상비품이 없어요. 창고장비현황이나 장비조사에서 추가해 주세요.</p>}
            {shown.map((p, i) => {
              const head = i === 0 || shown[i - 1].trade !== p.trade || shown[i - 1].category !== p.category;
              const info = links[p.key];
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
                        <div className="break-words font-semibold"><span className="mr-1.5 text-xs font-normal text-zinc-400">{i + 1}</span>{p.name}</div>
                        <button type="button" onClick={() => { setLinkP(p); setLinkVendor(info?.vendor ?? ""); setLinkUrl(info?.url ?? ""); setErr(""); }} className={`mt-0.5 text-xs underline-offset-2 hover:underline ${info?.vendor ? "font-semibold text-zinc-700 dark:text-zinc-200" : "text-zinc-400"}`}>구매처: {info?.vendor || "등록"}</button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([["price", "공급가", p.price, 9], ["qty", "수량", qtyOf(p), 7], ["ship", "배송비", shipOf(p), 7]] as const).map(([f, label, v, max]) => (
                        <div key={f}>
                          <div className="mb-0.5 text-[11px] font-bold text-zinc-500">{label}</div>
                          <div className="overflow-hidden rounded-lg border border-black/15 dark:border-white/15">{numCell(p, f, v, max, f === "qty" ? "font-bold" : "")}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-zinc-500">
                      <span>공급가액 {won(supplyOf(p))} + 부가세 {won(vatOf(p))} + 배송비 {won(shipOf(p))}</span>
                      <span className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">합계 {won(totalOf(p))}원</span>
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      {info?.url && <a href={info.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white">구매하기</a>}
                      <button type="button" disabled={busy || draft[p.key] !== undefined} onClick={() => void buy(p)} className={`rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-35 ${qtyOf(p) > 0 ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>구매완료</button>
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="no-scrollbar mt-4 hidden overflow-x-auto rounded-xl border border-black/10 md:block dark:border-white/10">
            <table className="w-full min-w-[60rem] table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
                  <th className={th("w-9", false) + " text-center"}><input type="checkbox" aria-label="보이는 품목 전체 체크" checked={allOn} onChange={e => toggle(shown.map(x => x.key), e.target.checked)} className="h-4 w-4 accent-blue-600" /></th>
                  <th className={th("w-9") + " text-center"}>#</th>
                  <th className={th("w-[5.5rem]")}>공정</th>
                  <th className={th("w-[6.5rem]")}>카테고리</th>
                  <th className={cell}>품목</th>
                  <th className={th("w-[5.5rem]", true)}>공급가</th>
                  <th className={th("w-[3.75rem]", true)}>수량</th>
                  <th className={th("w-20", true)}>부가세 10%</th>
                  <th className={th("w-20", true)}>배송비</th>
                  <th className={th("w-24", true)}>합계</th>
                  <th className={th("w-24")}>구매처</th>
                  <th className={th("w-36")} />
                </tr>
                <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                  <td className={cell} colSpan={2} />
                  <td className={cell}>
                    <select value={sel} onChange={e => pick(e.target.value)} className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" aria-label="공정 선택">
                      {trades.length !== 1 && <option value="">전체 공정</option>}
                      {trades.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={cell}>
                    <select value={catSel} onChange={e => setCatSel(e.target.value)} disabled={!sel} className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:border-white/15" aria-label="카테고리 선택">
                      <option value="">{sel ? "전체 카테고리" : "공정을 먼저 선택"}</option>
                      {cats.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className={cell} colSpan={8} />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr><td colSpan={12} className={`${cell} py-8 text-center text-zinc-500`}>내 공정에 상비품이 없어요. 창고장비현황이나 장비조사에서 추가해 주세요.</td></tr>
                )}
                {shown.map((p, i) => {
                  const head = i === 0 || shown[i - 1].trade !== p.trade || shown[i - 1].category !== p.category;
                  const info = links[p.key];
                  return (
                    <Fragment key={p.key}>
                      {head && (
                        <tr className="bg-blue-50/60 dark:bg-blue-500/10">
                          <td colSpan={12} className="border border-black/10 px-3 py-1.5 text-xs font-extrabold text-blue-700 dark:border-white/10 dark:text-blue-300"><label className="mr-2 inline-flex cursor-pointer items-center gap-1.5 align-middle"><input type="checkbox" aria-label={`${p.category} 전체 체크`} checked={checkedIn(p.trade, p.category) === countIn(p.trade, p.category)} onChange={e => toggle(inGroup(p.trade, p.category).map(x => x.key), e.target.checked)} className="h-4 w-4 accent-blue-600" /></label>{p.trade} › {p.category} <span className="font-normal text-zinc-500">{countIn(p.trade, p.category)}개{checkedIn(p.trade, p.category) > 0 && <> · 체크 {checkedIn(p.trade, p.category)}개 합계 {won(sumIn(p.trade, p.category))}원</>}</span></td>
                        </tr>
                      )}
                      <tr className={on(p) ? "bg-blue-50/50 dark:bg-blue-500/5" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40"}>
                        <td className={`${cell} text-center`}><input type="checkbox" aria-label={`${p.name} 합계에 넣기`} checked={on(p)} onChange={e => toggle([p.key], e.target.checked)} className="h-4 w-4 accent-blue-600" /></td>
                        <td className={`${cell} text-center text-xs text-zinc-400`}>{i + 1}</td>
                        <td className={`${cell} whitespace-nowrap`}>{p.trade}</td>
                        <td className={`${cell} whitespace-nowrap`}>{p.category}</td>
                        <td className={`${cell} font-semibold`}>{p.name}</td>
                        <td className={`${cell} ${num} p-0`}>{numCell(p, "price", p.price, 9)}</td>
                        <td className={`${cell} ${num} p-0 font-bold`}>{numCell(p, "qty", qtyOf(p), 7, "font-bold")}</td>
                        <td className={`${cell} ${num} text-zinc-600 dark:text-zinc-300`}>{won(vatOf(p))}</td>
                        <td className={`${cell} ${num} p-0`}>{numCell(p, "ship", shipOf(p), 7)}</td>
                        <td className={`${cell} ${num} font-bold`}>{won(totalOf(p))}</td>
                        <td className={`${cell} overflow-hidden p-0`}>
                          <button type="button" onClick={() => { setLinkP(p); setLinkVendor(info?.vendor ?? ""); setLinkUrl(info?.url ?? ""); setErr(""); }} title="눌러서 구매처·구매 링크 등록" className={`block w-full truncate px-2.5 ${PADS[density]} text-left hover:bg-blue-50/70 dark:hover:bg-blue-500/10 ${info?.vendor ? "font-semibold" : "text-zinc-400"}`}>{info?.vendor || "구매처 등록"}</button>
                        </td>
                        <td className={`${cell} text-center`}>
                          <div className="flex justify-end gap-1">
                            {info?.url && <a href={info.url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-orange-500 px-2.5 py-1 text-xs font-bold text-white hover:bg-orange-600">구매하기</a>}
                            <button type="button" disabled={busy || draft[p.key] !== undefined} onClick={() => void buy(p)} title={qtyOf(p) <= 0 ? "수량을 먼저 적어 주세요" : undefined} className={`rounded-md px-2.5 py-1 text-xs font-bold disabled:opacity-35 ${qtyOf(p) > 0 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>구매완료</button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              {shown.length > 0 && (
                <tfoot>
                  <tr className="bg-zinc-50 font-bold dark:bg-zinc-800/60">
                    <td colSpan={6} className={`${cell} text-right`}>{picked.length > 0 ? `체크한 ${picked.length}개 합계` : "체크한 품목이 없어요 · 합계할 품목을 체크하세요"}</td>
                    <td className={`${cell} ${num}`}>{won(totalQty)}</td>
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
                            <div className="text-xs text-zinc-500">{e.category} › {e.productCategory || "—"}{e.vendor ? ` · ${e.vendor}` : ""} · {e.byName} {when(e.createdAt).slice(11)}</div>
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
                              <td className={`${cell} whitespace-nowrap`}>{e.vendor || <span className="text-zinc-400">—</span>}</td>
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

      {/* 저장해 둔 금액·수량 불러오기 */}
      <Modal open={snapOpen} onClose={() => !busy && setSnapOpen(false)} wide>
        <h2 className="text-lg font-bold">저장한 금액·수량 불러오기</h2>
        <p className="mt-1 text-sm text-zinc-500">저장해 둔 금액·구매 예정 수량·배송비·제외한 품목 그대로 되돌려요. 금액은 창고장비현황 가격에도 반영돼요.</p>
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
            <h2 className="text-lg font-bold">구매처 · 구매 링크</h2>
            <p className="mt-1 text-sm text-zinc-500">{linkP.name}</p>
            <label className="mt-3 block text-sm font-bold" htmlFor="pvendor">구매처</label>
            <input id="pvendor" value={linkVendor} onChange={e => setLinkVendor(e.target.value.slice(0, 40))} onKeyDown={e => { if (e.key === "Enter") void saveLink(linkUrl, linkVendor); }} autoFocus placeholder="예: 쿠팡, ○○철물" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            <label className="mt-3 block text-sm font-bold" htmlFor="plink">구매 링크 <span className="font-normal text-zinc-500">(선택)</span></label>
            <input id="plink" value={linkUrl} onChange={e => setLinkUrl(e.target.value.slice(0, 2000))} onKeyDown={e => { if (e.key === "Enter") void saveLink(linkUrl, linkVendor); }} inputMode="url" placeholder="https://…" className="mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            {err && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex gap-2">
              {(links[linkP.key]?.url || links[linkP.key]?.vendor) && <button type="button" disabled={busy} onClick={() => void saveLink("", "")} className="rounded-xl bg-red-50 px-4 py-3 font-bold text-red-600 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
              <button type="button" disabled={busy} onClick={() => setLinkP(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void saveLink(linkUrl, linkVendor)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">저장</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
