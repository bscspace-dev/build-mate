import { Suspense } from "react";
import { redirect } from "next/navigation";
import MenuHome, { type MenuCard } from "@/components/MenuHome";
import WorkerLogin from "@/components/survey/WorkerLogin";
import { hasRootSession } from "@/lib/auth";
import { getSessionMember } from "@/lib/member-session";
import { getMenuOrder, getTeams, getVehicles } from "@/lib/db";
import { effectiveMenus, isStaffAdmin, menuDesc, menuHref, menuLabel, sortMenus, memberRoles, teamsLabel } from "@/lib/roles";

export const metadata = { title: "빌드메이트" };

// 메인 화면
//  · 로그인 전                  → 아이디/비밀번호 로그인
//  · 최고 관리자(내장 계정 포함)  → 메뉴 선택 없이 바로 관리자 화면(/admin)
//  · 그 밖의 로그인 후           → 상단 메뉴의 첫 번째 메뉴로 바로 이동 (쓸 수 있는 메뉴가 없으면 안내 화면)
export default function Home() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <HomeLoader />
    </Suspense>
  );
}

async function HomeLoader() {
  // 쿠키를 읽는 순간 요청 시점 렌더링이 된다.
  const member = await getSessionMember();

  if (!member) {
    if (await hasRootSession()) redirect("/admin"); // 내장 최고 관리자
    return <WorkerLogin />;
  }

  if (member.role === "super") redirect("/admin"); // 최고 관리자는 바로 관리자 화면

  const items: MenuCard[] = [
    ...sortMenus(effectiveMenus(memberRoles(member), member.menus, member.actions), await getMenuOrder()).map(k => ({
      key: k,
      label: menuLabel(k),
      desc: menuDesc(k),
      href: menuHref(k),
      granted: member.menus.includes(k), // 직급 기본이 아니라 따로 부여받은 메뉴 표시
    })),
  ];
  if (items.length > 0) redirect(items[0].href); // 메뉴 선택 없이, 상단 메뉴의 맨 첫 번째 메뉴를 첫 화면으로
  const teams = await getTeams();
  const mine = (await getVehicles()).filter(v => v.driverId === member.id);
  if (mine.length > 0) items.push({ key: "myvehicle", label: "내 차량", desc: `배차된 차량(${mine.map(v => v.nickname || v.name).join(", ")})에 실린 연장·상비품을 확인해요`, href: "/my-vehicle" });
  return <MenuHome name={member.name} roleLabel={teamsLabel(teams, member)} items={items} idChange={isStaffAdmin(memberRoles(member)) ? "unlimited" : member.idChanged ? false : "once"} temp={member.mustChangePassword} />;
}
