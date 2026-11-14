import { Suspense } from "react";
import { redirect } from "next/navigation";
import Survey from "@/components/survey/Survey";
import { toSurveyItems } from "@/lib/catalog";
import { getProducts, getSubmissions, getTrades } from "@/lib/db";
import { getSessionMember } from "@/lib/member-session";
import { canSurvey, effectiveMenus, menuHref, menuLabel } from "@/lib/roles";

export const metadata = { title: "설문 참여 · 빌드메이트", robots: { index: false, follow: false } };

// 설문 참여: 현장작업자·현장관리자(PM)이거나, 최고 관리자·개발팀에게 '설문 참여' 메뉴를 부여받은 회원만.
export default function SurveyPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <SurveyLoader />
    </Suspense>
  );
}

async function SurveyLoader() {
  const member = await getSessionMember();
  if (!member) redirect("/"); // 로그인 전이면 로그인 화면으로
  if (member.mustChangePassword) redirect("/me"); // 임시 비밀번호는 먼저 바꿔야 한다
  if (!canSurvey(member.role, member.menus)) redirect("/"); // 설문 권한이 없으면 처음 화면으로

  const [products, allTrades, submissions] = await Promise.all([getProducts(), getTrades(), getSubmissions()]);
  // 설문 말고 다른 메뉴(소모품·회원 관리)도 있으면 설문 화면에서 오갈 수 있게 링크를 준다
  const otherLinks = effectiveMenus(member.role, member.menus, member.actions)
    .filter(k => k !== "survey")
    .map(k => ({ label: menuLabel(k), href: menuHref(k) }));
  return (
    <Survey
      items={toSurveyItems(products, allTrades)}
      allTrades={allTrades}
      workerId={member.id}
      workerName={member.name}
      myTrades={member.trades}
      submitted={Object.keys(submissions[member.id] ?? {})}
      otherLinks={otherLinks}
    />
  );
}
