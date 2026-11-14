import { Suspense } from "react";
import { redirect } from "next/navigation";
import RequestForm from "@/components/request/RequestForm";
import { toSurveyItems } from "@/lib/catalog";
import { getCategoryTrades, getProducts, getTrades } from "@/lib/db";
import { getSessionMember } from "@/lib/member-session";
import { canSurvey, effectiveMenus, isStaffAdmin, menuHref, menuLabel } from "@/lib/roles";

export const metadata = { title: "자재 요청 · 빌드메이트", robots: { index: false, follow: false } };

// 자재 요청: 현장작업자·현장관리자(PM)이거나, 최고 관리자·개발팀에게 '설문 참여' 메뉴를 부여받은 회원만.
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
  if (!canSurvey(member.role, member.menus)) redirect("/"); // 설문 권한이 없으면 처음 화면으로

  const [products, allTrades, categoryTrades] = await Promise.all([getProducts(), getTrades(), getCategoryTrades()]);
  // 맡은 카테고리가 있으면 그 카테고리의 소모품만, 카테고리가 속한 공정 탭에 보여 준다
  const mine = new Set(member.categories);
  const items = toSurveyItems(products.filter(p => (p.stock ?? 0) > 0), allTrades); // 재고가 있는 품목만 보인다
  const surveyItems = mine.size
    ? items.filter(i => mine.has(i.c)).map(i => {
        const bit = allTrades.indexOf(categoryTrades[i.c] ?? "");
        return { ...i, t: bit >= 0 ? 1 << bit : i.t };
      })
    : items;
  // 자재 요청 말고 다른 메뉴(소모품·현장요청·회원 관리)도 있으면 이 화면에서 오갈 수 있게 링크를 준다
  const otherLinks = effectiveMenus(member.role, member.menus, member.actions)
    .filter(k => k !== "survey")
    .map(k => ({ label: menuLabel(k), href: menuHref(k) }));
  return (
    <RequestForm
      items={surveyItems}
      allTrades={allTrades}
      workerName={member.name}
      myTrades={member.trades}
      otherLinks={otherLinks}
      idChange={isStaffAdmin(member.role) ? "unlimited" : member.idChanged ? false : "once"}
      temp={member.mustChangePassword}
    />
  );
}
