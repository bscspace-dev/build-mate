import { Suspense } from "react";
import { redirect } from "next/navigation";
import LeaveAdmin from "@/components/admin/LeaveAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getAnnualLeave, getLeaves, getMembers, getTeams } from "@/lib/db";
import { leaveUsage } from "@/lib/leave";
import { isOfficePay, teamsLabel } from "@/lib/roles";

export const metadata = { title: "휴가신청 · 빌드메이트" };

export default function LeavePage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 휴가신청: 본인은 신청·내 내역, '승인·반려' 권한자는 전체 신청을 보고 승인·반려한다.
// 승인 권한이 없으면 남의 신청은 화면으로 보내지 않는다.
async function Loader() {
  const actor = await getActor("leave");
  if (!actor) redirect("/"); // '휴가신청' 메뉴를 쓸 수 없으면 메인으로
  const canDecide = actorCan(actor, "leave", "edit");
  const me = actor.kind === "member" ? { id: actor.member.id, name: actor.member.name } : null;
  const [all, members, teams, annual] = await Promise.all([getLeaves(), getMembers(), getTeams(), getAnnualLeave()]);
  const leaves = canDecide ? all : all.filter(l => l.memberId === me?.id);
  // 연차 차감 대상 = 4대보험 사무직 기준인 회원 (급여 기준을 직접 정했으면 그것, 아니면 주 팀이 사무실이면 사무직 기준)
  const isOffice = (m: (typeof members)[number]) => isOfficePay(teams, m);
  const who = new Map(members.map(m => [m.id, { name: m.name, team: teamsLabel(teams, m), office: isOffice(m) }]));
  const people = Object.fromEntries(leaves.map(l => [l.memberId, who.get(l.memberId) ?? { name: "삭제된 회원", team: "", office: false }]));
  // 연차 현황(사무 회원만): 올해 총 일수 · 승인 사용 · 대기. 총 일수가 안 정해졌으면 null.
  const year = new Date().getFullYear();
  const balanceOf = (id: string) => ({ total: annual[String(year)]?.[id] ?? null, ...leaveUsage(all, id, year) });
  const officeMembers = members.filter(m => isOffice(m));
  const balances = Object.fromEntries((canDecide ? officeMembers : officeMembers.filter(m => m.id === me?.id)).map(m => [m.id, balanceOf(m.id)]));
  const roster = canDecide ? officeMembers.map(m => ({ id: m.id, name: m.name, team: teamsLabel(teams, m) })).sort((a, b) => a.name.localeCompare(b.name, "ko")) : [];
  return <LeaveAdmin me={me} canApply={!!me && actorCan(actor, "leave", "register")} canDecide={canDecide} leaves={leaves} people={people} year={year} balances={balances} roster={roster} />;
}
