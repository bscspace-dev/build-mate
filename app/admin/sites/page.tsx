import { Suspense } from "react";
import { redirect } from "next/navigation";
import SitesAdmin from "@/components/admin/SitesAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getActiveMembers, getPlacementNotes, getPlacements, getSiteMarks, getSitePostsSince, getSites, getTeams } from "@/lib/db";
import { todayKst } from "@/lib/kst";
import { OFFICE_SITE_ID } from "@/lib/office-site";
import { memberHasRole, teamsLabel } from "@/lib/roles";
import { slotLabel, type Slot } from "@/lib/types";

export const metadata = { title: "현장정보 · 빌드메이트" };

export default function SitesPage(props: PageProps<"/admin/sites">) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader searchParams={props.searchParams} />
    </Suspense>
  );
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// 현장정보: 날짜를 골라 그날 공사 중인 현장을 카드로 본다. 현장배치 권한이 있으면 카드에 그날 배치된 인원과 작업 내용도 함께 나온다.
async function Loader({ searchParams }: { searchParams: Promise<{ d?: string | string[]; edit?: string | string[]; del?: string | string[] }> }) {
  const actor = await getActor("sites");
  if (!actor) redirect("/"); // '현장정보' 메뉴를 쓸 수 없으면 메인으로
  const q = await searchParams;
  const date = isDate(q.d) ? q.d : todayKst();
  const [sites, members, teams] = await Promise.all([getSites(), getActiveMembers(), getTeams()]);
  // 담당 PM 후보: 현장관리자(PM) 팀 회원만
  const pms = members
    .filter(m => memberHasRole(m, "pm"))
    .map(m => ({ id: m.id, name: m.name, team: teamsLabel(teams, m), isPm: true }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 최근 3일 안에 새로 올라온 작업일보·도면·정보 변경 (현장 카드의 '업데이트' 표시)
  const NEW_DAYS = 3;
  const nowMs = new Date().getTime();
  const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 10);
  const ago = (iso: string) => { const d = Math.round((Date.parse(kstDay(new Date(nowMs).toISOString())) - Date.parse(kstDay(iso))) / 86_400_000); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
  const since = new Date(nowMs - NEW_DAYS * 86_400_000).toISOString();
  const [marks, recentPosts] = await Promise.all([getSiteMarks(), getSitePostsSince(since)]);
  const news: Record<string, { posts: number; postsAgo: string; drawing: string; info: string }> = {};
  for (const s of sites) {
    const mine = recentPosts.filter(x => x.siteId === s.id);
    const m = marks[s.id];
    const fresh = (iso?: string) => (iso && iso >= since ? ago(iso) : "");
    const e = { posts: mine.length, postsAgo: mine.length ? ago(mine.map(x => x.createdAt).sort().pop()!) : "", drawing: fresh(m?.drawingsAt), info: fresh(m?.infoAt) };
    if (e.posts || e.drawing || e.info) news[s.id] = e;
  }

  // 그날의 배치 인원·작업 내용 (현장배치 메뉴를 볼 수 있는 사람에게만 보낸다)
  const showCrew = actorCan(actor, "placements", "view");
  const crew: Record<string, { name: string; tag: string }[]> = {};
  const notes: Record<string, string> = {};
  if (showCrew) {
    const [placements, noteList] = await Promise.all([getPlacements(date, date), getPlacementNotes(date, date)]);
    const nameOf = new Map(members.map(m => [m.id, m.name]));
    const perSite = new Map<string, Map<string, Set<Slot>>>(); // 현장 → 회원 → 시간대
    for (const p of placements) {
      if (p.siteId === OFFICE_SITE_ID || !nameOf.has(p.memberId)) continue;
      const byMember = perSite.get(p.siteId) ?? new Map<string, Set<Slot>>();
      const set = byMember.get(p.memberId) ?? new Set<Slot>();
      set.add(p.slot);
      byMember.set(p.memberId, set);
      perSite.set(p.siteId, byMember);
    }
    for (const [siteId, byMember] of perSite) {
      crew[siteId] = [...byMember.entries()]
        .map(([id, sl]) => {
          // 오전·오후를 모두 하면 표시 없음, 반나절만이면 (오전)/(오후), 야간·심야는 그대로 덧붙인다
          const half = sl.has("am") && sl.has("pm") ? "" : sl.has("am") ? slotLabel("am") : sl.has("pm") ? slotLabel("pm") : "";
          const extra = sl.has("nt") ? slotLabel("nt") : sl.has("ot") ? slotLabel("ot") : "";
          return { name: nameOf.get(id) ?? "", tag: [half, extra].filter(Boolean).join("+") };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));
    }
    for (const n of noteList) if (n.note) notes[n.siteId] = n.note;
  }

  return (
    <SitesAdmin
      sites={sites}
      pms={pms}
      date={date}
      openEdit={typeof q.edit === "string" ? q.edit : ""}
      openDel={typeof q.del === "string" ? q.del : ""}
      showCrew={showCrew}
      crew={crew}
      news={news}
      notes={notes}
      canRegister={actorCan(actor, "sites", "register")}
      canEdit={actorCan(actor, "sites", "edit")}
      canDelete={actorCan(actor, "sites", "delete")}
    />
  );
}
