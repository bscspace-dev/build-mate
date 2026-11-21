"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buildXlsx, downloadBlob, type Sheet } from "@/lib/xlsx-export";
import { Modal } from "@/components/Sheet";
import { cycleFor, cyclePeriod, cycleText, FIRST_FROM, monthOfDate, periodOf, shiftYm, type Cycle, type CycleEntry } from "@/lib/attendance-cycle";
import { addDays, daysBetween, fmtDate } from "@/lib/site-period";
import { ALL_SLOTS, slotLabel, slotWeight, type Placement, type Slot } from "@/lib/types";

export type WorkerLite = { id: string; name: string; team: string; isPm: boolean };

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const dow = (d: string) => new Date(d + "T00:00:00").getDay();
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1)); // 0.5 단위

// 출근관리: 현장배치에서 계산한 작업자별 출근 일수 표. 종일 1일, 오전 또는 오후만 0.5일. 일요일은 쉬는 날이라 세지 않는다.
// 출근 = 오늘까지 배치된 날, 예정 = 오늘 이후에 배치된 날.
export default function AttendanceAdmin({ ownOnly, cycles, ym, canSetCycle, from, to, clamped, maxDays, workers, placements, leaves, sites }: { leaves: { memberId: string; startDate: string; endDate: string; kind: "full" | "am" | "pm" }[]; ownOnly: boolean; cycles: CycleEntry[]; ym: string; canSetCycle: boolean; from: string; to: string; clamped: boolean; maxDays: number; workers: WorkerLite[]; placements: Placement[]; sites: { id: string; name: string }[] }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("sv-SE");
  const [tab, setTab] = useState<"day" | "site">("day");
  const [q, setQ] = useState("");
  const [cycleOpen, setCycleOpen] = useState(false); // 조회 기준 등록·수정 창
  const [draft, setDraft] = useState<Cycle>({ startDay: 1, endDay: 31 });
  const [effDate, setEffDate] = useState(""); // 새 기준을 적용하기 시작할 날짜 (그 날짜가 든 기간부터 새 기준)
  const [saving, setSaving] = useState(false);
  const [cycleErr, setCycleErr] = useState("");

  // 조회 기간 (시작일 ~ 종료일). 달이 바뀌면 열 이름에 월/일을 같이 보여 준다.
  const span = daysBetween(from, to) + 1;
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const multiMonth = from.slice(0, 7) !== to.slice(0, 7);
  const dayLabel = (d: string) => (multiMonth ? `${Number(d.slice(5, 7))}/${Number(d.slice(8))}` : `${Number(d.slice(8))}일`);
  const workDays = days.filter(d => dow(d) !== 0);
  const siteName = new Map(sites.map(s => [s.id, s.name]));
  const wIds = new Set(workers.map(w => w.id));

  // (회원, 날짜) → 시간대별 현장,  일요일 배치는 세지 않는다
  const cell = new Map<string, { slots: Set<Slot>; sites: Set<string> }>();
  for (const p of placements) {
    if (!wIds.has(p.memberId) || dow(p.date) === 0) continue;
    const k = `${p.memberId}|${p.date}`;
    const c = cell.get(k) ?? { slots: new Set<Slot>(), sites: new Set<string>() };
    c.slots.add(p.slot);
    c.sites.add(siteName.get(p.siteId) ?? "삭제된 현장");
    cell.set(k, c);
  }
  // 출근 일수(공수): 오전 0.5 + 오후 0.5(종일 1) · 야근 0.5 · 심야 1
  // 야간과 심야가 같은 날 둘 다 있으면 심야 1일만 센다 (0.5+1=1.5가 아니라 1)
  const valueOf = (id: string, d: string) => { const sl = cell.get(`${id}|${d}`)?.slots; return sl ? [...sl].filter(x => !(x === "ot" && sl.has("nt"))).reduce((n, x) => n + slotWeight(x), 0) : 0; };
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const shown = workers.filter(w => !q.trim() || norm(w.name + w.team).includes(norm(q)));
  const done = (id: string) => workDays.filter(d => d <= today).reduce((n, d) => n + valueOf(id, d), 0); // 출근
  const plan = (id: string) => workDays.filter(d => d > today).reduce((n, d) => n + valueOf(id, d), 0); // 예정
  // 승인된 휴가: 출근 일수에는 세지 않고 "휴가"로 표시한다 (종일 1일, 반차 0.5일)
  const leaveOf = (id: string, d: string) => leaves.find(l => l.memberId === id && d >= l.startDate && d <= l.endDate);
  const leaveDaysOf = (id: string) => workDays.reduce((n, d) => { const l = leaveOf(id, d); return n + (l ? (l.kind === "full" ? 1 : 0.5) : 0); }, 0);
  const dayTotal = (d: string) => shown.reduce((n, w) => n + valueOf(w.id, d), 0);
  const grandDone = shown.reduce((n, w) => n + done(w.id), 0);
  const grandPlan = shown.reduce((n, w) => n + plan(w.id), 0);

  // 현장별: 이 달에 배치가 있는 현장만 열로
  const siteCols = sites.filter(s => placements.some(p => p.siteId === s.id && dow(p.date) !== 0 && wIds.has(p.memberId)));
  const bySite = (id: string, siteId: string, future: boolean) => {
    const dd = new Map<string, number>();
    for (const p of placements) if (p.memberId === id && p.siteId === siteId && dow(p.date) !== 0 && (p.date > today) === future && !(p.slot === "ot" && cell.get(`${id}|${p.date}`)?.slots.has("nt"))) dd.set(p.date, (dd.get(p.date) ?? 0) + slotWeight(p.slot));
    return [...dd.values()].reduce((a, b) => a + b, 0);
  };

  // 기본: 등록된 기준에 따른 달별 조회(?m=). 직접 기간(?from=&to=)도 쓸 수 있다.
  const go = (f: string, t: string) => router.push(`/admin/attendance?from=${f}&to=${t}`);
  const goYm = (m: string) => router.push(`/admin/attendance?m=${m}`);
  const nowYm = monthOfDate(cycles, today); // 오늘이 속한 분
  const shownYm = ym || nowYm;
  const cycle = cycleFor(cycles, shownYm); // 지금 보는 달분에 적용된 기준 (기준을 바꿔도 지난 달은 그때 기준)
  const setFrom = (f: string) => { if (f) go(f, to < f ? addDays(f, span - 1) : to); };
  const setTo = (t: string) => { if (t) go(from > t ? t : from, t); };
  // 기간은 모두 날짜로 보여 준다. 새 기준의 적용 시작일이 든 기간부터 새 기준이 된다.
  const range = (m: string, c: Cycle) => { const p = cyclePeriod(c, m); return `${fmtDate(p.from)} ~ ${fmtDate(p.to)}`; };
  const effYm = effDate ? monthOfDate([{ ...draft, from: FIRST_FROM }], effDate) : ""; // 새 기준에서 그 날짜가 속한 기간
  const startOf = (e: CycleEntry) => (e.from === FIRST_FROM ? "처음부터" : `${fmtDate(cyclePeriod(e, e.from).from)}부터`); // 이력 표시: 기준이 시작되는 날짜
  const openCycle = () => { setDraft(cycleFor(cycles, nowYm)); setEffDate(periodOf(cycles, nowYm).from); setCycleErr(""); setCycleOpen(true); };
  async function saveCycle() {
    if (saving) return;
    setSaving(true);
    setCycleErr("");
    try {
      const r = await fetch("/api/admin/attendance-cycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, from: effYm }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? "저장하지 못했어요.");
      setCycleOpen(false);
      router.push(`/admin/attendance?m=${effYm}`); // 새 기준이 시작되는 기간부터 보여 준다
      router.refresh();
    } catch (e) {
      setCycleErr(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  }

  function exportXlsx() {
    const a: Sheet = {
      name: "일자별",
      header: ["이름", "팀", ...days.map(d => `${dayLabel(d)}(${WEEK[dow(d)]})`), "출근(공수)", "예정(공수)", "휴가(일)"],
      rows: shown.map(w => [w.name, w.team, ...days.map(d => (dow(d) === 0 ? "휴" : valueOf(w.id, d) || (leaveOf(w.id, d) ? "휴가" : null))), done(w.id), plan(w.id), leaveDaysOf(w.id) || null]),
      widths: [12, 14, ...days.map(() => 6), 11, 11, 10],
    };
    const b: Sheet = {
      name: "현장별",
      header: ["이름", "팀", ...siteCols.map(s => s.name), "출근(공수)", "예정(공수)", "휴가(일)"],
      rows: shown.map(w => [w.name, w.team, ...siteCols.map(s => bySite(w.id, s.id, false) + bySite(w.id, s.id, true) || null), done(w.id), plan(w.id), leaveDaysOf(w.id) || null]),
      widths: [12, 14, ...siteCols.map(() => 14), 11, 11, 10],
    };
    downloadBlob(buildXlsx([a, b]), `출근현황_${from}_${to}.xlsx`);
  }

  const th = "border-b border-l border-black/10 px-1 py-1.5 text-center text-[11px] font-bold dark:border-white/10";
  return (
    <div className="mx-auto w-full max-w-[100rem] flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">출근관리</h1>
        <button type="button" onClick={exportXlsx} className="rounded-xl bg-emerald-50 px-3.5 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">엑셀 내보내기</button>
      </header>
      <p className="mb-3 rounded-2xl bg-blue-50 p-3.5 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">출근 일수는 <b>현장배치</b>에서 계산해요. 종일 배치는 1일, 오전 또는 오후만 배치된 날은 0.5일, 승인된 <b>휴가</b>는 <b>“휴가”</b> 칸(노란색)으로 표시되고 출근에 세지 않아요. 거기에 <b>야간(오후 5~8시)은 +0.5일, 심야(오후 8~10시)는 +1일</b>이 더해지는데, 야간과 심야는 하루에 하나만 세요(둘 다 있으면 심야 1일만). <b>일요일은 쉬는 날</b>이라 세지 않아요. 날짜 칸에는 출근한 날 <b>+1</b>(반나절은 <b>+0.5</b>)로 표시돼요. <b>출근</b>은 오늘까지 배치된 날, <b>예정</b>은 오늘 이후에 배치된 날이에요.{ownOnly && <> <b className="text-blue-700 dark:text-blue-300">내 출근만 보여요.</b> (전체 인원 조회 권한이 필요하면 최고 관리자나 개발팀에 요청해 주세요.)</>}</p>

      {/* 조회 기준: 등록해 두면 매달 그 기준대로 달별로 본다 */}
      <div className="rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-extrabold">조회 기준</span>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">{cycleText(cycle)}</span>
          {canSetCycle && <button type="button" onClick={openCycle} className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-bold dark:border-white/15">기준 등록·수정</button>}
          {!canSetCycle && <span className="text-xs text-zinc-500">기준은 등록 권한이 있는 담당자가 정해요</span>}
          {cycles.length > 1 && <details className="text-xs text-zinc-600 dark:text-zinc-300"><summary className="cursor-pointer font-bold">기준 변경 이력 {cycles.length}건</summary><ul className="mt-1 space-y-0.5">{cycles.map(e => <li key={e.from}>{startOf(e)} · {cycleText(e)}</li>)}</ul></details>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => goYm(shiftYm(shownYm, -1))} aria-label="이전 기간" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">‹</button>
          <b className="text-center text-lg">{fmtDate(from)} ~ {fmtDate(to)}</b>
          <button type="button" onClick={() => goYm(shiftYm(shownYm, 1))} aria-label="다음 기간" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">›</button>
          <label className="flex items-center gap-1.5 text-xs font-bold text-zinc-500">날짜로 이동
            <input type="date" aria-label="이 날짜가 든 기간으로 이동" value="" onChange={e => e.target.value && goYm(monthOfDate(cycles, e.target.value))} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-normal text-zinc-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100" />
          </label>
          <button type="button" onClick={() => goYm(nowYm)} className={`rounded-lg px-3 py-2 text-xs font-bold ${ym === nowYm ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>오늘이 든 기간</button>
          <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{span}일간</span>
        </div>
        <details className="mt-2" open={!ym}>
          <summary className="cursor-pointer text-xs font-bold text-zinc-500">직접 기간으로 보기</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="date" aria-label="시작일" value={from} onChange={e => setFrom(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
            <span className="text-zinc-400" aria-hidden>~</span>
            <input type="date" aria-label="종료일" value={to} min={from} onChange={e => setTo(e.target.value)} className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
            <span className="text-xs text-zinc-500">최대 {maxDays}일</span>
          </div>
        </details>
      </div>
      {clamped && <p className="mt-2 text-sm font-semibold text-amber-700 dark:text-amber-300">기간이 길어서 시작일부터 {maxDays}일까지만 보여요. 더 긴 기간은 나눠서 조회해 주세요.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="표 종류">
          {([["day", "일자별"], ["site", "현장별"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={tab === v} onClick={() => setTab(v)} className={`px-3.5 py-2 ${tab === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{l}</button>)}
        </div>
        {!ownOnly && <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·팀 검색" className="ml-auto min-w-[10rem] rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-[14rem] dark:border-white/15 dark:bg-zinc-900" />}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-blue-100 px-3 py-1 font-bold text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">출근 합계 {fmt(grandDone)}일</span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">예정 {fmt(grandPlan)}일</span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">인원 {shown.length}명 · 근무일 {workDays.length}일 (일요일 제외)</span>
      </div>

      {workers.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">{ownOnly ? "조회할 출근 정보가 없어요." : "현장 부서 회원이 없어요. 회원 관리에서 먼저 만들어 주세요."}</p>
      ) : tab === "day" ? (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800">
                <th className="sticky left-0 z-10 min-w-28 border-b border-r border-black/15 bg-zinc-100 px-2 py-2 text-left text-xs font-bold dark:border-white/15 dark:bg-zinc-800">이름</th>
                {days.map(d => (
                  <th key={d} className={`${th} min-w-11 ${dow(d) === 0 ? "bg-zinc-200 text-red-600 dark:bg-zinc-700" : dow(d) === 6 ? "text-blue-600" : ""} ${d === today ? "ring-2 ring-inset ring-blue-500" : ""}`}>{dayLabel(d)}<div className="font-normal">{WEEK[dow(d)]}</div></th>
                ))}
                <th className={`${th} min-w-14 bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200`}>출근</th>
                <th className={`${th} min-w-14`}>예정</th>
                <th className={`${th} min-w-14 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200`}>휴가</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(w => (
                <tr key={w.id} className="border-b border-black/5 dark:border-white/5">
                  <th className="sticky left-0 z-10 border-r border-black/15 bg-white px-2 py-1.5 text-left text-[13px] font-bold dark:border-white/15 dark:bg-zinc-900">{w.name}{w.isPm && <small className="ml-1 text-[10px] text-zinc-500">PM</small>}<div className="text-[10px] font-normal text-zinc-500">{w.team}</div></th>
                  {days.map(d => {
                    if (dow(d) === 0) return <td key={d} className="border-l border-black/5 bg-zinc-100 text-center text-[10px] text-zinc-400 dark:border-white/5 dark:bg-zinc-800">휴</td>;
                    const c = cell.get(`${w.id}|${d}`);
                    const v = valueOf(w.id, d);
                    const lv = leaveOf(w.id, d);
                    const sl = c ? ALL_SLOTS.filter(s => c.slots.has(s)) : [];
                    return (
                      <td key={d} title={lv && !c ? `승인된 휴가 (${lv.kind === "full" ? "종일" : lv.kind === "am" ? "오전 반차" : "오후 반차"})` : c ? `${[...c.sites].join(", ")} · ${sl.every(x => x === "am" || x === "pm") && sl.length === 2 ? "종일" : sl.map(slotLabel).join("+")}` : undefined} className={`border-l border-black/5 text-center text-xs font-bold dark:border-white/5 ${!v && lv ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200" : ""} ${v > 1 ? (d > today ? "bg-indigo-50 text-indigo-400 dark:bg-indigo-500/10" : "bg-indigo-600 text-white") : v === 1 ? (d > today ? "bg-blue-50 text-blue-400 dark:bg-blue-500/10" : "bg-blue-500 text-white") : v > 0 ? (d > today ? "bg-sky-50 text-sky-400 dark:bg-sky-500/10" : "bg-sky-200 text-sky-900") : ""}`}>{v ? `+${fmt(v)}` : lv ? "휴가" : ""}</td>
                    );
                  })}
                  <td className="border-l border-black/10 bg-blue-50 px-1 text-center font-extrabold text-blue-800 dark:border-white/10 dark:bg-blue-500/10 dark:text-blue-200">{fmt(done(w.id))}</td>
                  <td className="border-l border-black/10 px-1 text-center text-zinc-500">{plan(w.id) ? fmt(plan(w.id)) : ""}</td>
                  <td className="border-l border-black/10 bg-amber-50 px-1 text-center font-bold text-amber-800 dark:border-white/10 dark:bg-amber-500/10 dark:text-amber-200">{leaveDaysOf(w.id) ? fmt(leaveDaysOf(w.id)) : ""}</td>
                </tr>
              ))}
              <tr className="bg-zinc-100 font-extrabold dark:bg-zinc-800">
                <th className="sticky left-0 z-10 border-r border-black/15 bg-zinc-100 px-2 py-2 text-left text-xs dark:border-white/15 dark:bg-zinc-800">하루 인원</th>
                {days.map(d => <td key={d} className="border-l border-black/10 text-center text-xs dark:border-white/10">{dow(d) === 0 ? "" : dayTotal(d) ? fmt(dayTotal(d)) : ""}</td>)}
                <td className="border-l border-black/10 text-center text-blue-800 dark:border-white/10 dark:text-blue-200">{fmt(grandDone)}</td>
                <td className="border-l border-black/10 text-center dark:border-white/10">{grandPlan ? fmt(grandPlan) : ""}</td>
                <td className="border-l border-black/10 text-center text-amber-800 dark:border-white/10 dark:text-amber-200">{shown.reduce((n, w) => n + leaveDaysOf(w.id), 0) || ""}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800">
                <th className="sticky left-0 z-10 min-w-28 border-b border-r border-black/15 bg-zinc-100 px-2 py-2 text-left text-xs font-bold dark:border-white/15 dark:bg-zinc-800">이름</th>
                {siteCols.map(s => <th key={s.id} className={`${th} min-w-24`}>{s.name}</th>)}
                <th className={`${th} min-w-16 bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200`}>출근</th>
                <th className={`${th} min-w-16`}>예정</th>
                <th className={`${th} min-w-16 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200`}>휴가</th>
              </tr>
            </thead>
            <tbody>
              {siteCols.length === 0 && <tr><td colSpan={3} className="p-8 text-center text-zinc-500">이 달에 배치된 현장이 없어요.</td></tr>}
              {siteCols.length > 0 && shown.map(w => (
                <tr key={w.id} className="border-b border-black/5 dark:border-white/5">
                  <th className="sticky left-0 z-10 border-r border-black/15 bg-white px-2 py-1.5 text-left text-[13px] font-bold dark:border-white/15 dark:bg-zinc-900">{w.name}<div className="text-[10px] font-normal text-zinc-500">{w.team}</div></th>
                  {siteCols.map(s => {
                    const a = bySite(w.id, s.id, false);
                    const b = bySite(w.id, s.id, true);
                    return <td key={s.id} className="border-l border-black/5 px-1 text-center text-xs font-bold dark:border-white/5">{a ? fmt(a) : ""}{b ? <span className="ml-0.5 font-normal text-zinc-400">+{fmt(b)}</span> : ""}</td>;
                  })}
                  <td className="border-l border-black/10 bg-blue-50 px-1 text-center font-extrabold text-blue-800 dark:border-white/10 dark:bg-blue-500/10 dark:text-blue-200">{fmt(done(w.id))}</td>
                  <td className="border-l border-black/10 px-1 text-center text-zinc-500">{plan(w.id) ? fmt(plan(w.id)) : ""}</td>
                  <td className="border-l border-black/10 bg-amber-50 px-1 text-center font-bold text-amber-800 dark:border-white/10 dark:bg-amber-500/10 dark:text-amber-200">{leaveDaysOf(w.id) ? fmt(leaveDaysOf(w.id)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">칸 위에 마우스를 올리면 그날의 현장이 보여요. 진한 칸은 출근, 옅은 칸은 예정이에요. 현장별 표의 <span className="text-zinc-400">+숫자</span>는 오늘 이후 예정이에요.</p>
      <Modal open={cycleOpen} onClose={() => !saving && setCycleOpen(false)}>
        <h2 className="text-lg font-bold">출근 조회 기준 등록</h2>
        <p className="mt-1 text-sm text-zinc-500">매달 며칠부터 며칠까지를 한 달로 볼지 정해요. 적용 시작일이 든 기간부터 새 기준으로 조회되고, <b>그 이전 기간은 예전 기준 그대로</b> 날짜로 보여요.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">매월</span>
          <select aria-label="시작일" value={draft.startDay} onChange={e => setDraft({ ...draft, startDay: Number(e.target.value) })} className="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-base font-bold dark:border-white/15">
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d === 31 ? "말일" : d + "일"}</option>)}
          </select>
          <span className="text-sm font-bold">부터</span>
          <select aria-label="종료일" value={draft.endDay} onChange={e => setDraft({ ...draft, endDay: Number(e.target.value) })} className="rounded-xl border border-black/15 bg-transparent px-3 py-2.5 text-base font-bold dark:border-white/15">
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d === 31 ? "말일" : d + "일"}</option>)}
          </select>
          <span className="text-sm font-bold">까지</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">적용 시작일</span>
          <input type="date" aria-label="적용 시작일" value={effDate} onChange={e => e.target.value && setEffDate(e.target.value)} className="rounded-xl border border-black/15 bg-transparent px-3 py-2 text-base font-bold dark:border-white/15" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {([[1, 31, "1일~말일"], [21, 20, "21일~다음달 20일"], [26, 25, "26일~다음달 25일"]] as const).map(([a, b, l]) => <button key={l} type="button" onClick={() => setDraft({ startDay: a, endDay: b })} className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold dark:bg-zinc-800">{l}</button>)}
        </div>
        <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-500/10 dark:text-blue-100">
          <b>{cycleText(draft)}</b>
          <div className="mt-1 text-xs">{draft.startDay >= draft.endDay ? "시작일이 종료일과 같거나 더 늦으면 지난달 시작일부터 이번 달 종료일까지가 한 기간이에요(두 날짜 모두 포함, 예: 9일~9일 = 10/9~11/9). " : ""}31일이 없는 달은 그 달 말일로 계산해요.</div>
          <div className="mt-1 text-xs font-semibold">새 기준 적용 기간: {effYm ? range(effYm, draft) : "—"} 부터</div>
          <div className="mt-1 text-xs text-blue-700 dark:text-blue-300">{effYm ? `그 이전 기간은 지금까지 쓰던 기준 그대로 조회돼요: ${range(shiftYm(effYm, -1), cycleFor(cycles, shiftYm(effYm, -1)))}` : ""}</div>
        </div>
        {cycles.length > 1 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer font-bold text-zinc-500">등록된 기준 이력</summary>
            <ul className="mt-1.5 space-y-1">
              {cycles.map((e, i) => (
                <li key={e.from} className="flex items-center gap-2">
                  <span className="flex-1">{startOf(e)} · {cycleText(e)}</span>
                  {i > 0 && <button type="button" disabled={saving} onClick={async () => { setSaving(true); try { await fetch("/api/admin/attendance-cycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", from: e.from }) }); router.refresh(); } finally { setSaving(false); } }} className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                </li>
              ))}
            </ul>
          </details>
        )}
        {cycleErr && <p className="mt-3 text-sm text-red-500" role="alert">{cycleErr}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={saving} onClick={() => setCycleOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button type="button" disabled={saving} onClick={() => void saveCycle()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{saving ? "저장 중…" : "기준 저장"}</button>
        </div>
      </Modal>
    </div>
  );
}
