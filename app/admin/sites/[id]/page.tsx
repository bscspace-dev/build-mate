import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import SiteDetail from "@/components/admin/SiteDetail";
import { actorCan, getActor } from "@/lib/auth";
import { getActiveMembers, getPlacementNotes, getPlacements, getSitePosts, getSites } from "@/lib/db";
import { slotLabel, slotWeight, type Slot } from "@/lib/types";
import { daysBetween, sitePeriod } from "@/lib/site-period";

export const metadata = { title: "현장 상세 · 빌드메이트" };

export default function SiteJournalPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; write?: string }> }) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

// 현장 상세: 현장확인 · 도면확인 · 작업일보 탭으로 한 현장을 본다.
async function Loader({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; write?: string }> }) {
  const actor = await getActor("sites");
  if (!actor) redirect("/"); // '현장정보' 메뉴를 쓸 수 없으면 메인으로
  const { id } = await params;
  const sp = await searchParams;
  const [sites, members] = await Promise.all([getSites(), getActiveMembers()]);
  const site = sites.find(s => s.id === id);
  if (!site) notFound();
  const pm = members.find(m => m.id === site.pmId);
  const p = sitePeriod(site.startDate, site.endDate);

  // 상세 요약: 진행 상황 · 오늘 배치 · 누적 투입 · 최근 작업일보
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const posts = await getSitePosts(site.id);
  const showCrew = actorCan(actor, "placements", "view");
  const nameOf = new Map(members.map(m => [m.id, m.name]));
  let crewToday: { name: string; tag: string }[] | null = null;
  let note = "";
  let people = 0, workDays = 0, manDays = 0;
  if (showCrew) {
    const from = site.startDate && site.startDate <= today ? site.startDate : today;
    const [placed, notes] = await Promise.all([getPlacements(from, today), getPlacementNotes(today, today)]);
    const mine = placed.filter(x => x.siteId === site.id);
    people = new Set(mine.map(x => x.memberId)).size;
    workDays = new Set(mine.map(x => x.date)).size;
    manDays = mine.reduce((n, x) => n + slotWeight(x.slot), 0);
    const byMember = new Map<string, Set<Slot>>();
    for (const x of mine) if (x.date === today && nameOf.has(x.memberId)) byMember.set(x.memberId, (byMember.get(x.memberId) ?? new Set<Slot>()).add(x.slot));
    crewToday = [...byMember.entries()].map(([id, sl]) => {
      const half = sl.has("am") && sl.has("pm") ? "" : sl.has("am") ? slotLabel("am") : sl.has("pm") ? slotLabel("pm") : "";
      const extra = sl.has("nt") ? slotLabel("nt") : sl.has("ot") ? slotLabel("ot") : "";
      return { name: nameOf.get(id) ?? "", tag: [half, extra].filter(Boolean).join("+") };
    }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    note = notes.find(n => n.siteId === site.id)?.note ?? "";
  }
  const total = site.startDate && site.endDate ? daysBetween(site.startDate, site.endDate) + 1 : 0;
  const elapsed = site.startDate ? daysBetween(site.startDate, today) + 1 : 0; // 착공일이 1일차
  const stats = {
    today, createdAt: site.createdAt, total, elapsed, postCount: posts.length,
    crewToday, note, people, workDays, manDays,
    recent: [...posts].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map(x => ({ id: x.id, date: x.date, body: x.body.slice(0, 160), authorName: x.authorName, photos: x.photos.length })),
  };
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24">
      <div className="pt-5">
        <Link href="/admin/sites" className="text-sm font-bold text-blue-600 hover:underline dark:text-blue-300">‹ 현장정보로</Link>
      </div>
            <SiteDetail site={{ id: site.id, name: site.name, address: site.address, memo: site.memo, photos: site.photos, drawings: site.drawings, startDate: site.startDate, endDate: site.endDate, pmName: pm?.name ?? "", extensions: site.extensions.map(e => ({ from: e.from, to: e.to })) }}
        stats={stats}
        badge={p.badge ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${p.badge.cls}`}>{p.badge.label}</span> : null}
        sub={`${p.text}${pm ? ` · 담당 PM ${pm.name}` : ""}`}
        actions={<>
          {actorCan(actor, "sites", "edit") && <Link href={`/admin/sites?edit=${site.id}`} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</Link>}
          {actorCan(actor, "sites", "delete") && <Link href={`/admin/sites?del=${site.id}`} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</Link>}
        </>}
        tab={sp.tab === "report" || sp.tab === "drawing" ? sp.tab : "check"} write={sp.write === "1"} />
    </div>
  );
}
