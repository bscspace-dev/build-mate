"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays, fmtDate, sitePeriod } from "@/lib/site-period";
import type { Site } from "@/lib/types";

type Stage = "ing" | "before" | "done" | "tbd";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const DAY = 86_400_000;
const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
const nextWork = (d: string) => (dow(d) === 0 ? addDays(d, 1) : d); // 일요일은 쉬는 날
const stepWork = (d: string, n: 1 | -1) => (dow(addDays(d, n)) === 0 ? addDays(d, 2 * n) : addDays(d, n)); // 일요일을 건너뛰며 하루씩 이동

// 그 날짜에 이 현장이 어느 단계인지: 공사 중 / 착공 전 / 종료 / 기간 미정
function stageOf(s: Site, date: string): Stage {
  if (!s.startDate && !s.endDate) return "tbd";
  if (s.endDate && s.endDate < date) return "done";
  if (s.startDate && s.startDate > date) return "before";
  return "ing";
}

export type CrewMap = Record<string, { name: string; tag: string }[]>;
/** 최근 3일 안의 업데이트 (현장 id → 새 작업일보 수·도면·정보 변경 시점) */
export type SiteNews = Record<string, { posts: number; postsAgo: string; drawing: string; info: string }>;

function NewsBadges({ n }: { n?: SiteNews[string] }) {
  if (!n) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="최근 업데이트">
      {n.posts > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-extrabold text-rose-700 dark:bg-rose-500/20 dark:text-rose-200">🆕 작업일보 {n.posts}건 · {n.postsAgo}</span>}
      {n.drawing && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-extrabold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200">📐 도면 업데이트 · {n.drawing}</span>}
      {n.info && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">✏️ 정보 수정 · {n.info}</span>}
    </div>
  );
}

// 현장정보(현장배치 '하루씩' 보기를 본뜬 날짜별 카드): 날짜를 넘기며 그날 공사 중인 현장을 보고,
// 배치 인원과 작업 내용을 함께 보고, 작업일보로 바로 들어간다.
export default function SiteBoard({
  sites, date, pmName, showCrew, crew, news, notes, onPick,
}: {
  sites: Site[]; date: string; pmName: (id: string) => string; showCrew: boolean; crew: CrewMap; news: SiteNews; notes: Record<string, string>; onPick: (s: Site) => void;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const [q, setQ] = useState("");
  const [others, setOthers] = useState(false); // 그 밖의 현장(착공 전·종료·기간 미정) 펼치기
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const kw = norm(q);
  const go = (d: string) => router.push(`/admin/sites?d=${d}`);
  const list = sites.filter(s => !kw || norm(s.name + s.address + pmName(s.pmId)).includes(kw));
  const active = list.filter(s => stageOf(s, date) === "ing").sort((a, b) => (a.endDate || "9999").localeCompare(b.endDate || "9999")); // 마감 임박순
  const rest = list.filter(s => stageOf(s, date) !== "ing").sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const label = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${WEEK[dow(date)]})`;

  return (
    <div className="mt-2">
      {/* 날짜 이동: 현장배치 하루씩 보기와 같은 구성 */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(stepWork(date, -1))} aria-label="전날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">‹</button>
        <input type="date" aria-label="날짜" value={date} onChange={e => e.target.value && go(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-blue-500 sm:flex-none dark:border-white/15 dark:bg-zinc-900" />
        <button type="button" onClick={() => go(stepWork(date, 1))} aria-label="다음날" className="rounded-lg border border-black/15 px-3 py-2 text-sm font-bold dark:border-white/15">›</button>
        <button type="button" onClick={() => go(nextWork(today))} className={`rounded-lg px-3 py-2 text-xs font-bold ${date === nextWork(today) ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>오늘</button>
        <button type="button" onClick={() => go(nextWork(addDays(today, 1)))} className={`rounded-lg px-3 py-2 text-xs font-bold ${date === nextWork(addDays(today, 1)) ? "bg-blue-600 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{dow(addDays(today, 1)) === 0 ? "다음 근무일" : "내일"}</button>
      </div>
      <h2 className="mt-3 text-2xl font-extrabold">{date.slice(0, 4)}년 {label}</h2>
      <p className="mt-0.5 text-sm text-zinc-500">공사 중인 현장 {active.length}곳{showCrew && <> · 배치 {active.reduce((n, s) => n + (crew[s.id]?.length ?? 0), 0)}명</>}</p>
      {dow(date) === 0 && <p className="mt-3 rounded-2xl bg-white p-4 text-center text-sm text-zinc-500 dark:bg-zinc-900">일요일은 쉬는 날이라 배치하지 않아요. (현장 일지는 올릴 수 있어요)</p>}

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="현장명·주소·담당 PM 검색" aria-label="현장 검색" className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
      {sites.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 현장이 없어요.</p>}

      {sites.length > 0 && active.length === 0 && <p className="mt-4 rounded-2xl bg-white p-6 text-center text-sm text-zinc-500 dark:bg-zinc-900">이 날 공사 중인 현장이 없어요. 아래 “그 밖의 현장”을 눌러 보세요.</p>}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {active.map(s => {
          const p = sitePeriod(s.startDate, s.endDate);
          const total = s.startDate && s.endDate ? Math.max(1, Math.round((Date.parse(s.endDate) - Date.parse(s.startDate)) / DAY) + 1) : 0;
          const passed = s.startDate ? Math.round((Date.parse(date) - Date.parse(s.startDate)) / DAY) + 1 : 0;
          const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((passed / total) * 100))) : null;
          const people = crew[s.id] ?? [];
          const note = notes[s.id];
          return (
            <li key={s.id} className={`flex flex-col rounded-2xl border bg-white p-4 dark:bg-zinc-900 ${p.urgent ? "border-red-400 dark:border-red-500/50" : "border-black/10 dark:border-white/10"}`}>
              <button type="button" onClick={() => onPick(s)} className="text-left" aria-label={`${s.name} 상세 보기`}>
                <div className="flex items-start gap-2">
                  <b className="min-w-0 flex-1 text-base leading-snug">🏗️ {s.name}</b>
                  {p.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${p.badge.cls}`}>{p.badge.label}</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{[pmName(s.pmId) && `담당 PM ${pmName(s.pmId)}`, s.startDate || s.endDate ? `${fmtDate(s.startDate) || "?"} ~ ${fmtDate(s.endDate) || "?"}` : "공사기간 미정"].filter(Boolean).join(" · ")}</p>
                {pct !== null && (
                  <div className="mt-2" aria-label={`공사 진행 ${pct}%`}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className={`h-full rounded-full ${p.urgent ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">{passed}일째 / 총 {total}일 ({pct}%)</div>
                  </div>
                )}
              </button>
              <NewsBadges n={news[s.id]} />
              {showCrew && (
                <>
                  <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${note ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : "bg-zinc-50 text-zinc-400 dark:bg-zinc-800/50"}`}>{note || "그날 작업 내용이 없어요"}</p>
                  <div className="mt-2 min-h-8">
                    {people.length === 0 ? <span className="text-sm text-zinc-400">배치된 인원이 없어요</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {people.map((w, i) => (
                          <span key={w.name + i} className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-semibold text-sky-900 dark:bg-sky-500/20 dark:text-sky-100">{w.name}{w.tag && <small className="ml-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">{w.tag}</small>}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="mt-3 flex items-center gap-2">
                {showCrew && <span className="text-xs font-bold text-zinc-500">{people.length}명</span>}
                <Link href={`/admin/sites/${s.id}?tab=report&write=1`} className="ml-auto rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white">📋 작업일보</Link>
              </div>
            </li>
          );
        })}
      </ul>

      {rest.length > 0 && (
        <section className="mt-6" aria-label="그 밖의 현장">
          <button type="button" onClick={() => setOthers(v => !v)} aria-expanded={others || !!kw} className="flex w-full items-center gap-2 text-left">
            <h3 className="mr-auto text-base font-extrabold">그 밖의 현장 <span className="text-sm font-semibold text-zinc-500">{rest.length}곳 · 착공 전·종료·기간 미정</span></h3>
            <span className="text-zinc-400" aria-hidden>{others || kw ? "▴" : "▾"}</span>
          </button>
          {(others || !!kw) && (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {rest.map(s => {
                const p = sitePeriod(s.startDate, s.endDate);
                return (
                  <li key={s.id} className="flex items-center gap-2 rounded-2xl border border-black/10 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-zinc-900">
                    <button type="button" onClick={() => onPick(s)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate">{s.name}</b>{p.badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${p.badge.cls}`}>{p.badge.label}</span>}</div>
                      <div className="truncate text-xs text-zinc-500">{p.text}</div>
                    </button>
                    <Link href={`/admin/sites/${s.id}?tab=report&write=1`} className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">작업일보</Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
