import { Suspense } from "react";
import { redirect } from "next/navigation";
import RequestForm from "@/components/request/RequestForm";
import AdminNav from "@/components/admin/AdminNav";
import { toSurveyItems } from "@/lib/catalog";
import { getProducts, getSites, getTeams, getTrades } from "@/lib/db";
import { getSessionMember } from "@/lib/member-session";
import { canSurvey, memberRoles, memberTrades } from "@/lib/roles";

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
  if (!canSurvey(memberRoles(member), member.menus)) redirect("/"); // 설문 권한이 없으면 처음 화면으로

  const [products, allTrades, sites, teams] = await Promise.all([getProducts(), getTrades(), getSites(), getTeams()]);
  // 자재 요청에는 '자재' 품목 전체가 보인다 (연장·상비품은 제외, 재고가 없어도, 공정·카테고리와 상관없이).
  // 공정 탭은 어느 공정의 요청인지 나누는 용도라서, 모든 공정 탭에서 같은 자재 목록이 보인다.
  const everyTrade = allTrades.reduce((m, _t, i) => m | (1 << i), 0);
  const surveyItems = toSurveyItems(products.filter(p => p.kind === "자재"), allTrades).map(i => ({ ...i, t: everyTrade }));
  return (
    <>
    <AdminNav />
    <RequestForm
      items={surveyItems}
      sites={sites.map(s => ({ name: s.name, startDate: s.startDate, endDate: s.endDate }))}
      allTrades={allTrades}
      workerName={member.name}
      myTrades={memberTrades(teams, member, allTrades)}
      myCategories={[]}
    />
    </>
  );
}
