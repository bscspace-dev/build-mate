"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import SiteJournal from "@/components/admin/SiteJournal";
import { extensionDays, fmtDate } from "@/lib/site-period";

type Tab = "check" | "drawing" | "report";
export type SiteDetailData = {
  id: string; name: string; address: string; memo: string; photos: string[]; drawings: string[];
  startDate: string; endDate: string; pmName: string; extensions: { from: string; to: string }[];
};
const isPdf = (u: string) => u.toLowerCase().split("?")[0].endsWith(".pdf");

// 현장 상세: 현장확인(정보·사진) / 도면확인(도면을 바로 열어 봄) / 작업일보(하루씩 넘기며 보고 올림)
export type SiteStats = {
  today: string; createdAt: string; total: number; elapsed: number; postCount: number;
  crewToday: { name: string; tag: string }[] | null; note: string; people: number; workDays: number; manDays: number;
  recent: { id: string; date: string; body: string; authorName: string; photos: number }[];
};
const WK = ["일", "월", "화", "수", "목", "금", "토"];
const md = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 (${WK[new Date(d + "T00:00:00Z").getUTCDay()]})`;

export default function SiteDetail({ site, stats, tab: first = "check", write = false, badge, sub, actions }: { site: SiteDetailData; stats?: SiteStats; tab?: Tab; write?: boolean; badge?: ReactNode; sub?: string; actions?: ReactNode }) {
  const [tab, setTab] = useState<Tab>(first);
  const [dIdx, setDIdx] = useState(0);
  const tabs: [Tab, string, number?][] = [["check", "🏗️ 현장확인"], ["drawing", "📐 도면확인", site.drawings.length], ["report", "📋 작업일보"]];
  const cur = site.drawings[Math.min(dIdx, Math.max(0, site.drawings.length - 1))];
  return (
    <div className="mt-2">
      {/* 현장명 옆에 탭을 둔다: 현장확인 · 도면확인 · 작업일보 */}
      <header className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-extrabold">🏗️ {site.name}</h1>
      {write ? (
        <Link href={`/admin/sites/${site.id}`} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold dark:border-white/15">현장 상세 보기 →</Link>
      ) : (
      <div className="no-scrollbar flex min-w-0 gap-1.5 overflow-x-auto" role="tablist" aria-label="현장 상세">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`shrink-0 rounded-xl border px-3.5 py-2 text-sm font-extrabold ${tab === k ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{label}{!!n && <small className="ml-1.5 rounded-full bg-white/25 px-1.5">{n}</small>}</button>
        ))}
      </div>
      )}
          <div className="ml-auto flex items-center gap-2">{badge}{actions}</div>
        </div>
        {sub && <p className="mt-2 text-sm text-zinc-500">{sub}</p>}
      </header>

      {!write && tab === "check" && (
        <section className="mt-4 space-y-4" aria-label="현장확인">
          {stats && (
            <>
              {/* 진행 상황 */}
              {stats.total > 0 && (() => {
                const pct = Math.max(0, Math.min(100, Math.round((stats.elapsed / stats.total) * 100)));
                const left = stats.total - stats.elapsed;
                return (
                  <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-sm font-extrabold">공사 진행</h2>
                      <span className="text-xs text-zinc-500">{stats.elapsed < 1 ? "착공 전" : left < 0 ? `종료 후 ${-left}일` : `${stats.elapsed}일차 / 총 ${stats.total}일`}</span>
                      <b className="ml-auto text-lg">{stats.elapsed < 1 ? "대기" : `${pct}%`}</b>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${left < 0 ? "bg-red-500" : "bg-blue-600"}`} style={{ width: `${pct}%` }} /></div>
                    {left >= 0 && stats.elapsed >= 1 && <p className="mt-1.5 text-xs text-zinc-500">마감까지 {left}일 남았어요</p>}
                  </div>
                );
              })()}

              {/* 오늘 배치 · 누적 투입 */}
              {stats.crewToday && (
                <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                  <h2 className="text-sm font-extrabold">오늘({md(stats.today)}) 배치 <span className="font-semibold text-zinc-500">{stats.crewToday.length}명</span></h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {stats.crewToday.length === 0 ? <span className="text-sm text-zinc-500">오늘 배치된 인원이 없어요</span> : stats.crewToday.map((w, i) => (
                      <span key={w.name + i} className="rounded-full bg-sky-100 px-2.5 py-1 text-sm font-semibold text-sky-900 dark:bg-sky-500/20 dark:text-sky-100">{w.name}{w.tag && <small className="ml-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">{w.tag}</small>}</span>
                    ))}
                  </div>
                  {stats.note && <p className="mt-2 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">작업 내용 메모: {stats.note}</p>}
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                    {([["누적 투입 인원", `${stats.people}명`], ["투입 일수", `${stats.workDays}일`], ["누적 공수", `${stats.manDays}`]] as const).map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-zinc-50 py-2 dark:bg-zinc-800/60"><dt className="text-[11px] font-bold text-zinc-500">{k}</dt><dd className="text-base font-extrabold">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              )}

              {/* 최근 작업일보 */}
              <div className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-extrabold">최근 작업일보 <span className="font-semibold text-zinc-500">총 {stats.postCount}건</span></h2>
                  <button type="button" onClick={() => setTab("report")} className="ml-auto rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">작업일보 전체 보기 →</button>
                </div>
                {stats.recent.length === 0 ? <p className="mt-2 text-sm text-zinc-500">아직 올라온 작업일보가 없어요.</p> : (
                  <ul className="mt-2 divide-y divide-black/5 dark:divide-white/10">
                    {stats.recent.map(r => (
                      <li key={r.id} className="py-2 text-sm">
                        <div className="flex items-center gap-2 text-xs text-zinc-500"><b className="text-zinc-700 dark:text-zinc-200">{md(r.date)}</b><span>{r.authorName}</span>{r.photos > 0 && <span>📷 {r.photos}</span>}</div>
                        {r.body && <p className="mt-0.5 line-clamp-2 whitespace-pre-line">{r.body}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {site.photos.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {site.photos.map((u, i) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-800 ${site.photos.length === 1 ? "sm:col-span-2" : ""}`} title="눌러서 크게 보기">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt={`${site.name} 현장 사진 ${i + 1}`} loading="lazy" className={`w-full object-cover ${site.photos.length === 1 ? "max-h-[30rem]" : "h-56"}`} />
                </a>
              ))}
            </div>
          ) : <p className="rounded-2xl bg-white p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">등록된 현장 사진이 없어요.</p>}
          <dl className="space-y-2 rounded-2xl border border-black/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">공사기간</dt><dd>{site.startDate || site.endDate ? `${fmtDate(site.startDate) || "?"} ~ ${fmtDate(site.endDate) || "?"}` : "미정"}</dd></div>
            {site.extensions.length > 0 && (
              <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">마감 변경</dt><dd><ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">{site.extensions.map((e, i) => { const d = extensionDays(e); return <li key={i}>{d >= 0 ? "연장" : "단축"} {d >= 0 ? "+" : "−"}{Math.abs(d)}일 · {fmtDate(e.from)} → {fmtDate(e.to)}</li>; })}</ul></dd></div>
            )}
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">담당 PM</dt><dd>{site.pmName || <span className="text-zinc-400">미지정</span>}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">현장주소</dt><dd className="min-w-0">{site.address ? <a href={"https://map.naver.com/p/search/" + encodeURIComponent(site.address)} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-4 hover:text-blue-600">{site.address}</a> : <span className="text-zinc-400">—</span>}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">등록일</dt><dd>{stats?.createdAt ? fmtDate(stats.createdAt.slice(0, 10)) : "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-16 shrink-0 text-xs font-bold leading-5 text-zinc-500">특이사항</dt><dd className="min-w-0 whitespace-pre-line">{site.memo || <span className="text-zinc-400">—</span>}</dd></div>
          </dl>
        </section>
      )}

      {!write && tab === "drawing" && (
        <section className="mt-4" aria-label="도면확인">
          {site.drawings.length === 0 ? (
            <p className="rounded-2xl bg-white p-8 text-center text-sm text-zinc-500 dark:bg-zinc-900">등록된 도면이 없어요. 현장 수정에서 도면을 올릴 수 있어요.</p>
          ) : (
            <>
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {site.drawings.map((u, i) => (
                  <button key={u} type="button" aria-pressed={dIdx === i} onClick={() => setDIdx(i)} className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-bold ${dIdx === i ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{isPdf(u) ? "📄" : "🖼️"} 도면 {i + 1}</button>
                ))}
                <a href={cur} target="_blank" rel="noreferrer" className="ml-auto shrink-0 rounded-full bg-zinc-100 px-3.5 py-1.5 text-sm font-bold dark:bg-zinc-800">새 창에서 크게 ↗</a>
              </div>
              <div className="mt-3 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
                {isPdf(cur) ? (
                  <iframe key={cur} src={cur} title={`도면 ${dIdx + 1}`} className="h-[75vh] w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={cur} src={cur} alt={`도면 ${dIdx + 1}`} className="mx-auto max-h-[80vh] w-auto max-w-full object-contain" />
                )}
              </div>
              <p className="mt-2 text-xs text-zinc-500">PDF 도면이 화면에 보이지 않으면 “새 창에서 크게”를 눌러 주세요.</p>
            </>
          )}
        </section>
      )}

      {(write || tab === "report") && <SiteJournal siteId={site.id} page startOpen={write} />}
    </div>
  );
}
