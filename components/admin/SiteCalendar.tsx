"use client";

import { useMemo, useState } from "react";
import { sitePeriod } from "@/lib/site-period";
import type { Site } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// 현장마다 바(막대) 색을 다르게 (마감 임박은 붉은색, 종료는 회색으로 덮어쓴다)
const PALETTE = [
  "bg-blue-500", "bg-violet-500", "bg-teal-500", "bg-orange-500", "bg-pink-500", "bg-indigo-500", "bg-lime-600", "bg-cyan-600",
];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10); // UTC 기준 YYYY-MM-DD
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

type Seg = { site: Site; col: number; span: number; left: boolean; right: boolean; color: string; urgent: boolean; ended: boolean };

// 현장 달력(스케줄러): 공사기간이 있는 현장을 날짜에 걸친 막대로 보여 준다. 막대를 누르면 현장 정보가 열린다.
export default function SiteCalendar({ sites, onPick }: { sites: Site[]; onPick: (s: Site) => void }) {
  const todayIso = new Date().toLocaleDateString("sv-SE");
  const [ym, setYm] = useState(() => ({ y: Number(todayIso.slice(0, 4)), m: Number(todayIso.slice(5, 7)) - 1 }));

  // 공사기간이 하나라도 있는 현장만 막대가 된다 (시작만/종료만 있으면 그 하루)
  const dated = useMemo(
    () => sites.flatMap((s, i) => {
      const a = s.startDate || s.endDate;
      const b = s.endDate || s.startDate;
      if (!a || !b) return [];
      return [{ site: s, a, b: b < a ? a : b, color: PALETTE[i % PALETTE.length] }];
    }),
    [sites],
  );
  const undated = sites.filter(s => !s.startDate && !s.endDate);

  const first = utc(ym.y, ym.m, 1);
  const daysInMonth = new Date(utc(ym.y, ym.m + 1, 0)).getUTCDate();
  const lead = new Date(first).getUTCDay();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const gridStart = first - lead * DAY;

  const weeks = useMemo(() => {
    return Array.from({ length: weekCount }, (_, w) => {
      const days = Array.from({ length: 7 }, (_, i) => iso(gridStart + (w * 7 + i) * DAY));
      const segs: Seg[] = [];
      for (const d of dated) {
        if (d.b < days[0] || d.a > days[6]) continue;
        const s0 = d.a < days[0] ? days[0] : d.a;
        const e0 = d.b > days[6] ? days[6] : d.b;
        const col = Math.round((Date.parse(s0) - Date.parse(days[0])) / DAY);
        const span = Math.round((Date.parse(e0) - Date.parse(s0)) / DAY) + 1;
        const info = sitePeriod(d.site.startDate, d.site.endDate);
        segs.push({ site: d.site, col, span, left: d.a < days[0], right: d.b > days[6], color: d.color, urgent: info.urgent, ended: info.badge?.label === "공사 종료" });
      }
      // 겹치는 막대는 줄(레인)을 나눠서 쌓는다
      segs.sort((x, y) => x.col - y.col || y.span - x.span);
      const laneEnd: number[] = [];
      const placed = segs.map(sg => {
        let lane = laneEnd.findIndex(end => end <= sg.col);
        if (lane < 0) { lane = laneEnd.length; laneEnd.push(0); }
        laneEnd[lane] = sg.col + sg.span;
        return { ...sg, lane };
      });
      return { days, placed, lanes: laneEnd.length };
    });
  }, [dated, weekCount, gridStart]);

  const move = (delta: number) => setYm(p => { const t = new Date(utc(p.y, p.m + delta, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() }; });

  return (
    <div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => move(-1)} aria-label="이전 달" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-bold dark:border-white/15">‹</button>
        <h2 className="min-w-28 text-center text-lg font-extrabold">{ym.y}년 {ym.m + 1}월</h2>
        <button type="button" onClick={() => move(1)} aria-label="다음 달" className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-bold dark:border-white/15">›</button>
        <button type="button" onClick={() => setYm({ y: Number(todayIso.slice(0, 4)), m: Number(todayIso.slice(5, 7)) - 1 })} className="ml-1 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">오늘</button>
        <span className="ml-auto hidden text-xs text-zinc-500 sm:inline">막대를 누르면 현장 정보가 열려요</span>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
        <div className="grid grid-cols-7 border-b border-black/10 bg-zinc-50 text-center text-xs font-bold dark:border-white/10 dark:bg-zinc-800/60">
          {WEEKDAYS.map((w, i) => <div key={w} className={`py-1.5 ${i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-500"}`}>{w}</div>)}
        </div>
        {weeks.map((wk, wi) => (
          <div key={wi} className="relative border-b border-black/5 last:border-0 dark:border-white/5" style={{ minHeight: 28 + Math.max(1, wk.lanes) * 24 + 8 }}>
            {/* 날짜 칸 (세로 구분선·오늘 표시) */}
            <div className="absolute inset-0 grid grid-cols-7" aria-hidden>
              {wk.days.map((d, i) => {
                const inMonth = Number(d.slice(5, 7)) - 1 === ym.m;
                return (
                  <div key={d} className={`border-l border-black/5 px-1 pt-0.5 first:border-l-0 dark:border-white/5 ${d === todayIso ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}>
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${d === todayIso ? "bg-blue-600 text-white" : inMonth ? (i === 0 ? "text-red-500" : i === 6 ? "text-blue-500" : "text-zinc-700 dark:text-zinc-200") : "text-zinc-300 dark:text-zinc-600"}`}>{Number(d.slice(8, 10))}</span>
                  </div>
                );
              })}
            </div>
            {/* 현장 막대 */}
            <div className="relative grid grid-cols-7 gap-y-1 px-0.5 pt-7" style={{ gridAutoRows: 20 }}>
              {wk.placed.map(sg => (
                <button
                  key={sg.site.id + ":" + wi}
                  type="button"
                  onClick={() => onPick(sg.site)}
                  title={`${sg.site.name} · ${sitePeriod(sg.site.startDate, sg.site.endDate).text}`}
                  style={{ gridColumn: `${sg.col + 1} / span ${sg.span}`, gridRow: sg.lane + 1 }}
                  className={`truncate px-1.5 text-left text-[11px] font-bold leading-5 text-white shadow-sm hover:brightness-110 ${sg.urgent ? "bg-red-600" : sg.ended ? "bg-zinc-400" : sg.color} ${sg.left ? "rounded-l-none" : "rounded-l-md"} ${sg.right ? "rounded-r-none" : "rounded-r-md"}`}
                >
                  {sg.left && <span aria-hidden>◂ </span>}{sg.site.name}{sg.right && <span aria-hidden> ▸</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded bg-red-600" />마감 7일 이내</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded bg-zinc-400" />공사 종료</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded bg-blue-500" />진행·예정 (현장마다 색이 달라요)</span>
      </div>

      {undated.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-bold text-zinc-500">공사기간 미정 <span className="font-normal">{undated.length}곳</span></h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {undated.map(s => <button key={s.id} type="button" onClick={() => onPick(s)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-sm hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900">{s.name}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
