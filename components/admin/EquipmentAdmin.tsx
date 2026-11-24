"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { lowestOf, priceChange } from "@/lib/equipment";
import { printElement } from "@/lib/print-client";
import type { Equipment } from "@/lib/types";

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const won = (n: number) => n.toLocaleString("ko-KR") + "원";
const day = (iso: string) => iso.slice(0, 10);
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : "");

type Form = { name: string; brand: string; model: string; category: string; spec: string; query: string };
const EMPTY: Form = { name: "", brand: "", model: "", category: "", spec: "", query: "" };

// 장비정보: 연장(공구) 정보를 모아 두고 최저가를 확인·갱신한다.
//  · 최저가 = 직접 등록한 판매처 가격과 네이버 쇼핑 최저가 중 가장 싼 값. 바뀔 때마다 기록이 남는다.
//  · 네이버 최저가는 「최저가 갱신」으로 가져온다 (서버에 네이버 키가 있어야 한다).
export default function EquipmentAdmin({ items, naverOn, canRegister, canEdit, canDelete }: { items: Equipment[]; naverOn: boolean; canRegister: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [catSel, setCatSel] = useState("");
  const [sort, setSort] = useState<"name" | "low" | "high" | "change">("name");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ t: "form"; id: string | null } | { t: "del"; e: Equipment } | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const [offer, setOffer] = useState({ mall: "", price: "", url: "" }); // 판매처 가격 추가 입력
  const [link, setLink] = useState(""); // 상품 링크로 가격 가져오기
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null); // 전체 갱신 진행

  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  const categories = [...new Set(items.map(e => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const shown = items
    .filter(e => (!catSel || e.category === catSel) && (!kw || norm(`${e.name}${e.brand}${e.model}${e.category}${e.spec}`).includes(kw)))
    .sort((a, b) => {
      const la = lowestOf(a)?.price ?? Infinity;
      const lb = lowestOf(b)?.price ?? Infinity;
      if (sort === "low") return la - lb;
      if (sort === "high") return (lb === Infinity ? -1 : lb) - (la === Infinity ? -1 : la);
      if (sort === "change") return Math.abs(priceChange(b)?.diff ?? 0) - Math.abs(priceChange(a)?.diff ?? 0);
      return a.name.localeCompare(b.name, "ko");
    });
  const detail = detailId ? items.find(e => e.id === detailId) : undefined;
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(""), 2800); };

  async function post(url: string, body: Record<string, unknown>, done?: string): Promise<{ ok: boolean; data: { error?: string; code?: string; changed?: boolean; price?: number } }> {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return { ok: false, data: {} }; }
      const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string; changed?: boolean; price?: number };
      if (r.ok && done) flash(done);
      return { ok: r.ok, data };
    } catch {
      return { ok: false, data: { error: "처리하지 못했어요." } };
    }
  }
  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    const { ok, data } = await post("/api/admin/equipment", body, done);
    if (!ok) setErr(data.error ?? "처리하지 못했어요.");
    else router.refresh();
    setBusy(false);
    return ok;
  }
  // 네이버 최저가 갱신 (한 장비)
  async function refreshOne(e: Equipment) {
    if (busy) return;
    setBusy(true);
    setErr("");
    const { ok, data } = await post("/api/admin/equipment/refresh", { id: e.id });
    if (!ok) setErr(data.error ?? "갱신하지 못했어요.");
    else { flash(data.changed ? `최저가가 바뀌었어요 (${won(data.price ?? 0)})` : "최저가를 확인했어요 (변동 없음)"); router.refresh(); }
    setBusy(false);
  }
  // 전체 갱신: 하나씩 차례로 (네이버 호출 간격을 지키고, 진행 상황을 보여 준다)
  async function refreshAll() {
    if (busy || prog || items.length === 0) return;
    setErr("");
    setProg({ done: 0, total: items.length });
    let changed = 0, failed = 0;
    for (let i = 0; i < items.length; i++) {
      if (!naverOn && !items[i].offers.some(o => o.auto)) { setProg({ done: i + 1, total: items.length }); continue; } // 링크로 등록한 가격이 없으면 건너뛴다
      const { ok, data } = await post("/api/admin/equipment/refresh", { id: items[i].id });
      if (ok && data.changed) changed++;
      if (!ok) failed++;
      setProg({ done: i + 1, total: items.length });
      await new Promise(r => setTimeout(r, 150));
    }
    setProg(null);
    flash(`전체 갱신을 마쳤어요 — 가격이 바뀐 장비 ${changed}개${failed ? `, 찾지 못한 장비 ${failed}개` : ""}`);
    router.refresh();
  }
  // 새 장비는 항상 빈 양식으로 시작한다
  const openForm = (e: Equipment | null) => {
    setErr("");
    setF(e ? { name: e.name, brand: e.brand, model: e.model, category: e.category, spec: e.spec, query: e.query } : EMPTY);
    setDlg({ t: "form", id: e?.id ?? null });
  };
  const close = () => { if (!busy) setDlg(null); };
  const formId = dlg?.t === "form" ? dlg.id : null;

  const changeBadge = (e: Equipment) => {
    const c = priceChange(e);
    if (!c) return null;
    return c.diff < 0
      ? <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">▼ {won(-c.diff)}</span>
      : <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-300">▲ {won(c.diff)}</span>;
  };
  const canRefresh = naverOn || items.some(e => e.offers.some(o => o.auto));
  const checkedAt = (e: Equipment) => [e.naver?.at, ...e.offers.map(o => o.at)].filter(Boolean).sort().pop() ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-2 py-5">
        <h1 className="mr-auto text-xl font-extrabold">장비정보</h1>
        <span className="text-sm text-zinc-500">장비 {items.length}개</span>
        {canRegister && <button type="button" onClick={() => openForm(null)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 장비 등록</button>}
        {canEdit && <button type="button" onClick={() => void refreshAll()} disabled={!canRefresh || !!prog || busy || items.length === 0} title={canRefresh ? "링크로 등록한 가격을 다시 읽어 와요" : "상품 링크로 등록한 가격이 아직 없어요"} className="rounded-xl border border-emerald-600 px-4 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">{prog ? `갱신 중 ${prog.done}/${prog.total}` : "전체 최저가 갱신"}</button>}
        <button type="button" onClick={() => void printElement(document.getElementById("equipment-ledger"), { title: "장비 목록", heading: "장비 목록과 최저가", landscape: true })} disabled={shown.length === 0} className="rounded-xl border border-black/15 px-4 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15">🖨 인쇄</button>
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">장비를 열어 <b>상품 링크를 붙여 넣으면 가격을 읽어 와요</b>. “전체 최저가 갱신”을 누르면 링크로 등록한 가격을 다시 읽고, 판매처 중 가장 싼 값이 최저가로 계산돼요. 쇼핑몰이 자동 접속을 막으면 가격을 직접 적어 주세요.</p>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="장비명·브랜드·모델명·스펙 검색" className="min-w-[10rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900" />
        <div className="ml-auto flex flex-wrap gap-1.5">
          {categories.length > 0 && (
            <select aria-label="용도" value={catSel} onChange={e => setCatSel(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
              <option value="">모든 용도</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <select aria-label="정렬" value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900">
            <option value="name">이름순</option>
            <option value="low">최저가 낮은순</option>
            <option value="high">최저가 높은순</option>
            <option value="change">가격 변동 큰 순</option>
          </select>
        </div>
      </div>

      {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && !dlg && !detail && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
      {items.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 장비가 없어요.{canRegister ? " 위의 “장비 등록”으로 연장 정보를 모아 보세요." : ""}</p>}
      {items.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">해당하는 장비가 없어요.</p>}

      {/* 인쇄 전용 목록 */}
      <div id="equipment-ledger" className="hidden">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
          <thead><tr>{["장비명", "브랜드", "모델명", "용도", "최저가", "판매처", "확인일"].map(h => <th key={h} style={{ border: "1px solid #999", background: "#eee", padding: "4px 5px", textAlign: "left" }}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map(e => {
              const low = lowestOf(e);
              return <tr key={e.id}>{[e.name, e.brand, e.model, e.category, low ? low.price.toLocaleString("ko-KR") + "원" : "", low?.mall ?? "", checkedAt(e) ? day(checkedAt(e)) : ""].map((c, i) => <td key={i} style={{ border: "1px solid #999", padding: "4px 5px", verticalAlign: "top", textAlign: i === 4 ? "right" : "left" }}>{c}</td>)}</tr>;
            })}
          </tbody>
        </table>
      </div>

      {shown.length > 0 && (
        <>
          {/* 넓은 화면: 엑셀처럼 한 줄에 장비 하나. 줄을 누르면 상세가 열린다 */}
          <div className="mt-3 hidden overflow-hidden rounded-2xl border border-black/10 bg-white md:block dark:border-white/10 dark:bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-bold text-zinc-500 dark:bg-zinc-800/60">
                <tr>
                  {["장비명", "브랜드 · 모델명", "용도", "현재 최저가", "판매처", "확인일"].map(h => <th key={h} className={`whitespace-nowrap px-3 py-2.5 ${h === "현재 최저가" ? "text-right" : ""}`}>{h}</th>)}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {shown.map(e => {
                  const low = lowestOf(e);
                  return (
                    <tr key={e.id} tabIndex={0} onClick={() => { setErr(""); setDetailId(e.id); }} onKeyDown={ev => { if (ev.key === "Enter") setDetailId(e.id); }} className="cursor-pointer border-t border-black/10 align-middle hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2.5 font-extrabold">{e.name}</td>
                      <td className="px-3 py-2.5">{[e.brand, e.model].filter(Boolean).join(" · ") || <span className="text-zinc-400">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{e.category || <span className="text-zinc-400">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-extrabold">{low ? <>{won(low.price)}{changeBadge(e)}</> : <span className="font-normal text-zinc-400">가격 없음</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs">{low ? <>{low.mall || "-"}<small className="ml-1 text-zinc-400">{low.source === "naver" ? "네이버" : "직접"}</small></> : <span className="text-zinc-400">-</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-500">{checkedAt(e) ? day(checkedAt(e)) : "-"}</td>
                      <td className="px-2 py-2.5 text-zinc-400" aria-hidden>›</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 휴대폰: 한 건을 두세 줄로, 누르면 상세 */}
          <ul className="mt-3 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-white md:hidden dark:divide-white/10 dark:border-white/10 dark:bg-zinc-900">
            {shown.map(e => {
              const low = lowestOf(e);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => { setErr(""); setDetailId(e.id); }} className="block w-full px-3 py-2.5 text-left text-sm">
                    <span className="flex items-baseline gap-2"><b className="min-w-0 flex-1 truncate">{e.name}</b><b className="shrink-0 text-base font-extrabold">{low ? won(low.price) : <span className="text-xs font-normal text-zinc-400">가격 없음</span>}</b></span>
                    <span className="flex items-center gap-1 truncate text-xs text-zinc-500">{[e.brand, e.model, e.category].filter(Boolean).join(" · ")}{changeBadge(e)}</span>
                    {low && <span className="block text-xs text-zinc-500">{low.mall} · {low.source === "naver" ? "네이버" : "직접 등록"}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* 상세 */}
      <Modal open={detail !== undefined} onClose={() => !busy && setDetailId(null)} wide>
        {detail && (() => {
          const low = lowestOf(detail);
          const ch = priceChange(detail);
          return (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 break-words text-lg font-bold">{detail.name}</h2>
                {detail.category && <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-bold dark:bg-zinc-800">{detail.category}</span>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                <div><dt className="text-xs font-bold text-zinc-500">브랜드</dt><dd className="font-semibold">{detail.brand || "-"}</dd></div>
                <div><dt className="text-xs font-bold text-zinc-500">모델명</dt><dd className="font-semibold">{detail.model || "-"}</dd></div>
                <div className="col-span-2"><dt className="text-xs font-bold text-zinc-500">네이버 검색어</dt><dd className="font-semibold">{detail.query || [detail.brand, detail.model].filter(Boolean).join(" ") || detail.name}</dd></div>
              </dl>
              {detail.spec && <p className="mt-3 whitespace-pre-line break-words rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60"><span className="mr-1.5 text-xs font-bold text-zinc-500">스펙·메모</span>{detail.spec}</p>}

              <section className="mt-4 rounded-2xl border border-black/10 p-3 dark:border-white/10" aria-label="최저가">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-bold text-zinc-500">현재 최저가</span>
                  {low ? <b className="text-2xl font-extrabold text-blue-700 dark:text-blue-300">{won(low.price)}</b> : <span className="text-sm text-zinc-400">아직 가격이 없어요</span>}
                  {ch && (ch.diff < 0 ? <span className="text-sm font-bold text-blue-700 dark:text-blue-300">▼ {won(-ch.diff)} (이전 {won(ch.prev)})</span> : <span className="text-sm font-bold text-red-600 dark:text-red-300">▲ {won(ch.diff)} (이전 {won(ch.prev)})</span>)}
                </div>
                {low && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{low.mall || "판매처 미상"} · {low.source === "naver" ? "네이버 쇼핑" : "직접 등록"}</p>}
                {low && safeHref(low.url) && <a href={safeHref(low.url)} target="_blank" rel="noopener noreferrer" className="mt-2 block rounded-xl bg-blue-600 py-2.5 text-center text-sm font-bold text-white hover:bg-blue-700">최저가 보러 가기</a>}
                {canEdit && (
                  <button type="button" disabled={(!naverOn && !detail.offers.some(o => o.auto)) || busy} onClick={() => void refreshOne(detail)} title={naverOn || detail.offers.some(o => o.auto) ? "" : "아래에 상품 링크로 가격을 먼저 등록해 주세요"} className="mt-2 w-full rounded-xl border border-emerald-600 py-2.5 text-sm font-bold text-emerald-700 disabled:opacity-40 dark:text-emerald-300">{busy ? "가져오는 중…" : "링크 가격 다시 읽기"}</button>
                )}
                {detail.naver && <p className="mt-1.5 text-xs text-zinc-500">네이버: {detail.naver.title.slice(0, 50)} · {won(detail.naver.price)} · {day(detail.naver.at)} 확인</p>}
              </section>

              <section className="mt-3 rounded-2xl border border-black/10 p-3 dark:border-white/10" aria-label="판매처 가격">
                <h3 className="text-sm font-extrabold">판매처 가격</h3>
                {detail.offers.length === 0 ? <p className="mt-1 text-sm text-zinc-500">아직 없어요.</p> : (
                  <ul className="mt-1 divide-y divide-black/5 dark:divide-white/10">
                    {detail.offers.map(o => (
                      <li key={o.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="min-w-0 flex-1 truncate font-semibold">{o.mall}{o.auto && <small className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" title={`${day(o.at)} 링크에서 읽음`}>링크 {day(o.at)}</small>}</span>
                        <b className="shrink-0">{won(o.price)}</b>
                        {safeHref(o.url) && <a href={safeHref(o.url)} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-black/15 px-2.5 py-1 text-xs font-bold dark:border-white/15">링크</a>}
                        {canEdit && <button type="button" disabled={busy} onClick={() => void call({ action: "offer_remove", id: detail.id, offerId: o.id }, "가격을 지웠어요")} className="shrink-0 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-emerald-50 p-2.5 dark:bg-emerald-500/10" onSubmit={ev => { ev.preventDefault(); void call({ action: "offer_link", id: detail.id, url: link }, "링크에서 가격을 가져와 등록했어요").then(ok => { if (ok) setLink(""); }); }}>
                    <label className="min-w-[12rem] flex-1 text-xs font-bold text-emerald-800 dark:text-emerald-200">상품 링크로 가격 가져오기<input value={link} onChange={e => setLink(e.target.value)} placeholder="쇼핑몰 상품 주소를 붙여 넣으세요 (https://…)" autoComplete="off" autoCapitalize="none" spellCheck={false} className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-normal text-inherit outline-none focus:border-emerald-600 dark:border-white/15 dark:bg-zinc-900" /></label>
                    <button disabled={busy || !link.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "읽는 중…" : "가격 가져오기"}</button>
                  </form>
                )}
                {canEdit && (
                  <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={ev => { ev.preventDefault(); void call({ action: "offer_add", id: detail.id, mall: offer.mall, price: Number(offer.price || 0), url: offer.url }, "가격을 등록했어요").then(ok => { if (ok) setOffer({ mall: "", price: "", url: "" }); }); }}>
                    <label className="min-w-[7rem] flex-1 text-xs font-bold text-zinc-500">판매처<input value={offer.mall} onChange={e => setOffer({ ...offer, mall: e.target.value })} maxLength={30} placeholder="쿠팡" autoComplete="off" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm font-normal text-inherit outline-none focus:border-blue-500 dark:border-white/15" /></label>
                    <label className="w-32 text-xs font-bold text-zinc-500">가격(원)<input inputMode="numeric" value={offer.price ? Number(offer.price).toLocaleString("ko-KR") : ""} onChange={e => setOffer({ ...offer, price: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="0" autoComplete="off" className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-right text-sm font-normal text-inherit outline-none focus:border-blue-500 dark:border-white/15" /></label>
                    <label className="min-w-[9rem] flex-[2] text-xs font-bold text-zinc-500">링크 (선택)<input value={offer.url} onChange={e => setOffer({ ...offer, url: e.target.value })} placeholder="https://…" autoComplete="off" autoCapitalize="none" spellCheck={false} className="mt-1 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm font-normal text-inherit outline-none focus:border-blue-500 dark:border-white/15" /></label>
                    <button disabled={busy || !offer.mall.trim() || !offer.price} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 dark:bg-zinc-200 dark:text-zinc-900">추가</button>
                  </form>
                )}
              </section>

              {detail.history.length > 0 && (
                <section className="mt-3 rounded-2xl border border-black/10 p-3 dark:border-white/10" aria-label="최저가 기록">
                  <h3 className="text-sm font-extrabold">최저가 기록</h3>
                  <ul className="mt-1 divide-y divide-black/5 text-sm dark:divide-white/10">
                    {[...detail.history].reverse().slice(0, 10).map((h, i) => (
                      <li key={h.at + i} className="flex items-center gap-2 py-1"><span className="w-24 shrink-0 text-xs text-zinc-500">{day(h.at)}</span><b className="flex-1">{won(h.price)}</b><span className="truncate text-xs text-zinc-500">{h.mall}</span></li>
                    ))}
                  </ul>
                </section>
              )}
              {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
                {canEdit && <button type="button" onClick={() => { setDetailId(null); openForm(detail); }} className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold dark:bg-zinc-800">정보 수정</button>}
                {canDelete && <button type="button" onClick={() => { setDetailId(null); setErr(""); setDlg({ t: "del", e: detail }); }} className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                <button type="button" onClick={() => setDetailId(null)} className="ml-auto rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-bold dark:bg-zinc-800">닫기</button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 등록 · 수정 */}
      <Modal open={dlg?.t === "form"} onClose={close}>
        <form onSubmit={ev => { ev.preventDefault(); void call(formId ? { action: "update", id: formId, ...f } : { action: "add", ...f }, formId ? "장비 정보를 수정했어요" : "장비를 등록했어요").then(ok => { if (ok) setDlg(null); }); }}>
          <h2 className="text-lg font-bold">{formId ? "장비 정보 수정" : "장비 등록"}</h2>
          <label htmlFor="eq-name" className="mt-4 block text-sm font-bold">장비명</label>
          <input id="eq-name" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="예: 충전 해머드릴" autoComplete="off" className={inputCls} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="eq-brand" className="mt-4 block text-sm font-bold">브랜드</label>
              <input id="eq-brand" value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} maxLength={30} placeholder="예: HPT, 보쉬" autoComplete="off" className={inputCls} />
            </div>
            <div>
              <label htmlFor="eq-model" className="mt-4 block text-sm font-bold">모델명</label>
              <input id="eq-model" value={f.model} onChange={e => setF({ ...f, model: e.target.value })} maxLength={40} placeholder="예: DH18DBL" autoComplete="off" className={inputCls} />
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">모델명을 정확히 적을수록 네이버 최저가가 정확해요 (제목에 모델명이 있는 상품만 봐요).</p>
          <label htmlFor="eq-cat" className="mt-4 block text-sm font-bold">용도·분류 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="eq-cat" list="eq-cats" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} maxLength={30} placeholder="예: 전동공구, 측정, 절단" autoComplete="off" className={inputCls} />
          <datalist id="eq-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
          <label htmlFor="eq-spec" className="mt-4 block text-sm font-bold">스펙·메모 <span className="font-normal text-zinc-500">(선택)</span></label>
          <textarea id="eq-spec" value={f.spec} onChange={e => setF({ ...f, spec: e.target.value })} maxLength={500} rows={3} placeholder="예: 18V, 브러시리스, 배터리 2개 포함" className={inputCls + " resize-none"} />
          <label htmlFor="eq-query" className="mt-4 block text-sm font-bold">네이버 검색어 <span className="font-normal text-zinc-500">(선택, 비우면 브랜드 + 모델명)</span></label>
          <input id="eq-query" value={f.query} onChange={e => setF({ ...f, query: e.target.value })} maxLength={80} placeholder={[f.brand, f.model].filter(Boolean).join(" ") || "브랜드 모델명"} autoComplete="off" className={inputCls} />
          {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
          <div className="mt-5 flex gap-2">
            <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
            <button disabled={busy || !f.name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : formId ? "저장" : "등록"}</button>
          </div>
        </form>
      </Modal>

      <Modal open={dlg?.t === "del"} onClose={close}>
        {dlg?.t === "del" && (
          <div>
            <h2 className="text-lg font-bold">“{dlg.e.name}” 장비를 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">등록한 가격과 최저가 기록도 함께 사라지고 되돌릴 수 없어요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "delete", id: dlg.e.id }, "장비를 삭제했어요").then(ok => { if (ok) setDlg(null); })} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
