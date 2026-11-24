/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { shrink } from "@/components/admin/AddProduct";
import { buildXlsx, downloadBlob } from "@/lib/xlsx-export";
import { printElement } from "@/lib/print-client";
import type { Expense, ExpenseCategory, ExpenseDoc, ExpensePay } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const CATS: { v: ExpenseCategory; label: string }[] = [
  { v: "meal", label: "식사" },
  { v: "drink", label: "음료" },
  { v: "materials", label: "자재구매" },
  { v: "fuel", label: "유류비" },
  { v: "parking", label: "주차·통행" },
  { v: "supplies", label: "공구·소모품" },
  { v: "other", label: "기타" },
];
const DOCS: { v: ExpenseDoc; label: string }[] = [{ v: "receipt", label: "영수증" }, { v: "invoice", label: "세금계산서" }, { v: "request", label: "구매요청" }];
const PAYS: { v: ExpensePay; label: string }[] = [{ v: "card", label: "카드" }, { v: "cash", label: "현금" }, { v: "transfer", label: "계좌이체" }];
const MAX_PHOTOS = 4;
const won = (n: number) => n.toLocaleString("ko-KR") + "원";
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : "");

type Form = { date: string; site: string; category: ExpenseCategory; amount: string; memo: string; docType: ExpenseDoc; vendor: string; payMethod: ExpensePay; link: string; account: string };
const EMPTY = (date: string): Form => ({ date, site: "", category: "meal", amount: "", memo: "", docType: "receipt", vendor: "", payMethod: "card", link: "", account: "" });
type Picked = { id: number; file: File; url: string };

