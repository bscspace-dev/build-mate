import { Suspense } from "react";
import { redirect } from "next/navigation";
import SitesAdmin from "@/components/admin/SitesAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getMembers, getSites, getTeams } from "@/lib/db";
import { memberHasRole, teamsLabel } from "@/lib/roles";

export const metadata = { title: "현장일정 · 빌드메이트" };

export default function SitesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("sites");
  if (!actor) redirect("/"); // '현장일정' 메뉴를 쓸 수 없으면 메인으로
  const [sites, members, teams] = await Promise.all([getSites(), getMembers(), getTeams()]);
  // 담당 PM 후보: 현장관리자(PM) 팀 회원만
  const pms = members
    .filter(m => memberHasRole(m, "pm"))
    .map(m => ({ id: m.id, name: m.name, team: teamsLabel(teams, m), isPm: true }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return (
    <SitesAdmin
      sites={sites}
      pms={pms}
      canRegister={actorCan(actor, "sites", "register")}
      canEdit={actorCan(actor, "sites", "edit")}
      canDelete={actorCan(actor, "sites", "delete")}
    />
  );
}
