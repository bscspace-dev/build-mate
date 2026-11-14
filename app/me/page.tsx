import { Suspense } from "react";
import { redirect } from "next/navigation";
import MyPage from "@/components/me/MyPage";
import { hasRootSession } from "@/lib/auth";
import { getTeams, getTrades } from "@/lib/db";
import { toPublic } from "@/lib/member-utils";
import { getSessionMember } from "@/lib/member-session";
import { canSurvey, effectiveMenus, isStaffAdmin, menuHref, menuLabel, teamLabel } from "@/lib/roles";

export const metadata = { title: "내 정보 · 빌드메이트", robots: { index: false, follow: false } };

export default function MePage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <MeLoader />
    </Suspense>
  );
}

async function MeLoader() {
  const member = await getSessionMember();
  if (!member) redirect((await hasRootSession()) ? "/admin" : "/"); // 내장 최고 관리자는 내 정보 화면이 없다
  const trades = await getTrades();
  // 임시 비밀번호 상태에서는 쓸 수 있는 메뉴가 없다(먼저 비밀번호를 바꿔야 한다)
  const menuLinks = member.mustChangePassword ? [] : effectiveMenus(member.role, member.menus, member.actions).map(k => ({ label: menuLabel(k), href: menuHref(k) }));
  return (
    <MyPage
      me={toPublic(member)}
      roleLabel={teamLabel(await getTeams(), member.role)}
      showTrades={canSurvey(member.role, member.menus)}
      allTrades={trades}
      menuLinks={menuLinks}
      isStaff={isStaffAdmin(member.role)}
    />
  );
}