// 경비관리: 영수증·세금계산서를 사진으로 올리거나, 인터넷으로 사야 하는 비품을 「구매요청」으로 올린다.
// 구매요청은 담당자(전체 조회·수정 권한)가 구매하고 영수증 사진을 올려 「완료」로 처리한다. 경리는 이 목록을 엑셀로 정리한다.
export default function ExpensesAdmin({ items, sites, myId, isAll, canRegister, canEditAny, canDeleteAny }: { items: Expense[]; sites: string[]; myId: string; isAll: boolean; canRegister: boolean; canEditAny: boolean; canDeleteAny: boolean }) {
  const router = useRouter();
  const today = fmt(new Date());
  const [month, setMonth] = useState<string>(today.slice(0, 7)); // "" = 전체 기간
  const [siteSel, setSiteSel] = useState("");
  const [catSel, setCatSel] = useState<"" | ExpenseCategory>("");
  const [docSel, setDocSel] = useState<"" | ExpenseDoc>("");
  const [statSel, setStatSel] = useState<"" | "requested" | "done">(""); // 구매요청의 상태
  const [whoSel, setWhoSel] = useState("");
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; e: Expense } | { t: "done"; e: Expense } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null); // 상세 창으로 열어 둔 서류
  const [view, setView] = useState<{ urls: string[]; i: number } | null>(null); // 크게 보는 사진 (여러 장이면 넘겨 본다)
  const [f, setF] = useState<Form>(EMPTY(today));
  const [keep, setKeep] = useState<string[]>([]);
  const [fresh, setFresh] = useState<Picked[]>([]);
  const [dAmount, setDAmount] = useState(""); // 구매 완료 때 실제 금액
  const [dVendor, setDVendor] = useState(""); // 구매 완료 때 구매처
  const [dPay, setDPay] = useState<"" | ExpensePay>(""); // 구매 완료 때 결제수단 (꼭 골라야 한다)
  const [dFresh, setDFresh] = useState<Picked[]>([]); // 구매 완료 때 올리는 영수증 사진
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const isReq = (e: Expense) => e.docType === "request";
  const tracked = (e: Expense) => isReq(e) || e.status === "requested" || e.booked; // 진행 상태가 있는 서류: 구매요청(구매 대기 → 구매 완료), 계좌이체 입금 요청(입금 요청 → 구매 완료), 그 밖의 서류(확인 대기 → 확인 완료)
  const pending = (e: Expense) => e.status === "requested";
  const checkerOf = (e: Expense) => (tracked(e) && !pending(e) ? e.bookedBy : ""); // 확인(구매·입금 완료 처리)한 사람
  const stateLabel = (e: Expense) => (isReq(e) ? (pending(e) ? "구매 대기" : "구매 완료") : e.account ? (pending(e) ? "입금 요청" : "구매 완료") : pending(e) ? "확인 대기" : "확인 완료"); // 구매요청 / 입금 요청(계좌이체) / 그 밖 서류
  const docLabel = (e: Expense) => DOCS.find(d => d.v === e.docType)!.label;
  const catLabel = (c: ExpenseCategory) => CATS.find(x => x.v === c)!.label;
  const inMonth = items.filter(e => !month || e.date.startsWith(month));
  const people = [...new Map(items.map(e => [e.memberId, e.memberName])).entries()];
  const shown = inMonth
    .filter(e => (!siteSel || e.site === siteSel) && (!catSel || e.category === catSel) && (!whoSel || e.memberId === whoSel) && (!docSel || e.docType === docSel) && (!statSel || (tracked(e) && e.status === statSel)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const spent = (l: Expense[]) => l.filter(e => !pending(e)).reduce((n, e) => n + e.amount, 0); // 지출 합계: 구매 대기 중인 요청은 아직 쓰지 않은 돈이라 뺀다
  const planned = (l: Expense[]) => l.filter(pending).reduce((n, e) => n + e.amount, 0);
  const pendingAll = items.filter(pending).length;
  const siteNames = [...new Set(items.map(e => e.site))].sort((a, b) => a.localeCompare(b, "ko")); // 현장 걸러 보기용
  const move = (n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); setMonth(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); };
  const detail = detailId ? items.find(e => e.id === detailId) : undefined;

  const mine = (e: Expense) => e.memberId === myId && canRegister && (!tracked(e) || e.status === "requested"); // 내 서류 (구매요청·세금계산서는 완료되기 전까지)
  const mayEdit = (e: Expense) => canEditAny || mine(e);
  const mayDel = (e: Expense) => canDeleteAny || mine(e);

  async function call(fd: FormData | Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/expenses", fd instanceof FormData ? { method: "POST", body: fd } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fd) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(done);
      setTimeout(() => setToast(""), 2500);
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const revoke = (list: Picked[]) => list.forEach(p => URL.revokeObjectURL(p.url));
  const resetPhotos = (existing: string[]) => { revoke(fresh); setFresh([]); setKeep(existing); };
  const maxPhotos = f.docType === "request" ? 8 : MAX_PHOTOS; // 구매요청은 완료할 때 영수증 사진이 더해져 최대 8장
  // 새 서류는 항상 빈 양식으로 시작한다
  const openForm = (e: Expense | null) => {
    setErr("");
    setF(e ? { date: e.date, site: e.site, category: e.category, amount: e.amount ? String(e.amount) : "", memo: e.memo, docType: e.docType, vendor: e.vendor, payMethod: e.payMethod, link: e.link, account: e.account } : EMPTY(today));
    resetPhotos(e?.photos ?? []);
    setDlg({ t: "form", id: e?.id ?? null });
  };
  const close = () => { if (!busy) { resetPhotos([]); revoke(dFresh); setDFresh([]); setDlg(null); } };
  const pick = (list: FileList | null, cur: Picked[], setCur: (u: (p: Picked[]) => Picked[]) => void, room: number) => {
    if (!list) return;
    const picked = [...list]; // 입력칸을 비우면 FileList 도 비워지므로 먼저 배열로 복사
    setCur(prev => [...prev, ...picked.slice(0, Math.max(0, room - cur.length)).map((file, i) => ({ id: Date.now() + i, file, url: URL.createObjectURL(file) }))]);
  };
  const dropFrom = (id: number, setCur: (u: (p: Picked[]) => Picked[]) => void) => setCur(prev => { const x = prev.find(p => p.id === id); if (x) URL.revokeObjectURL(x.url); return prev.filter(p => p.id !== id); });
  const formId = dlg?.t === "form" ? dlg.id : null;
  const photoCount = keep.length + fresh.length;
  const isRequestForm = f.docType === "request";
  const needsAccount = !isRequestForm && f.payMethod === "transfer" && !canEditAny; // 일부 권한만 있는 사람이 계좌이체를 고르면 입금할 계좌번호를 적는다
  const roomForm = Math.min(MAX_PHOTOS, maxPhotos - keep.length); // 한 번에 올리는 사진은 최대 4장

  async function appendPhotos(fd: FormData, list: Picked[], name: string) {
    for (const p of list) {
      const blob = await shrink(p.file, 1600); // 영수증 글씨가 읽히도록 조금 크게
      fd.append("photo", new File([blob], blob.type === "image/webp" ? `${name}.webp` : `${name}.jpg`, { type: blob.type }));
    }
  }
  async function submit() {
    if (busy) return;
    const fd = new FormData();
    fd.set("action", formId ? "update" : "add");
    if (formId) { fd.set("id", formId); fd.set("keep", JSON.stringify(keep)); }
    (Object.keys(f) as (keyof Form)[]).forEach(k => fd.set(k, f[k]));
    try { await appendPhotos(fd, fresh, "receipt"); } catch { return setErr("사진을 처리하지 못했어요. 다른 사진으로 해 보세요."); }
    if (await call(fd, formId ? "수정했어요" : isRequestForm ? "구매를 요청했어요" : needsAccount ? "입금을 요청했어요" : "서류를 올렸어요")) { resetPhotos([]); setDlg(null); }
  }
  // 구매 완료: 영수증 사진을 올리고 실제 금액·구매처를 확인해 완료로 바꾼다
  const openDone = (e: Expense) => { setDetailId(null); setErr(""); setDAmount(e.amount ? String(e.amount) : ""); setDVendor(e.vendor); setDPay(""); revoke(dFresh); setDFresh([]); setDlg({ t: "done", e }); };
  async function submitDone(e: Expense) {
    const inv = !isReq(e); // 영수증·세금계산서는 확인만 (사진·결제수단 불필요)
    if (busy || (!inv && (dFresh.length < 1 || !dPay))) return;
    const fd = new FormData();
    fd.set("action", "complete");
    fd.set("id", e.id);
    fd.set("amount", dAmount);
    fd.set("vendor", dVendor);
    if (!inv) fd.set("payMethod", dPay);
    try { await appendPhotos(fd, dFresh, "receipt"); } catch { return setErr("사진을 처리하지 못했어요. 다른 사진으로 해 보세요."); }
    if (await call(fd, inv ? (e.account ? "입금을 확인하고 구매 완료로 처리했어요" : "확인했어요") : "구매 완료로 처리했어요")) { revoke(dFresh); setDFresh([]); setDlg(null); }
  }

  // 지금 화면에 보이는 서류를 엑셀로 내려받는다 (날짜순). 사진은 주소로 넣어서, 경리가 눌러 확인한다.
  function exportXlsx() {
    const abs = (u: string) => (u.startsWith("/") && typeof window !== "undefined" ? window.location.origin + u : u);
    const list = [...shown].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const payOf = (p: ExpensePay) => PAYS.find(x => x.v === p)!.label;
    const detailSheet = { name: "경비내역", header: ["날짜", "현장", "서류", "상태", "분류", "상호·거래처", "금액(원)", "결제수단", "내용", "요청자", "확인", "등록일", "링크", "입금 계좌", "사진 주소"], widths: [12, 18, 11, 9, 11, 20, 13, 10, 30, 14, 12, 12, 40, 30, 60], rows: list.map(e => [e.date, e.site, docLabel(e), tracked(e) ? stateLabel(e) : "", catLabel(e.category), e.vendor, e.amount, payOf(e.payMethod), e.memo, e.memberName, checkerOf(e), e.createdAt.slice(0, 10), e.link, e.account, e.photos.map(abs).join("  ")]) };
    const done = list.filter(e => !pending(e));
    const tally = (key: (e: Expense) => string) => { const m = new Map<string, { n: number; total: number }>(); for (const e of done) { const c = m.get(key(e)) ?? { n: 0, total: 0 }; m.set(key(e), { n: c.n + 1, total: c.total + e.amount }); } return [...m.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k || "현장 미지정", v.n, v.total]); };
    const bySiteSheet = { name: "현장별 합계", header: ["현장", "건수", "금액(원)"], widths: [24, 8, 14], rows: [...tally(e => e.site), ["합계", done.length, spent(list)]] };
    const byCatSheet = { name: "분류별 합계", header: ["분류", "건수", "금액(원)"], widths: [16, 8, 14], rows: [...tally(e => catLabel(e.category)), ["합계", done.length, spent(list)]] };
    downloadBlob(buildXlsx([detailSheet, bySiteSheet, byCatSheet]), `경비내역_${month || "전체"}.xlsx`);
  }

  const statePill = (e: Expense) => tracked(e) ? <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${pending(e) ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"}`}>{stateLabel(e)}</span> : null;
  const actionBtns = (e: Expense) => (
    <span className="flex flex-wrap items-center gap-2">
      {canEditAny && pending(e) && <button type="button" disabled={busy} onClick={() => openDone(e)} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{isReq(e) ? "구매 완료" : e.account ? "입금 확인" : "확인"}</button>}
      {mayEdit(e) && <button type="button" onClick={() => { setDetailId(null); openForm(e); }} className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold dark:bg-zinc-800">수정</button>}
      {mayDel(e) && <button type="button" onClick={() => { setDetailId(null); setErr(""); setDlg({ t: "del", e }); }} className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
    </span>
  );
  const picker = (list: Picked[], setList: (u: (p: Picked[]) => Picked[]) => void, room: number, existing?: React.ReactNode) => (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {existing}
      {list.map(p => (
        <span key={p.id} className="relative">
          <img src={p.url} alt="새로 고른 사진" className="h-24 w-20 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
          <button type="button" aria-label="사진 빼기" onClick={() => dropFrom(p.id, setList)} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-black/75 text-xs font-bold text-white">✕</button>
        </span>
      ))}
      {list.length < room && (
        <label className="flex h-24 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-400 text-xs font-bold text-blue-700 dark:text-blue-300">
          <span className="text-2xl" aria-hidden>📷</span>사진 추가
          <input type="file" accept="image/*" multiple className="sr-only" onChange={ev => { pick(ev.target.files, list, setList, room); ev.target.value = ""; }} />
        </label>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-2 py-5">
        <h1 className="mr-auto text-xl font-extrabold">경비관리</h1>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">📷 서류 올리기</button>}
        {canEditAny && <button type="button" onClick={exportXlsx} disabled={shown.length === 0} className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">📊 엑셀로 내려받기</button>}
        <button type="button" onClick={() => void printElement(document.getElementById("expense-ledger"), { title: "경비 내역", heading: `경비 내역 · ${month ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : "전체 기간"}`, landscape: true })} disabled={shown.length === 0} className="rounded-xl border border-black/15 px-4 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15">🖨 인쇄</button>
      </header>

      {pendingAll > 0 && statSel !== "requested" && (
        <button type="button" onClick={() => { setMonth(""); setDocSel(""); setStatSel("requested"); }} className="mb-3 flex w-full items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-left text-sm font-bold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          확인 대기 중인 서류(구매요청·입금요청 포함)가 {pendingAll}건 있어요 <span className="ml-auto text-xs font-semibold underline">{canEditAny ? "확인하고 처리하기" : "보기"}</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="이전 달" disabled={!month} onClick={() => move(-1)} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-sm font-bold disabled:opacity-30 dark:border-white/15">◀</button>
          <span className="min-w-[8rem] text-center text-sm font-extrabold">{month ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : "전체 기간"}</span>
          <button type="button" aria-label="다음 달" disabled={!month} onClick={() => move(1)} className="rounded-lg border border-black/15 px-2.5 py-1.5 text-sm font-bold disabled:opacity-30 dark:border-white/15">▶</button>
          <button type="button" onClick={() => setMonth(month ? "" : today.slice(0, 7))} className="ml-1 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold dark:bg-zinc-800">{month ? "전체 기간" : "이번 달"}</button>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <select aria-label="서류" value={docSel} onChange={e => setDocSel(e.target.value as typeof docSel)} className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="">모든 서류</option>
            {DOCS.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
          </select>
          <select aria-label="상태" value={statSel} onChange={e => setStatSel(e.target.value as typeof statSel)} className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="">모든 상태</option>
            <option value="requested">대기 중 ({pendingAll})</option>
            <option value="done">구매 완료</option>
          </select>
          {siteNames.length > 1 && (
            <select aria-label="현장" value={siteSel} onChange={e => setSiteSel(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="">모든 현장</option>
              {siteNames.map(n => <option key={n} value={n}>{n || "현장 미지정"}</option>)}
            </select>
          )}
          <select aria-label="분류" value={catSel} onChange={e => setCatSel(e.target.value as "" | ExpenseCategory)} className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="">모든 분류</option>
            {CATS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
          {isAll && people.length > 1 && (
            <select aria-label="요청자" value={whoSel} onChange={e => setWhoSel(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="">모든 요청자</option>
              {people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          )}
        </div>
      </div>

      {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && !dlg && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}

      <p className="mt-3 text-sm text-zinc-500">{shown.length}건 · 지출 합계 <b className="text-zinc-900 dark:text-zinc-100">{won(spent(shown))}</b>{planned(shown) > 0 && <span> · 확인 대기 {shown.filter(pending).length}건 ({won(planned(shown))})</span>}</p>
      {items.length === 0 && <p className="mt-3 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">올린 서류가 없어요.{canRegister ? " 위의 “서류 올리기”로 사진을 올리거나 구매요청을 해 주세요." : ""}</p>}
      {items.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">해당하는 서류가 없어요.</p>}

      {/* 인쇄 전용 목록: 화면에는 보이지 않는다 */}
      <div id="expense-ledger" className="hidden">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
          <thead>
            <tr>{["날짜", "현장", "서류", "상태", "분류", "상호·거래처", "금액(원)", "결제", "내용", "요청자", "확인"].map(h => <th key={h} style={{ border: "1px solid #999", background: "#eee", padding: "3px 4px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {[...shown].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)).map(e => (
              <tr key={e.id}>
                {[e.date, e.site, docLabel(e), tracked(e) ? stateLabel(e) : "", catLabel(e.category), e.vendor, e.amount.toLocaleString("ko-KR"), PAYS.find(p => p.v === e.payMethod)!.label, e.memo, e.memberName, checkerOf(e)].map((c, i) => <td key={i} style={{ border: "1px solid #999", padding: "3px 4px", verticalAlign: "top", textAlign: i === 6 ? "right" : "left", whiteSpace: i === 8 ? "pre-line" : "nowrap" }}>{c}</td>)}
              </tr>
            ))}
            <tr>
              <td colSpan={6} style={{ border: "1px solid #999", padding: "3px 4px", fontWeight: 700, textAlign: "right" }}>지출 합계 {shown.filter(e => !pending(e)).length}건</td>
              <td style={{ border: "1px solid #999", padding: "3px 4px", fontWeight: 700, textAlign: "right" }}>{spent(shown).toLocaleString("ko-KR")}</td>
              <td colSpan={4} style={{ border: "1px solid #999" }} />
            </tr>
          </tbody>
        </table>
      </div>

      {shown.length > 0 && (
        <>
          {/* 넓은 화면: 엑셀처럼 한 줄에 한 건. 줄을 누르면 상세(전체 내용·사진·링크·처리 버튼)가 열린다 */}
          <div className="mt-2 hidden overflow-hidden rounded-2xl border border-black/10 bg-white md:block dark:border-white/10 dark:bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-bold text-zinc-500 dark:bg-zinc-800/60">
                <tr>
                  {["날짜", "현장", "서류", "상태", "분류", "상호·거래처", "금액", "내용", "요청자", "확인"].map(h => <th key={h} className={`whitespace-nowrap px-3 py-2.5 ${h === "금액" ? "text-right" : ""}`}>{h}</th>)}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {shown.map(e => (
                  <tr key={e.id} tabIndex={0} onClick={() => setDetailId(e.id)} onKeyDown={ev => { if (ev.key === "Enter") setDetailId(e.id); }} className={`cursor-pointer border-t border-black/10 align-middle hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-800/50 ${pending(e) ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2.5">{e.date.slice(5).replace("-", "/")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{e.site || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{docLabel(e)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{statePill(e) ?? <span className="text-zinc-400">-</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{catLabel(e.category)}</td>
                    <td className="px-3 py-2.5">{e.vendor || <span className="text-zinc-400">-</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-extrabold">{won(e.amount)}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-300">{e.memo || <span className="text-zinc-400">-</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{e.memberName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{checkerOf(e) || <span className="text-zinc-400">-</span>}</td>
                    <td className="px-2 py-2.5 text-zinc-400" aria-hidden>›</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/20 bg-zinc-50 font-extrabold dark:border-white/20 dark:bg-zinc-800/60">
                  <td colSpan={6} className="px-3 py-2.5 text-right">지출 합계 {shown.filter(e => !pending(e)).length}건</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">{won(spent(shown))}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 휴대폰: 한 건을 세 줄로, 누르면 상세 */}
          <ul className="mt-2 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-white md:hidden dark:divide-white/10 dark:border-white/10 dark:bg-zinc-900">
            {shown.map(e => (
              <li key={e.id} className={pending(e) ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}>
                <button type="button" onClick={() => setDetailId(e.id)} className="block w-full px-3 py-2.5 text-left text-sm">
                  <span className="flex items-baseline gap-2"><b className="min-w-0 flex-1 truncate">{e.site || "현장 미지정"}</b><b className="shrink-0 text-base font-extrabold">{won(e.amount)}</b></span>
                  <span className="block truncate text-xs text-zinc-600 dark:text-zinc-300">{e.date.slice(5).replace("-", "/")} · {docLabel(e)}{pending(e) && ` (${stateLabel(e)})`} · {catLabel(e.category)}{e.vendor && ` · ${e.vendor}`}</span>
                  {e.memo && <span className="block truncate text-xs text-zinc-500">{e.memo}</span>}
                  <span className="block text-xs text-zinc-500">요청 {e.memberName}{checkerOf(e) && ` · 확인 ${checkerOf(e)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* 상세 */}
      <Modal open={detail !== undefined} onClose={() => setDetailId(null)} wide>
        {detail && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 break-words text-lg font-bold">{detail.site || "현장 미지정"} · {docLabel(detail)} {statePill(detail)}</h2>
              <b className="text-xl font-extrabold text-blue-700 dark:text-blue-300">{won(detail.amount)}</b>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div><dt className="text-xs font-bold text-zinc-500">{isReq(detail) && pending(detail) ? "요청일" : "날짜"}</dt><dd className="font-semibold">{detail.date}</dd></div>
              <div><dt className="text-xs font-bold text-zinc-500">분류</dt><dd className="font-semibold">{catLabel(detail.category)}</dd></div>
              <div><dt className="text-xs font-bold text-zinc-500">{isReq(detail) ? "구매처" : "상호·거래처"}</dt><dd className="font-semibold">{detail.vendor || "-"}</dd></div>
              {!isReq(detail) || !pending(detail) ? <div><dt className="text-xs font-bold text-zinc-500">결제수단</dt><dd className="font-semibold">{PAYS.find(p => p.v === detail.payMethod)!.label}</dd></div> : null}
              <div><dt className="text-xs font-bold text-zinc-500">요청자</dt><dd className="font-semibold">{detail.memberName} · {detail.createdAt.slice(0, 10)}</dd></div>
              {tracked(detail) && !pending(detail) && detail.bookedBy && <div><dt className="text-xs font-bold text-zinc-500">확인</dt><dd className="font-semibold">{detail.bookedBy} · {detail.bookedAt.slice(0, 10)}</dd></div>}
              {!isReq(detail) && detail.account && (
                <div className="col-span-2"><dt className="text-xs font-bold text-zinc-500">입금할 계좌</dt><dd className="flex flex-wrap items-center gap-2 text-base font-extrabold">{detail.account}<button type="button" onClick={() => { void navigator.clipboard?.writeText(detail.account).then(() => { setToast("계좌번호를 복사했어요"); setTimeout(() => setToast(""), 2000); }).catch(() => undefined); }} className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-bold dark:border-white/15">복사</button></dd></div>
              )}
            </dl>
            {detail.memo && <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"><span className="mr-1.5 text-xs font-bold text-zinc-500">{isReq(detail) ? "사유" : "내용"}</span>{detail.memo}</p>}
            {detail.photos.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-bold text-zinc-500">{isReq(detail) && !pending(detail) ? "영수증·요청 사진" : isReq(detail) ? "요청 사진" : "원본 확인"}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {detail.photos.map((u, i) => <button key={u} type="button" onClick={() => setView({ urls: detail.photos, i })} aria-label={`사진 ${i + 1} 크게 보기`}><img src={u} alt="" loading="lazy" className="h-20 w-20 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" /></button>)}
                </div>
                {!isReq(detail) && <p className="mt-1 text-xs text-zinc-500">금액이 빠졌거나 맞지 않을 때 원본과 비교해 확인하세요.</p>}
              </div>
            )}
            {isReq(detail) && safeHref(detail.link) && <a href={safeHref(detail.link)} target="_blank" rel="noopener noreferrer" className="mt-3 block rounded-xl bg-blue-600 py-3 text-center font-bold text-white hover:bg-blue-700">{canEditAny ? "구매하러 가기" : "요청한 링크로 가기"}</a>}
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
              {actionBtns(detail)}
              <button type="button" onClick={() => setDetailId(null)} className="ml-auto rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-bold dark:bg-zinc-800">닫기</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 서류 올리기 · 수정 */}
      <Modal open={dlg?.t === "form"} onClose={close} wide>
        <form onSubmit={ev => { ev.preventDefault(); void submit(); }}>
          <h2 className="text-lg font-bold">{formId ? "서류 수정" : "서류 올리기"}</h2>
          <div className="mt-4 flex gap-1.5" role="radiogroup" aria-label="서류 종류">
            {DOCS.map(d => {
              const locked = !!formId; // 서류 종류는 만든 뒤에 바꿀 수 없다
              // 새로 올릴 때는 서류에 맞는 결제수단이 먼저 골라진다 (바꿀 수 있다)
              return <button key={d.v} type="button" role="radio" aria-checked={f.docType === d.v} disabled={locked && f.docType !== d.v} onClick={() => setF({ ...f, docType: d.v, payMethod: formId ? f.payMethod : d.v === "invoice" ? "transfer" : "card", category: d.v === "request" && f.category === "meal" ? "supplies" : f.category })} className={`flex-1 rounded-xl border py-2 text-sm font-extrabold disabled:opacity-40 ${f.docType === d.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{d.label}</button>;
            })}
          </div>
                    {!canEditAny && !isRequestForm && !needsAccount && <p className="mt-2 text-xs text-zinc-500">올리면 「확인 대기」가 되고, 전체 권한을 가진 담당자가 확인하면 완료돼요.</p>}
          {isRequestForm && <p className="mt-2 text-xs text-zinc-500">인터넷으로 사야 하는 비품을 요청해요. 담당자가 구매하고 영수증 사진을 올리면 완료로 처리돼요.</p>}

          <div className="mt-4 text-sm font-bold">{f.docType === "invoice" ? "세금계산서" : f.docType === "request" ? "사진" : "영수증"} 사진 <span className="font-normal text-zinc-500">({isRequestForm ? "링크가 없으면 사진이 필요해요" : "필수"}, 최대 {MAX_PHOTOS}장{isRequestForm ? "" : " · 글씨가 잘 보이게 찍어 주세요"})</span></div>
          {picker(fresh, setFresh, roomForm, keep.map(u => (
            <span key={u} className="relative">
              <img src={u} alt="올린 사진" className="h-24 w-20 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
              <button type="button" aria-label="사진 빼기" onClick={() => setKeep(keep.filter(x => x !== u))} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-black/75 text-xs font-bold text-white">✕</button>
            </span>
          )))}

          <label htmlFor="ex-site" className="mt-4 block text-sm font-bold">{isRequestForm ? "어디에 필요한가요?" : "어느 현장인가요?"} <span className="font-extrabold text-red-500">필수</span></label>
          <select id="ex-site" required value={f.site} onChange={ev => setF({ ...f, site: ev.target.value })} className={`${inputCls} ${f.site ? "" : "border-red-400 dark:border-red-400/60"}`}>
            <option value="">현장 또는 사무실을 꼭 선택해 주세요</option>
            <option value="사무실">사무실</option>
            {f.site && f.site !== "사무실" && !sites.includes(f.site) && <option value={f.site}>{f.site}</option>}
            {sites.filter(s => s !== "사무실").map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="mt-3 text-sm font-bold">분류</div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="분류">
            {CATS.map(c => <button key={c.v} type="button" role="radio" aria-checked={f.category === c.v} onClick={() => setF({ ...f, category: c.v })} className={`rounded-xl border py-2 text-sm font-extrabold ${f.category === c.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{c.label}</button>)}
          </div>

          {isRequestForm && (
            <>
              <label htmlFor="ex-link" className="mt-4 block text-sm font-bold">구매 링크 <span className="font-normal text-zinc-500">(사진이 없으면 필요해요)</span></label>
              <input id="ex-link" inputMode="url" value={f.link} onChange={ev => setF({ ...f, link: ev.target.value })} placeholder="https://… 상품 페이지 주소를 붙여 넣으세요" autoComplete="off" autoCapitalize="none" spellCheck={false} className={inputCls} />
            </>
          )}
          <label htmlFor="ex-vendor" className="mt-4 block text-sm font-bold">{isRequestForm ? "구매처" : "상호·거래처"} {isRequestForm && <span className="font-normal text-zinc-500">(쇼핑몰·업체 이름)</span>}</label>
          <input id="ex-vendor" value={f.vendor} onChange={ev => setF({ ...f, vendor: ev.target.value })} maxLength={60} placeholder={isRequestForm ? "예: 쿠팡, 오늘의집" : f.docType === "invoice" ? "세금계산서를 발행한 업체" : "예: ○○식당, ○○철물"} autoComplete="off" className={inputCls} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ex-amount" className="mt-4 block text-sm font-bold">금액 <span className="font-normal text-zinc-500">(원)</span></label>
              <input id="ex-amount" inputMode="numeric" value={f.amount ? Number(f.amount).toLocaleString("ko-KR") : ""} onChange={ev => setF({ ...f, amount: ev.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder={isRequestForm ? "예상 금액" : f.docType === "invoice" ? "합계금액(부가세 포함)" : "영수증 합계"} autoComplete="off" className={inputCls + " text-right"} />
            </div>
            {!isRequestForm && (
              <div>
                <label htmlFor="ex-date" className="mt-4 block text-sm font-bold">쓴 날짜</label>
                <input id="ex-date" type="date" value={f.date} max={today} onChange={ev => ev.target.value && setF({ ...f, date: ev.target.value })} className={inputCls} />
              </div>
            )}
          </div>
          {!isRequestForm && (
            <>
              <div className="mt-4 text-sm font-bold">결제수단</div>
              <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="결제수단">
                {PAYS.map(p => <button key={p.v} type="button" role="radio" aria-checked={f.payMethod === p.v} onClick={() => setF({ ...f, payMethod: p.v })} className={`flex-1 rounded-xl border py-2 text-sm font-extrabold ${f.payMethod === p.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{p.label}</button>)}
              </div>
            </>
          )}
          {needsAccount && (
            <>
              <p className="mt-2 text-xs text-zinc-500">올리면 「입금 요청」이 되고, 담당자가 계좌로 입금한 뒤 확인하면 「구매 완료」로 처리돼요.</p>
              <label htmlFor="ex-account" className="mt-4 block text-sm font-bold">입금할 계좌번호 <span className="font-extrabold text-red-500">필수</span></label>
              <input id="ex-account" value={f.account} onChange={ev => setF({ ...f, account: ev.target.value })} maxLength={80} placeholder="예: 국민 123-45-678901 (예금주 ○○)" autoComplete="off" inputMode="text" className={`${inputCls} ${f.account.trim() ? "" : "border-red-400 dark:border-red-400/60"}`} />
            </>
          )}
          <label htmlFor="ex-memo" className="mt-4 block text-sm font-bold">{isRequestForm ? "사유" : "무엇에 썼나요?"} <span className="font-normal text-zinc-500">{isRequestForm ? "(왜 필요한가요? 필수)" : "(선택)"}</span></label>
          {isRequestForm ? (
            <textarea id="ex-memo" value={f.memo} onChange={ev => setF({ ...f, memo: ev.target.value })} maxLength={300} rows={3} placeholder="예: 충전 드릴 배터리가 고장나서 교체가 필요해요" className={inputCls + " resize-none"} />
          ) : (
            <input id="ex-memo" value={f.memo} onChange={ev => setF({ ...f, memo: ev.target.value })} maxLength={200} placeholder="예: 점심 5명, 타일 접착제 10포, 주유 30L" autoComplete="off" className={inputCls} />
          )}
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.site || !f.amount || (needsAccount && !f.account.trim()) || (isRequestForm ? !f.memo.trim() || (!f.link.trim() && photoCount < 1) : photoCount < 1)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "올리는 중…" : formId ? "저장" : isRequestForm ? "요청하기" : "올리기"}</button>
          </div>
        </form>
      </Modal>

      {/* 구매 완료 */}
      <Modal open={dlg?.t === "done"} onClose={close} wide>
        {dlg?.t === "done" && (
          <form onSubmit={ev => { ev.preventDefault(); void submitDone(dlg.e); }}>
            <h2 className="text-lg font-bold">{isReq(dlg.e) ? "구매 완료 처리" : dlg.e.account ? "입금 확인" : "서류 확인"}</h2>
            <p className="mt-1 text-sm text-zinc-500">{dlg.e.site} · {catLabel(dlg.e.category)}{dlg.e.memo && ` · ${dlg.e.memo.replace(/\s+/g, " ").slice(0, 60)}`}</p>
            {!isReq(dlg.e) && dlg.e.account && <p className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"><span className="mr-1.5 text-xs font-bold text-zinc-500">입금한 계좌</span><b>{dlg.e.account}</b></p>}
            {(isReq(dlg.e) || dlg.e.account) && (
              <>
                <div className="mt-4 text-sm font-bold">{!isReq(dlg.e) ? "이체 확인증 사진" : "구매한 영수증 사진"} {!isReq(dlg.e) ? <span className="font-normal text-zinc-500">(선택)</span> : <span className="font-extrabold text-red-500">필수</span>}</div>
                {picker(dFresh, setDFresh, MAX_PHOTOS)}
              </>
            )}
            {!isReq(dlg.e) && !dlg.e.account && <p className="mt-3 text-sm text-zinc-500">올린 사진과 금액을 확인했으면 「확인」을 눌러 주세요. 확인한 사람으로 내 이름이 기록돼요.</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="dn-amount" className="mt-4 block text-sm font-bold">{isReq(dlg.e) ? "실제 금액" : dlg.e.account ? "입금한 금액" : "금액 (다르면 고쳐 주세요)"} <span className="font-normal text-zinc-500">(원)</span></label>
                <input id="dn-amount" inputMode="numeric" value={dAmount ? Number(dAmount).toLocaleString("ko-KR") : ""} onChange={ev => setDAmount(ev.target.value.replace(/\D/g, "").slice(0, 8))} autoComplete="off" className={inputCls + " text-right"} />
              </div>
              {!!isReq(dlg.e) && (
                <div>
                  <label htmlFor="dn-vendor" className="mt-4 block text-sm font-bold">구매처</label>
                  <input id="dn-vendor" value={dVendor} onChange={ev => setDVendor(ev.target.value)} maxLength={60} autoComplete="off" className={inputCls} />
                </div>
              )}
            </div>
            {!!isReq(dlg.e) && (
              <>
                <div className="mt-4 text-sm font-bold">결제수단 <span className="font-extrabold text-red-500">필수</span> <span className="font-normal text-zinc-500">(어떻게 결제했나요?)</span></div>
                <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="결제수단">
                  {PAYS.map(p => <button key={p.v} type="button" role="radio" aria-checked={dPay === p.v} onClick={() => setDPay(p.v)} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${dPay === p.v ? "border-blue-600 bg-blue-600 text-white" : dPay ? "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900" : "border-red-400 bg-white dark:border-red-400/60 dark:bg-zinc-900"}`}>{p.label}</button>)}
                </div>
              </>
            )}
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button disabled={busy || (!!isReq(dlg.e) && (dFresh.length < 1 || !dPay))} className="flex-1 rounded-xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : isReq(dlg.e) ? "구매 완료" : dlg.e.account ? "입금 완료로 확인" : "확인"}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={dlg?.t === "del"} onClose={close}>
        {dlg?.t === "del" && (
          <div>
            <h2 className="text-lg font-bold">이 서류를 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">{dlg.e.site} · {docLabel(dlg.e)} · {won(dlg.e.amount)} · {dlg.e.memberName}. 삭제하면 사진도 함께 사라지고 되돌릴 수 없어요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "delete", id: dlg.e.id }, "서류를 삭제했어요").then(ok => { if (ok) setDlg(null); })} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={view !== null} onClose={() => setView(null)}>
        {view && (
          <div>
            <img src={view.urls[view.i]} alt="서류 사진" className="max-h-[70vh] w-full rounded-xl object-contain" />
            {view.urls.length > 1 && (
              <div className="mt-2 flex justify-center gap-2">
                {view.urls.map((u, i) => (
                  <button key={u} type="button" onClick={() => setView({ urls: view.urls, i })} aria-label={`${i + 1}번째 사진`} className={`overflow-hidden rounded-lg ring-2 ${i === view.i ? "ring-blue-600" : "ring-transparent"}`}>
                    <img src={u} alt="" className="h-12 w-12 object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <a href={view.urls[view.i]} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-xl bg-zinc-100 py-3 text-center font-bold dark:bg-zinc-800">원본 열기</a>
              <button type="button" onClick={() => setView(null)} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">닫기</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
