import { Suspense } from "react";
import { redirect } from "next/navigation";
import MembersAdmin from "@/components/admin/MembersAdmin";
import { actorCan, adminLoginId, getActor } from "@/lib/auth";
import { getCategoryTrades, getMembers, getSubmissions, getTeams, getTrades } from "@/lib/db";
import { toPublic } from "@/lib/member-utils";

export const metadata = { title: "거래처 관리 · 빌드메이트" };

export default function PartnersPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("members");
  if (!actor) redirect("/"); // 최고 관리자·개발팀이 아니면 메인으로
  const [members, trades, submissions, teams, categoryTrades] = await Promise.all([getMembers(), getTrades(), getSubmissions(), getTeams(), getCategoryTrades()]);
  return (
    <MembersAdmin
      scope="coop"
      initialMembers={members.map(toPublic)}
      initialTeams={teams}
      canManageTeams={actorCan(actor, "members", "register") && actorCan(actor, "members", "delete")}
      trades={trades}
      categoryTrades={categoryTrades}
      submissions={submissions}
      selfId={actor.kind === "member" ? actor.member.id : null}
      builtinId={adminLoginId()}
    />
  );
}
