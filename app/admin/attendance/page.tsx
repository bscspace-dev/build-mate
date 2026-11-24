import { Suspense } from "react";
import { redirect } from "next/navigation";
import AttendanceAdmin from "@/components/admin/AttendanceAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getLeaves, getAttendanceCycles, getActiveMembers, getPlacements, getSites, getTeams } from "@/lib/db";
import { monthOfDate, periodOf } from "@/lib/attendance-cycle";
import { OFFICE_SITE_ID, OFFICE_SITE_NAME } from "@/lib/office-site";
import { todayKst } from "@/lib/kst";
import { ensureOfficeDefaults } from "@/lib/office-auto";
import { addDays } from "@/lib/site-period";
import { memberHasGroup, memberHasRole, teamsLabel } from "@/lib/roles";

export const metadata = { title: "출근관리 · 빌드메이트" };

export default function AttendancePage(props: PageProps<"/admin/attendance">) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader searchParams={props.searchParams} />
    </Suspense>
  );
}

// 출근 일수는 현장배치(날짜·오전/오후별 배치)에서 계산한다.
// 기본은 등록된 조회 기준(매달 며칠부터 며칠까지)에 따라 달별로 본다: ?m=YYYY-MM (그 달'분'). 기준을 바꿔도 이후 모든 달에 그대로 적용된다.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD 로 직접 기간을 고를 수도 있다 (최대 93일).
const MAX_DAYS = 93;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
async function Loader({ searchParams }: { searchParams: Promise<{ from?: string | string[]; to?: string | string[]; m?: string | string[] }> }) {
  const actor = await getActor("attendance");
  if (!actor) redirect("/"); // '출근관리' 메뉴를 쓸 수 없으면 메인으로
  const q = await searchParams;
  await ensureOfficeDefaults(todayKst()); // 자정이 지난 날의 겸직 인원 빈 시간은 사무실 배치로 채워진 뒤 계산한다
  const cycles = await getAttendanceCycles(); // 기준 이력 (적용 시작 월별)
  const today = new Date().toISOString().slice(0, 10);
  const customRange = isDate(q.from) || isDate(q.to);
  let ym = typeof q.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m) ? q.m : monthOfDate(cycles, today);
  let { from, to } = periodOf(cycles, ym); // 그 달분에 적용된 기준으로 계산 — 기준을 바꿔도 지난 달은 그대로
  if (customRange) {
    if (isDate(q.from)) from = q.from;
    if (isDate(q.to)) to = q.to;
    if (isDate(q.from) && !isDate(q.to)) to = addDays(from, 29); // 시작일만 있으면 30일
    if (to < from) to = from;
    ym = "";
  }
  const clamped = Date.parse(to) - Date.parse(from) > (MAX_DAYS - 1) * 86400000;
  if (clamped) to = addDays(from, MAX_DAYS - 1);
  const [placements, sites, members, teams] = await Promise.all([getPlacements(from, to), getSites(), getActiveMembers(), getTeams()]);
  // '전체 인원 조회'(수정) 권한이 있으면 현장 부서 전원, 보기만 있으면 본인 출근만 (다른 사람의 데이터는 화면으로 보내지 않는다)
  const all = actorCan(actor, "attendance", "edit");
  const selfId = actor.kind === "member" ? actor.member.id : null;
  const workers = members
    .filter(x => (all ? memberHasGroup(teams, x, "field") : x.id === selfId))
    .map(x => ({ id: x.id, name: x.name, team: teamsLabel(teams, x), isPm: memberHasRole(x, "pm") }))
    .sort((a, b) => Number(b.isPm) - Number(a.isPm) || a.name.localeCompare(b.name, "ko"));
  const visible = all ? placements : placements.filter(p => p.memberId === selfId);
  const leaves = (await getLeaves()).filter(l => l.status === "approved" && l.endDate >= from && l.startDate <= to).filter(l => all || l.memberId === selfId).map(l => ({ memberId: l.memberId, startDate: l.startDate, endDate: l.endDate, kind: l.kind }));

  return (
    <AttendanceAdmin
      ownOnly={!all}
      cycles={cycles}
      ym={ym}
      canSetCycle={all && actorCan(actor, "attendance", "register")} // 조회 기준은 모든 권한(전체 조회+등록)일 때만 바꾼다 — 일부 권한은 내 출근만 본다
      from={from}
      to={to}
      clamped={clamped}
      maxDays={MAX_DAYS}
      workers={workers}
      placements={visible}
      leaves={leaves}
      sites={[{ id: OFFICE_SITE_ID, name: OFFICE_SITE_NAME }, ...sites.map(x => ({ id: x.id, name: x.name }))]}
    />
  );
}
