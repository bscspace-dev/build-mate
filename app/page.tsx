import { Suspense } from "react";
import { redirect } from "next/navigation";
import MenuHome, { type MenuCard } from "@/components/MenuHome";
import WorkerLogin from "@/components/survey/WorkerLogin";
import { hasRootSession } from "@/lib/auth";
import { getSessionMember } from "@/lib/member-session";
import { getTeams } from "@/lib/db";
import { effectiveMenus, menuDesc, menuHref, menuLabel, teamLabel } from "@/lib/roles";

export const metadata = { title: "빌드메이트" };

// 메인 화면
//  · 로그인 전                  → 아이디/비밀번호 로그인
//  · 임시 비밀번호로 처음 로그인   → 새 비밀번호 정하기(/me)부터
//  · 최고 관리자(내장 계정 포함)  → 메뉴 선택 없이 바로 관리자 화면(/admin)
//  · 그 밖의 로그인 후           → 메뉴 선택 화면 (직급 기본 메뉴 + 최고 관리자·개발팀이 부여한 메뉴 + 내 정보)
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

  if (member.mustChangePassword) redirect("/me");
  if (member.role === "super") redirect("/admin"); // 최고 관리자는 바로 관리자 화면

  const items: MenuCard[] = [
    ...effectiveMenus(member.role, member.menus, member.actions).map(k => ({
      key: k,
      label: menuLabel(k),
      desc: menuDesc(k),
      href: menuHref(k),
      granted: member.menus.includes(k), // 직급 기본이 아니라 따로 부여받은 메뉴 표시
    })),
    { key: "me", label: "내 정보", desc: "이름·공정, 아이디(처음 1회), 비밀번호를 바꿔요", href: "/me" },
  ];
  return <MenuHome name={member.name} roleLabel={teamLabel(await getTeams(), member.role)} items={items} />;
}
