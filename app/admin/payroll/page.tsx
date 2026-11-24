import { Suspense } from "react";
import { redirect } from "next/navigation";
import PayrollAdmin, { type PayrollRow } from "@/components/admin/PayrollAdmin";
import { getActor } from "@/lib/auth";
import { getAttendanceCycles, getActiveMembers, getPayrollPaid, getPlacements, getTeams } from "@/lib/db";
import { monthOfDate, periodOf } from "@/lib/attendance-cycle";
import { todayKst } from "@/lib/kst";
import { netPay, payOn } from "@/lib/member-utils";
import { ensureOfficeDefaults } from "@/lib/office-auto";
import { isOfficePay, memberHasGroup, teamsLabel } from "@/lib/roles";
import { slotWeight, type Slot } from "@/lib/types";

export const metadata = { title: "월급관리 · 빌드메이트" };

export default function PayrollPage(props: PageProps<"/admin/payroll">) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader searchParams={props.searchParams} />
    </Suspense>
  );
}

// 월급관리: 출근관리의 조회 기준(매달 며칠부터 며칠까지)으로 그 달분 급여를 계산한다.
//  · 4대보험 사무직: 그 급여 기간에 적용되는 월급(세전) − 4대보험(근로자 부담분) = 실지급
//  · 일수제: 날짜마다 그날 적용되는 일당 × 출근 공수 (현장배치 기준: 종일 1, 반나절 0.5, 야간 +0.5, 심야 +1). 오늘까지 출근분은 확정, 이후 배치는 예정.
//  · 금액을 바꾸면 다음 급여 기간부터 적용되고(회원 급여 이력), 지난 달은 그때 금액 그대로 계산된다.
async function Loader({ searchParams }: { searchParams: Promise<{ m?: string | string[] }> }) {
  const actor = await getActor("payroll");
  if (!actor) redirect("/"); // '월급관리' 메뉴를 쓸 수 없으면 메인으로
  const q = await searchParams;
  const today = todayKst();
  await ensureOfficeDefaults(today); // 겸직 인원의 사무실 배치를 채운 뒤 계산한다 (출근관리와 같은 기준)
  const cycles = await getAttendanceCycles();
  const ym = typeof q.m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.m) ? q.m : monthOfDate(cycles, today);
  const { from, to } = periodOf(cycles, ym);
  const [placements, members, teams, paid] = await Promise.all([getPlacements(from, to), getActiveMembers(), getTeams(), getPayrollPaid(ym)]);
  const byId = new Map(members.map(m => [m.id, m]));

  // (회원, 날짜) → 시간대. 일요일 배치는 세지 않는다. 야간·심야가 같은 날 둘 다 있으면 심야만.
  const cell = new Map<string, Set<Slot>>();
  for (const p of placements) {
    if (new Date(p.date + "T00:00:00Z").getUTCDay() === 0) continue;
    const k = `${p.memberId}|${p.date}`;
    (cell.get(k) ?? cell.set(k, new Set<Slot>()).get(k)!).add(p.slot);
  }
  // 회원별 공수와 일수제 금액 (그날 적용되는 일당으로 날마다 계산)
  const acc = new Map<string, { done: number; plan: number; doneMoney: number; planMoney: number }>();
  for (const [k, sl] of cell) {
    const [id, d] = k.split("|");
    const m = byId.get(id);
    if (!m) continue;
    const v = [...sl].filter(x => !(x === "ot" && sl.has("nt"))).reduce((n, x) => n + slotWeight(x), 0);
    const rate = payOn(m, d);
    const cur = acc.get(id) ?? { done: 0, plan: 0, doneMoney: 0, planMoney: 0 };
    if (d <= today) { cur.done += v; cur.doneMoney += v * rate; }
    else { cur.plan += v; cur.planMoney += v * rate; }
    acc.set(id, cur);
  }

  const rows: PayrollRow[] = members
    .filter(m => memberHasGroup(teams, m, "office") || memberHasGroup(teams, m, "field")) // 거래처 제외
    .map(m => {
      const office = isOfficePay(teams, m);
      const a = acc.get(m.id) ?? { done: 0, plan: 0, doneMoney: 0, planMoney: 0 };
      const base = office ? payOn(m, from) : payOn(m, to); // 사무직은 그 급여 기간이 시작될 때의 월급, 일수제는 기간 끝의 일당
      const gross = office ? base : Math.round(a.doneMoney);
      const ded = office ? netPay(gross).total : 0; // 일수제는 공제 없이 표시한다
      return {
        id: m.id, name: m.name, team: teamsLabel(teams, m), office, base,
        days: a.done, planDays: a.plan,
        gross, planGross: office ? 0 : Math.round(a.planMoney), deduct: ded, net: gross - ded,
        bank: m.bank ?? "", accountNo: m.accountNo ?? "", holder: m.accountHolder || m.name,
      };
    })
    .sort((a, b) => Number(b.office) - Number(a.office) || a.name.localeCompare(b.name, "ko"));

  return <PayrollAdmin ym={ym} from={from} to={to} today={today} rows={rows} paid={paid} />;
}
