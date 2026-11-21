"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { addDays, sitePeriod } from "@/lib/site-period";
import { leaveKindLabel, leaveSlots } from "@/lib/leave";
import type { LeaveKind } from "@/lib/types";
import { OFFICE_SITE_ID } from "@/lib/office-site";
import { ALL_SLOTS, EXTRA_SLOTS, SLOTS, slotLabel, slotTime, type Placement, type PlacementNote, type Slot } from "@/lib/types";

export type SiteLite = { id: string; name: string; address: string; pmName: string; startDate: string; endDate: string; fixed?: boolean }; // fixed = 사무실처럼 항상 보이는 고정 항목
export type WorkerLite = { id: string; name: string; team: string; isPm: boolean; dual?: boolean }; // dual = 사무실·현장 팀을 모두 가진 겸직 인원

type SlotSel = "all" | Slot; // 종일 / 오전 / 오후
const SLOT_TABS: { v: SlotSel; label: string }[] = [{ v: "all", label: "종일" }, { v: "am", label: "오전" }, { v: "pm", label: "오후" }, { v: "ot", label: "야간 0.5" }, { v: "nt", label: "심야 1" }];
// 한 날짜 칸의 가로 구성: 오전 | 오후 | 야간 | 심야 (야간·심야는 오전·오후와 별개의 시간대라 따로 칸을 둔다)
const COLS = "1fr 1fr 0.85fr 0.85fr";
const slotsOf = (v: SlotSel): Slot[] => (v === "all" ? [...SLOTS] : [v]);

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (d: string) => new Date(d + "T00:00:00").getDay();
const label = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WEEK[dow(d)]})`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const isRest = (d: string) => dow(d) === 0; // 일요일은 쉬는 날 (배치하지 않는다)
const nextWork = (d: string) => (isRest(d) ? addDays(d, 1) : d); // 일요일이면 다음 날(월요일)
const stepWork = (d: string, n: 1 | -1) => nextWork(addDays(d, n)) === addDays(d, n) ? addDays(d, n) : addDays(d, 2 * n); // 일요일은 건너뛰며 하루씩 이동

type Cell = { siteId: string; date: string; slot: SlotSel };

// 현장배치: 주간 일정표(현장 × 날짜, 칸마다 오전·오후 인원 + 그날 작업 내용) 또는 하루씩 보기.
// 작업자는 '내 배치'에서 다음날 현장·작업 내용을 확인한다.
export default function PlacementsAdmin({
  sites, workers, placements, notes, leaves, canRegister, canDelete,
}: {
  sites: SiteLite[]; workers: WorkerLite[]; placements: Placement[]; notes: PlacementNote[]; leaves: { memberId: string; startDate: string; endDate: string; kind: LeaveKind }[]; canRegister: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("sv-SE");
  const [view, setView] = useState<"week" | "day">("week");
  const [date, setDate] = useState(() => nextWork(today)); // 기준 날짜 (기본은 오늘, 일요일이면 월요일). 표는 이 날짜 앞뒤의 근무일만 보여 준다
  const [allSites, setAllSites] = useState(false);
  // 주간 표 칸 크기: 한 칸에 10명 넘게 들어가도 이름이 들어가도록 날짜 칸 폭·글자 크기를 고른다
  const [zoom, setZoom] = useState<"s" | "m" | "l">("m");
  const [radius, setRadius] = useState(2); // 기준 날짜 앞뒤로 며칠씩 보일지 (일요일은 건너뜀)
  const dayRem = { s: 14, m: 19, l: 25 }[zoom]; // 날짜 한 칸(오전·오후·야간·심야 4칸) 폭
  const nameCls = { s: "text-xs", m: "text-[13px]", l: "text-[15px]" }[zoom];
  const [m, setM] = useState<Cell | null>(null); // 배치 창 (칸 또는 현장 카드에서 연다)
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [noteEdit, setNoteEdit] = useState<{ siteId: string; date: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const wMap = new Map(workers.map(w => [w.id, w]));
  const siteMap = new Map(sites.map(s => [s.id, s]));
  // 지워진 회원·현장의 배치는 안 보인다
  const valid = placements.filter(p => wMap.has(p.memberId) && siteMap.has(p.siteId));
  const peopleAt = new Map<string, WorkerLite[]>(); // "날짜|현장|시간대" → 인원
  const siteAt = new Map<string, string>(); // "날짜|시간대|회원" → 현장
  for (const p of valid) {
    const k = `${p.date}|${p.siteId}|${p.slot}`;
    peopleAt.set(k, [...(peopleAt.get(k) ?? []), wMap.get(p.memberId)!]);
    siteAt.set(`${p.date}|${p.slot}|${p.memberId}`, p.siteId);
  }
  for (const list of peopleAt.values()) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const noteAt = new Map(notes.map(n => [`${n.date}|${n.siteId}`, n.note]));
  const people = (d: string, siteId: string, slot: Slot) => peopleAt.get(`${d}|${siteId}|${slot}`) ?? [];
  const slotsAssigned = (d: string, id: string) => ALL_SLOTS.filter(s => siteAt.has(`${d}|${s}|${id}`));
  // 승인된 휴가: 그 날짜·시간대는 배치할 수 없고, 미배치 계산에서도 빠진다
  const leaveOn = (id: string, d: string) => leaves.find(l => l.memberId === id && d >= l.startDate && d <= l.endDate);
  const coversSlot = (id: string, d: string, slot: Slot) => { const l = leaveOn(id, d); return !!l && leaveSlots(l.kind).includes(slot); };
  const leaveListOn = (d: string) => workers.flatMap(w => { const l = leaveOn(w.id, d); return l ? [{ w, kind: l.kind }] : []; });
  const gapsOn = (d: string) => workers.map(w => ({ w, missing: SLOTS.filter(s => !siteAt.has(`${d}|${s}|${w.id}`) && !coversSlot(w.id, d, s)) })).filter(x => x.missing.length > 0);
  const missingText = (mi: Slot[]) => (mi.length === 2 ? "미배치" : `${slotLabel(mi[0])} 미배치`);

  // 기준 날짜 앞뒤 근무일만 (예: 앞 2일 · 기준일 · 뒤 2일 = 5일). 일요일은 쉬는 날이라 건너뛴다.
  const anchor = nextWork(date);
  const around = (n: number) => { const prev: string[] = []; const next: string[] = []; for (let x = anchor; prev.length < n;) { x = stepWork(x, -1); prev.unshift(x); } for (let x = anchor; next.length < n;) { x = stepWork(x, 1); next.push(x); } return [...prev, anchor, ...next]; };
  const weekDays = around(radius);
  const lastDay = weekDays[weekDays.length - 1];
  // 그 기간에 공사 중인 현장(공사기간이 겹치거나 기간 미정) + 배치·작업 내용이 있는 현장
  const overlaps = (s: SiteLite, from: string, to: string) => (!s.startDate || s.startDate <= to) && (!s.endDate || s.endDate >= from);
  const used = (s: SiteLite, days: string[]) => days.some(d => ALL_SLOTS.some(sl => people(d, s.id, sl).length) || noteAt.has(`${d}|${s.id}`));
  const sortSites = (list: SiteLite[]) => [...list].sort((a, b) => Number(!!b.fixed) - Number(!!a.fixed) || (a.startDate || "9999").localeCompare(b.startDate || "9999") || a.name.localeCompare(b.name, "ko"));
  const weekSites = sortSites(sites.filter(s => s.fixed || allSites || overlaps(s, weekDays[0], lastDay) || used(s, weekDays)));
  const daySites = sortSites(sites.filter(s => s.fixed || allSites || overlaps(s, date, date) || used(s, [date])));

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/admin/placements", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) { router.replace("/"); return null; }
    const j = (await r.json().catch(() => ({}))) as { error?: string; count?: number; on?: boolean };
    if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
    return j;
  }
  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const j = await post(body);
      if (!j) return false;
      setToast(done.replace("{n}", String(j.count ?? 0)));
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
  // 지난주(또는 전날)의 배치를 가져온다: 같은 시간대가 이미 있는 사람은 건너뛴다
  async function copyFrom(days: string[], back: number, what: string) {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      let n = 0;
      for (const d of days) { const j = await post({ action: "copy", from: addDays(d, -back), to: d }); if (!j) return; n += j.count ?? 0; }
      setToast(`${what}에서 ${n}명을 가져왔어요`);
      setTimeout(() => setToast(""), 2500);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  // 야간·심야 전원 체크: 그날 이 현장의 모든 인원에게 한 번에 넣거나(전원 체크), 이미 전원이면 전원 해제한다
  async function toggleExtra(s: SiteLite, d: string, slot: "ot" | "nt") {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const j = await post({ action: "extra", date: d, siteId: s.id, slot });
      if (!j) return;
      setToast(`${s.name} ${md(d)} ${slotLabel(slot)}: ${j.count ?? 0}명 ${j.on ? "전원 체크" : "전원 해제"}`);
      setTimeout(() => setToast(""), 2500);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  const openCell = (c: Cell) => { if (isRest(c.date)) return; setErr(""); setPick(new Set()); setQ(""); setM({ ...c }); };
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  // 사무실에는 사무실·현장 팀을 모두 가진 인원만 배치할 수 있다
  const list = workers.filter(w => (!m || m.siteId !== OFFICE_SITE_ID || w.dual) && (!kw || norm(w.name + w.team).includes(kw)));
  const togglePick = (id: string) => setPick(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 배치 창의 인원 상태: 고른 시간대에서 이 현장에 이미 있는지 / 다른 현장에 있는지
  function status(w: WorkerLite, c: Cell) {
    const sl = slotsOf(c.slot);
    const at = sl.map(s => ({ s, site: siteAt.get(`${c.date}|${s}|${w.id}`) }));
    const here = at.every(x => x.site === c.siteId);
    const elsewhere = at.filter(x => x.site && x.site !== c.siteId).map(x => `${siteMap.get(x.site!)?.name ?? "?"}${sl.length > 1 ? `(${slotLabel(x.s)})` : ""}`);
    const leave = sl.some(s => coversSlot(w.id, c.date, s)); // 그 시간대가 승인된 휴가면 배치할 수 없다
    return { here, elsewhere, leave };
  }
  // 배치 창 정렬: 고른 시간대가 비어 있는 인원(미배치)이 위로, 다른 현장에 있는 사람, 이미 이 현장인 사람 순
  const rank = (w: WorkerLite) => { if (!m) return 0; const st = status(w, m); return st.leave ? 3 : st.here ? 2 : st.elsewhere.length ? 1 : 0; };
  const rows = [...list].sort((a, b) => rank(a) - rank(b));
  const mSite = m ? siteMap.get(m.siteId) : undefined;
  // 이 현장·이 날짜에 이미 배치된 인원 (오전·오후 전체) — 창 위쪽에 칩으로 보이고 ✕로 뺀다
  const crewNow = m ? workers.flatMap(w => { const sl = ALL_SLOTS.filter(s => siteAt.get(`${m.date}|${s}|${w.id}`) === m.siteId); return sl.length ? [{ w, sl }] : []; }) : [];

  // 배치 칩: 오전·오후는 파랑/하늘/보라, 야근·심야만 있으면 주황/남색. 글자는 종일이면 생략, 그 외엔 "오전+야근" 처럼
  const dayOf = (sl: Slot[]) => sl.filter(x => x === "am" || x === "pm");
  const tagCls = (sl: Slot[]) => {
    const d = dayOf(sl);
    if (d.length === 2) return "bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200";
    if (d.length === 1) return d[0] === "am" ? "bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200" : "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200";
    return sl.includes("nt") ? "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100" : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100";
  };
  const slotText = (sl: Slot[]) => [dayOf(sl).length === 2 ? "종일" : dayOf(sl).map(slotLabel).join(""), ...sl.filter(x => x === "ot" || x === "nt").map(slotLabel)].filter(Boolean).join("+");
  const dayHead = (d: string) => (
    <>
      <span className={d === today ? "rounded-full bg-blue-600 px-2 py-0.5 text-white" : ""}>{md(d)}</span>
      <span className={`ml-1 ${dow(d) === 0 ? "text-red-600" : dow(d) === 6 ? "text-blue-600" : ""}`}>({WEEK[dow(d)]})</span>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[100rem] flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">현장배치</h1>
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([["week", "🗓️ 주간"], ["day", "📋 하루씩"]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-3.5 py-2 ${view === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{l}</button>
          ))}
        </div>
        <span className="text-sm text-zinc-500">현장 인원 {workers.length}명</span>
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">현장 × 날짜 표에서 칸의 <b>왼쪽(오전)·오른쪽(오후)</b>을 눌러 인원을 배치하고, 칸 오른쪽의 <b>야간(오후 5~8시, 0.5일)·심야(오후 8~10시, 1일)</b> 칸으로 추가 근무도 넣고, 날짜 아래 <b>“야간 전원 / 심야 전원”</b> 버튼으로 그 현장 <b>오후 근무자(오전만 한 사람 제외)</b>에게 한 번에 체크하고(야간과 심야는 하루에 하나만 — 심야를 체크하면 야간은 빠져요), 현장 아래 줄을 눌러 그날 <b>작업 내용</b>을 적어요. 현장작업자는 <b>“내 배치”</b>에서 자기 현장과 작업 내용을 확인해요. 오전·오후에 다른 현장으로 나눠 보낼 수도 있고, 같은 시간대에 다시 배치하면 그 현장으로 옮겨져요. <b>🏢 사무실</b>은 고정 항목이에요(사무실·현장 팀을 모두 가진 인원만 직접 배치). <b>오늘 앞뒤 며칠</b>만 보여 주고(위의 “앞뒤 N일씩”으로 조절), <b>일요일은 쉬는 날</b>이라 표에 나오지 않아요.</p>

      <div className="flex flex-wrap items-center gap-2">
        {view === "week" ? (
          <>
            <button type="button" onClick={() => setDate(d => stepWork(nextWork(d), -1))} aria-label="하루 앞으로" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">‹</button>
            <b className="min-w-36 text-center text-base">{md(weekDays[0])} ~ {md(lastDay)}</b>
            <button type="button" onClick={() => setDate(d => stepWork(nextWork(d), 1))} aria-label="하루 뒤로" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">›</button>
            <button type="button" onClick={() => setDate(nextWork(today))} className={`rounded-lg px-3 py-2 text-xs font-bold ${anchor === nextWork(today) ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>오늘</button>
            <input type="date" aria-label="이 날짜를 가운데로 이동" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
            <span className="flex items-center gap-1 text-xs font-bold text-zinc-500" role="group" aria-label="앞뒤 범위">앞뒤
              {([1, 2, 3] as const).map(n => <button key={n} type="button" aria-pressed={radius === n} onClick={() => setRadius(n)} className={`rounded-lg px-2.5 py-1.5 ${radius === n ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{n}일씩</button>)}
            </span>
            <span className="ml-auto flex items-center gap-1 text-xs font-bold text-zinc-500" role="group" aria-label="칸 크기">칸 크기
              {([["s", "작게"], ["m", "보통"], ["l", "크게"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={zoom === v} onClick={() => setZoom(v)} className={`rounded-lg px-2.5 py-1.5 ${zoom === v ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{l}</button>)}
            </span>
            {canRegister && <button type="button" disabled={busy} onClick={() => void copyFrom(weekDays, 7, "지난주 같은 요일 배치")} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold disabled:opacity-50 dark:border-white/15">지난주 같은 요일 배치 가져오기</button>}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setDate(d => stepWork(d, -1))} aria-label="전날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">‹</button>
            <input type="date" aria-label="배치 날짜" value={date} onChange={e => e.target.value && setDate(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
            <button type="button" onClick={() => setDate(d => stepWork(d, 1))} aria-label="다음날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">›</button>
            <button type="button" onClick={() => setDate(nextWork(today))} className={`rounded-lg px-3 py-2 text-xs font-bold ${date === today ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>오늘</button>
            <button type="button" onClick={() => setDate(nextWork(addDays(today, 1)))} className={`rounded-lg px-3 py-2 text-xs font-bold ${date === nextWork(addDays(today, 1)) ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{isRest(addDays(today, 1)) ? "다음 근무일" : "내일"}</button>
            <b className="ml-1 text-base">{label(date)}</b>
            {canRegister && <button type="button" disabled={busy} onClick={() => void copyFrom([date], dow(date) === 1 ? 2 : 1, "전 근무일 배치")} className="ml-auto rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold disabled:opacity-50 dark:border-white/15">전 근무일 배치 가져오기</button>}
          </>
        )}
      </div>
      {toast && <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}
      {err && !m && !noteEdit && <p className="mt-2 text-sm text-red-500" role="alert">{err}</p>}

      {sites.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 현장이 없어요. 현장일정에서 먼저 현장을 등록해 주세요.</p>
      ) : view === "week" ? (
        <>
          {/* 주간 일정표: 세로 = 현장(착공·준공일), 가로 = 날짜. 칸은 왼쪽 오전 · 오른쪽 오후, 현장 아래 줄은 그날 작업 내용 */}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900">
            <table className="table-fixed border-collapse text-sm" style={{ width: `${9.5 + weekDays.length * dayRem}rem`, minWidth: "100%" }}>
              <colgroup><col style={{ width: "9.5rem" }} />{weekDays.map(d => <col key={d} />)}</colgroup>
              <thead>
                <tr className="bg-zinc-200 dark:bg-zinc-700">
                  <th className="sticky left-0 z-10 border-b border-r border-black/15 bg-zinc-200 px-2 py-2.5 text-xs font-bold text-zinc-600 dark:border-white/15 dark:bg-zinc-700 dark:text-zinc-200">현장</th>
                  {weekDays.map(d => <th key={d} className="border-b border-l border-dashed border-black/40 px-1 py-2 text-xs font-bold dark:border-white/30">{dayHead(d)}</th>)}
                </tr>
                <tr className="bg-zinc-100 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800">
                  <th className="sticky left-0 z-10 border-b border-r border-black/15 bg-zinc-100 dark:border-white/15 dark:bg-zinc-800" />
                  {weekDays.map(d => <th key={d} className="border-b border-l border-dashed border-black/40 py-0.5 dark:border-white/30"><span className="grid text-center leading-tight" style={{ gridTemplateColumns: COLS }}><span>오전</span><span>오후</span><span className="text-amber-700 dark:text-amber-300">야간 0.5<small className="block text-[9px] font-normal">오후 5~8시</small></span><span className="text-indigo-700 dark:text-indigo-300">심야 1<small className="block text-[9px] font-normal">오후 8~10시</small></span></span></th>)}
                </tr>
              </thead>
              <tbody>
                {weekSites.length === 0 && <tr><td colSpan={weekDays.length + 1} className="p-8 text-center text-zinc-500">이 기간에 공사 중인 현장이 없어요. 아래 “모든 현장 보기”를 켜 보세요.</td></tr>}
                {weekSites.map(s => {
                  const p = sitePeriod(s.startDate, s.endDate);
                  return [
                    <tr key={s.id} className="align-top">
                      <th rowSpan={2} className="sticky left-0 z-10 border-b-2 border-r border-black/20 bg-zinc-50 px-2 py-3 text-center align-middle dark:border-white/20 dark:bg-zinc-800">
                        <div className="text-[15px] font-extrabold leading-tight break-keep">{s.fixed && "🏢 "}{s.name}</div>
                        {s.pmName && <div className="mt-0.5 text-[11px] font-semibold text-zinc-500">PM {s.pmName}</div>}
                        <div className="mt-2 text-[11px] font-bold leading-snug">{s.startDate && <div>착공일:{md(s.startDate)}</div>}{s.endDate && <div className={p.urgent ? "text-red-600" : ""}>준공일:{md(s.endDate)}</div>}{!s.startDate && !s.endDate && <span className="font-normal text-zinc-400">{s.fixed ? "고정" : "공사기간 미정"}</span>}</div>
                        {p.urgent && p.badge && <span className="mt-1 inline-block rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{p.badge.label}</span>}
                      </th>
                      {weekDays.map(d => {
                        const out = (s.startDate && d < s.startDate) || (s.endDate && d > s.endDate); // 공사기간 밖의 날은 옅게
                        return (
                          <td key={d} className={`border-l border-dashed border-black/40 p-0 dark:border-white/30 ${d === today ? "bg-blue-50/60 dark:bg-blue-500/5" : out ? "bg-zinc-50 dark:bg-zinc-800/40" : ""}`}>
                            <div className="grid min-h-16" style={{ gridTemplateColumns: COLS }}>
                              {[...SLOTS, ...EXTRA_SLOTS].map((sl, i) => {
                                const names = people(d, s.id, sl);
                                const extra = i >= SLOTS.length;
                                const tone = !extra ? "" : sl === "ot" ? "bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100" : "bg-indigo-50/70 text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-100";
                                const inner = names.length ? names.map(w => <span key={w.id} className="block leading-5">{w.name}</span>) : null;
                                const cls = `${i > 0 ? "border-l border-dotted border-black/20 dark:border-white/20" : ""} px-2 py-2 text-left ${nameCls} font-semibold ${tone}`;
                                return canRegister ? (
                                  <button key={sl} type="button" onClick={() => openCell({ siteId: s.id, date: d, slot: sl })} aria-label={`${s.name} ${md(d)} ${slotLabel(sl)} 배치`} className={`${cls} hover:brightness-95 hover:bg-blue-100/70 dark:hover:bg-blue-500/20`}>{inner}</button>
                                ) : (
                                  <div key={sl} className={cls}>{inner}</div>
                                );
                              })}
                            </div>
                            {canRegister && (
                              /* 날짜 하단: 눌러서 이 현장의 모든 인원에게 야간(0.5)·심야(1)를 한 번에 체크 / 전원이면 해제 */
                              <div className="grid border-t border-dotted border-black/25 dark:border-white/25" style={{ gridTemplateColumns: COLS }}>
                                <span className="col-span-2" />
                                {EXTRA_SLOTS.map(sl => {
                                  const crew = new Set(people(d, s.id, "pm").map(w => w.id)); // 오후(종일 포함) 근무자만 — 오전만 한 사람은 제외
                                  const have = new Set(people(d, s.id, sl).map(w => w.id));
                                  const all = crew.size > 0 && [...crew].every(id => have.has(id));
                                  return (
                                    <button key={sl} type="button" disabled={busy || crew.size === 0} onClick={() => void toggleExtra(s, d, sl)} title={`${slotLabel(sl)}(${slotTime(sl)}) · 오후 근무자 전원 ${all ? "해제" : "체크"} (오전만 한 사람 제외)`} className={`m-0.5 rounded px-1 py-0.5 text-[10px] font-bold leading-tight disabled:opacity-30 ${all ? (sl === "ot" ? "bg-amber-500 text-white" : "bg-indigo-600 text-white") : "border border-black/20 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-white/20 dark:bg-zinc-900 dark:text-zinc-300"}`}>{all ? "✓ " : ""}{slotLabel(sl)} 전원</button>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>,
                    <tr key={s.id + ":n"} className="bg-zinc-200/80 dark:bg-zinc-700/60">
                      {weekDays.map(d => {
                        const note = noteAt.get(`${d}|${s.id}`) ?? "";
                        return (
                          <td key={d} className="border-b-2 border-l border-dashed border-black/20 p-0 dark:border-white/20">
                            {canRegister ? (
                              <button type="button" onClick={() => { setErr(""); setNoteEdit({ siteId: s.id, date: d, text: note }); }} aria-label={`${s.name} ${md(d)} 작업 내용`} title="눌러서 작업 내용 적기" className="block min-h-7 w-full px-1.5 py-1 text-center text-[11px] font-bold leading-snug break-keep text-zinc-800 hover:bg-amber-100 dark:text-zinc-100 dark:hover:bg-amber-500/20">{note || <span className="font-normal text-zinc-400/70">+ 작업</span>}</button>
                            ) : (
                              <div className="min-h-7 px-1.5 py-1 text-center text-[11px] font-bold leading-snug break-keep">{note}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>,
                  ];
                })}
                {/* 날짜별 미배치 인원 (오전·오후 중 비어 있는 사람) */}
                <tr className="align-top">
                  <th className="sticky left-0 z-10 border-r border-black/20 bg-amber-50 px-2 py-3 text-center text-[13px] font-extrabold text-amber-800 dark:border-white/20 dark:bg-amber-950 dark:text-amber-200">미배치</th>
                  {weekDays.map(d => {
                    const g = gapsOn(d);
                    return (
                      <td key={d} className="border-l border-dashed border-black/40 bg-amber-50/50 px-1.5 py-1.5 dark:border-white/30 dark:bg-amber-500/5">
                        {g.length === 0 ? <span className="text-[11px] text-zinc-400">—</span> : g.map(({ w, missing }) => <span key={w.id} className="block text-xs leading-5 text-zinc-700 dark:text-zinc-200">{w.name}{missing.length === 1 && <small className="ml-1 text-[10px] font-bold text-amber-600">{slotLabel(missing[0])}만 비음</small>}</span>)}
                      </td>
                    );
                  })}
                </tr>
                {/* 날짜별 휴가 (승인된 휴가) */}
                <tr className="align-top">
                  <th className="sticky left-0 z-10 border-r border-black/20 bg-sky-50 px-2 py-3 text-center text-[13px] font-extrabold text-sky-800 dark:border-white/20 dark:bg-sky-950 dark:text-sky-200">휴가</th>
                  {weekDays.map(d => {
                    const lv = leaveListOn(d);
                    return (
                      <td key={d} className="border-l border-dashed border-black/40 bg-sky-50/50 px-1.5 py-1.5 dark:border-white/30 dark:bg-sky-500/5">
                        {lv.length === 0 ? <span className="text-[11px] text-zinc-400">—</span> : lv.map(({ w, kind }) => <span key={w.id} className="block text-xs leading-5 text-zinc-700 dark:text-zinc-200">{w.name}{kind !== "full" && <small className="ml-1 text-[10px] font-bold text-sky-700">{leaveKindLabel(kind)}</small>}</span>)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-zinc-500">오전·오후 모두 같은 현장이면 두 칸에 같은 이름이 보여요. 빨간 준공일은 마감 7일 이내예요.</p>
        </>
      ) : isRest(date) ? (
        <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">일요일은 쉬는 날이라 배치하지 않아요.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-500">배치 {workers.filter(w => slotsAssigned(date, w.id).length > 0).length}명 · 미배치 {workers.filter(w => slotsAssigned(date, w.id).length === 0).length}명{gapsOn(date).some(g => g.missing.length === 1) && <> · 반나절만 배치 {gapsOn(date).filter(g => g.missing.length === 1).length}명</>}</p>
          <section className="mt-3 rounded-2xl border border-dashed border-amber-400 bg-amber-50/60 p-4 dark:bg-amber-500/5" aria-label="미배치 인원">
            <h2 className="text-sm font-extrabold">미배치 인원 <span className="font-semibold text-zinc-500">{gapsOn(date).length}명</span></h2>
            {gapsOn(date).length === 0 ? <p className="mt-1 text-sm text-zinc-500">{workers.length === 0 ? "현장 부서 회원이 없어요. 회원 관리에서 먼저 만들어 주세요." : "오전·오후 모두 배치됐어요."}</p> : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {gapsOn(date).map(({ w, missing }) => <span key={w.id} className="rounded-full bg-white px-3 py-1 text-sm shadow-sm dark:bg-zinc-900">{w.name}<small className={`ml-1 text-[10px] font-bold ${missing.length === 2 ? "text-zinc-500" : "text-amber-600"}`}>{missingText(missing)}</small></span>)}
              </div>
            )}
          </section>
          {leaveListOn(date).length > 0 && <section className="mt-3 rounded-2xl border border-sky-300 bg-sky-50/60 p-4 dark:bg-sky-500/5" aria-label="휴가"><h2 className="text-sm font-extrabold text-sky-800 dark:text-sky-200">휴가 <span className="font-semibold text-zinc-500">{leaveListOn(date).length}명</span></h2><div className="mt-2 flex flex-wrap gap-1.5">{leaveListOn(date).map(({ w, kind }) => <span key={w.id} className="rounded-full bg-white px-3 py-1 text-sm shadow-sm dark:bg-zinc-900">{w.name}<small className="ml-1 text-[10px] font-bold text-sky-700">{leaveKindLabel(kind)}</small></span>)}</div></section>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {daySites.length === 0 && <p className="col-span-full rounded-2xl bg-white p-6 text-center text-sm text-zinc-500 dark:bg-zinc-900">이 날 공사 중인 현장이 없어요. 아래 “모든 현장 보기”를 눌러 보세요.</p>}
            {daySites.map(s => {
              const crew = workers.flatMap(w => { const sl = ALL_SLOTS.filter(x => people(date, s.id, x).some(p => p.id === w.id)); return sl.length ? [{ w, sl }] : []; });
              const p = sitePeriod(s.startDate, s.endDate);
              const note = noteAt.get(`${date}|${s.id}`);
              return (
                <section key={s.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                  <div className="flex items-center gap-2">
                    <b className="min-w-0 flex-1 truncate text-base">{s.fixed ? "🏢" : "🏗️"} {s.name}</b>
                    {p.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${p.badge.cls}`}>{p.badge.label}</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{[s.pmName && `담당 PM ${s.pmName}`, p.text].filter(Boolean).join(" · ")}</p>
                  {(note || canRegister) && (
                    <button type="button" disabled={!canRegister} onClick={() => { setErr(""); setNoteEdit({ siteId: s.id, date, text: note ?? "" }); }} className="mt-2 block w-full rounded-lg bg-zinc-100 px-2.5 py-1.5 text-left text-xs font-bold dark:bg-zinc-800">{note ? `작업: ${note}` : <span className="font-normal text-zinc-400">+ 그날 작업 내용</span>}</button>
                  )}
                  <div className="mt-3 min-h-9">
                    {crew.length === 0 ? <span className="text-sm text-zinc-400">배치된 인원이 없어요</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {crew.map(({ w, sl }) => (
                          <span key={w.id} className={`flex items-center gap-1 rounded-full py-1 pl-3 pr-2 text-sm font-semibold ${tagCls(sl)}`}>
                            {w.name}{w.isPm && <small className="text-[10px] font-bold opacity-70">PM</small>}
                            {slotText(sl) !== "종일" && <small className="rounded bg-white/70 px-1 text-[10px] font-bold dark:bg-black/30">{slotText(sl)}</small>}
                            {canDelete && <button type="button" aria-label={`${w.name} 배치 빼기`} disabled={busy} onClick={() => void call({ action: "remove", date, memberId: w.id, slots: sl }, `${w.name}님을 이 현장 배치에서 뺐어요`)} className="ml-0.5 rounded-full px-1 text-xs opacity-50 hover:text-red-600 hover:opacity-100">✕</button>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-xs font-bold text-zinc-500">{crew.length}명</span>
                    {canRegister && (
                      <span className="ml-auto flex items-center gap-1">
                        <button type="button" onClick={() => openCell({ siteId: s.id, date, slot: "am" })} className="rounded-lg bg-sky-100 px-2.5 py-1.5 text-xs font-bold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">+ 오전</button>
                        <button type="button" onClick={() => openCell({ siteId: s.id, date, slot: "pm" })} className="rounded-lg bg-violet-100 px-2.5 py-1.5 text-xs font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">+ 오후</button>
                        <button type="button" onClick={() => openCell({ siteId: s.id, date, slot: "ot" })} className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-bold text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">+ 야간</button>
                        <button type="button" onClick={() => openCell({ siteId: s.id, date, slot: "nt" })} className="rounded-lg bg-indigo-100 px-2.5 py-1.5 text-xs font-bold text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100">+ 심야</button>
                        <button type="button" onClick={() => openCell({ siteId: s.id, date, slot: "all" })} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">+ 인원 배치</button>
                      </span>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
      {sites.length > 0 && (
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={allSites} onChange={e => setAllSites(e.target.checked)} className="h-4 w-4" /> 모든 현장 보기 (공사기간 밖의 현장 포함)
        </label>
      )}

      {/* 인원 배치 창 (칸을 눌렀거나 현장 카드의 버튼으로 연다) */}
      <Modal open={m !== null && !!mSite} onClose={() => !busy && setM(null)} wide>
        {m && mSite && (
          <div>
            <h2 className="text-lg font-bold">{mSite.fixed ? "🏢" : "🏗️"} {mSite.name}</h2>
            {m.siteId === OFFICE_SITE_ID && <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-900 dark:bg-violet-500/10 dark:text-violet-100">사무실에는 <b>사무실·현장 팀을 모두 가진 인원</b>만 배치할 수 있어요. 사무실 배치는 <b>직접 배치</b>해 주세요.</p>}
            <p className="mt-1 text-sm text-zinc-500">{label(m.date)} · 이 현장에 배치할 인원을 골라 주세요. 같은 시간대에 다른 현장에 있는 사람을 고르면 이 현장으로 옮겨져요.</p>
            {crewNow.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-bold text-zinc-500">지금 이 현장 배치 ({crewNow.length}명)</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {crewNow.map(({ w, sl }) => (
                    <span key={w.id} className={`flex items-center gap-1 rounded-full py-1 pl-3 pr-2 text-sm font-semibold ${tagCls(sl)}`}>
                      {w.name}{slotText(sl) !== "종일" && <small className="rounded bg-white/70 px-1 text-[10px] font-bold dark:bg-black/30">{slotText(sl)}</small>}
                      {canDelete && <button type="button" aria-label={`${w.name} 배치 빼기`} disabled={busy} onClick={() => void call({ action: "remove", date: m.date, memberId: w.id, slots: sl }, `${w.name}님을 이 현장 배치에서 뺐어요`)} className="ml-0.5 rounded-full px-1 text-xs opacity-50 hover:text-red-600 hover:opacity-100">✕</button>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(m.slot === "ot" || m.slot === "nt") && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">야간(오후 5~8시, 0.5)과 심야(오후 8~10시, 1)는 하루에 하나만 돼요. 이미 다른 쪽이 체크된 사람은 새로 고른 쪽으로 바뀌어요.</p>}
            <div className="mt-3 flex gap-2" role="radiogroup" aria-label="시간대">
              {SLOT_TABS.map(t => (
                <button key={t.v} type="button" role="radio" aria-checked={m.slot === t.v} onClick={() => setM({ ...m, slot: t.v })} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${m.slot === t.v ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{t.label}</button>
              ))}
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·팀 검색" aria-label="인원 검색" className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
            <ul className="mt-2 max-h-[34vh] divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
              {rows.length === 0 && <li className="p-4 text-center text-sm text-zinc-500">해당하는 인원이 없어요.</li>}
              {rows.map(w => {
                const st = status(w, m);
                const on = pick.has(w.id);
                return (
                  <li key={w.id}>
                    <button type="button" role="checkbox" aria-checked={st.here || on} disabled={st.here || st.leave} onClick={() => togglePick(w.id)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left disabled:opacity-60 ${on ? "bg-blue-50 dark:bg-blue-500/15" : ""}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm text-white ${st.here || on ? "border-blue-600 bg-blue-600" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"}`} aria-hidden>{st.here || on ? "✓" : ""}</span>
                      <span className="min-w-0 flex-1"><b className="text-sm">{w.name}</b><small className="ml-1.5 text-xs text-zinc-500">{w.team}</small>{w.dual && <small className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">겸직</small>}</span>
                      {st.leave ? <small className="shrink-0 text-xs font-bold text-amber-700">휴가 (승인됨)</small> : st.here ? <small className="shrink-0 text-xs font-bold text-blue-600">이 현장에 배치됨</small> : st.elsewhere.length ? <small className="shrink-0 text-right text-xs font-bold text-amber-600">현재 {st.elsewhere.join(", ")} → 옮겨져요</small> : <small className="shrink-0 text-xs text-zinc-400">미배치</small>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setM(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
              <button type="button" disabled={busy || pick.size === 0} onClick={() => void call({ action: "assign", date: m.date, siteId: m.siteId, memberIds: [...pick], slot: m.slot }, "{n}명을 배치했어요").then(ok => { if (ok) setPick(new Set()); })} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "배치 중…" : pick.size ? `${pick.size}명 ${SLOT_TABS.find(t => t.v === m.slot)!.label} 배치` : "배치"}</button>
            </div>
          </div>
        )}
      </Modal>

      {/* 그날 작업 내용 */}
      <Modal open={noteEdit !== null} onClose={() => !busy && setNoteEdit(null)}>
        {noteEdit && (
          <form onSubmit={e => { e.preventDefault(); void call({ action: "note", date: noteEdit.date, siteId: noteEdit.siteId, note: noteEdit.text }, "작업 내용을 저장했어요").then(ok => { if (ok) setNoteEdit(null); }); }}>
            <h2 className="text-lg font-bold">작업 내용</h2>
            <p className="mt-1 text-sm text-zinc-500">{siteMap.get(noteEdit.siteId)?.name} · {label(noteEdit.date)}</p>
            <input autoFocus value={noteEdit.text} onChange={e => setNoteEdit({ ...noteEdit, text: e.target.value })} maxLength={200} placeholder="예: 방통 주방 방수" autoComplete="off" className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
            <p className="mt-1 text-xs text-zinc-500">현장작업자의 “내 배치”에도 보여요. 비우고 저장하면 지워져요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setNoteEdit(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
