import { Suspense } from "react";
import { redirect } from "next/navigation";
import PlacementsAdmin from "@/components/admin/PlacementsAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getLeaves, getMembers, getPlacementNotes, getPlacements, getSites, getTeams } from "@/lib/db";
import { OFFICE_SITE_ID, OFFICE_SITE_NAME } from "@/lib/office-site";
import { todayKst } from "@/lib/kst";
import { ensureOfficeDefaults, isDualMember } from "@/lib/office-auto";
import { addDays } from "@/lib/site-period";
import { memberHasGroup, memberHasRole, teamsLabel } from "@/lib/roles";

export const metadata = { title: "현장배치 · 빌드메이트" };

export default function PlacementsPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("placements");
  if (!actor) redirect("/"); // '현장배치' 메뉴를 쓸 수 없으면 메인으로
  const today = new Date().toISOString().slice(0, 10);
  await ensureOfficeDefaults(todayKst()); // 밤 12시(한국 시간)가 지나면 그날 현장에 배치되지 않은 사무실·현장 겸직 인원은 자동으로 사무실에 배치
  const range: [string, string] = [addDays(today, -45), addDays(today, 180)];
  const [sites, members, teams, placements, notes] = await Promise.all([getSites(), getMembers(), getTeams(), getPlacements(...range), getPlacementNotes(...range)]);
  const leaves = (await getLeaves()).filter(l => l.status === "approved" && l.endDate >= range[0] && l.startDate <= range[1]).map(l => ({ memberId: l.memberId, startDate: l.startDate, endDate: l.endDate, kind: l.kind }));
  const mName = new Map(members.map(m => [m.id, m.name]));
  // 배치 대상: 현장 부서(현장작업자 정·부, 현장관리자 PM) 회원
  const workers = members
    .filter(m => memberHasGroup(teams, m, "field"))
    .map(m => ({ id: m.id, name: m.name, team: teamsLabel(teams, m), isPm: memberHasRole(m, "pm"), dual: isDualMember(teams, m) }))
    .sort((a, b) => Number(b.isPm) - Number(a.isPm) || a.name.localeCompare(b.name, "ko"));
  return (
    <PlacementsAdmin
      sites={[{ id: OFFICE_SITE_ID, name: OFFICE_SITE_NAME, address: "", pmName: "", startDate: "", endDate: "", fixed: true }, ...sites.map(s => ({ id: s.id, name: s.name, address: s.address, pmName: mName.get(s.pmId) ?? "", startDate: s.startDate, endDate: s.endDate }))]}
      workers={workers}
      placements={placements}
      notes={notes}
      leaves={leaves}
      canRegister={actorCan(actor, "placements", "register")}
      canDelete={actorCan(actor, "placements", "delete")}
    />
  );
}
