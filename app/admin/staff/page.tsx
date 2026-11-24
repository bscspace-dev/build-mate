import { Suspense } from "react";
import { redirect } from "next/navigation";
import MembersAdmin from "@/components/admin/MembersAdmin";
import { actorCan, adminLoginId, getActor } from "@/lib/auth";
import { getAnnualLeave, getCategoryTrades, getLeaves, getMembers, getPayDefaults, getSubmissions, getTeams, getTrades } from "@/lib/db";
import { leaveUsage } from "@/lib/leave";
import { toPublic } from "@/lib/member-utils";
import { currentPayStart, nextPayStart } from "@/lib/members";

export const metadata = { title: "회원정보 확인 · 빌드메이트" };

export default function StaffPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("staff");
  if (!actor) redirect("/"); // 최고 관리자·개발팀이 아니면 메인으로
  const [members, trades, submissions, teams, categoryTrades, annual, leaves, payDefaults] = await Promise.all([getMembers(), getTrades(), getSubmissions(), getTeams(), getCategoryTrades(), getAnnualLeave(), getLeaves(), getPayDefaults()]);
  // 올해 연차 현황 (사무직 기준 회원의 연차 잔여 칸에 쓴다): 총 일수(없으면 null) · 승인된 사용 일수
  const leaveYear = new Date().getFullYear();
  const leaveBalances = Object.fromEntries(members.map(m => [m.id, { total: annual[String(leaveYear)]?.[m.id] ?? null, used: leaveUsage(leaves, m.id, leaveYear).used }]));
  return (
    <MembersAdmin
      scope="inhouse"
      mode="manage"
      defaultDaily={payDefaults.daily}
      defaultMonthly={payDefaults.monthly}
      nextPayFrom={await nextPayStart()}
      currentPayFrom={await currentPayStart()}
      leaveYear={leaveYear}
      leaveBalances={leaveBalances}
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
