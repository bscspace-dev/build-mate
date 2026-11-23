import { Suspense } from "react";
import { redirect } from "next/navigation";
import ExpensesAdmin from "@/components/admin/ExpensesAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getExpenses, getSites } from "@/lib/db";

export const metadata = { title: "경비관리 · 빌드메이트" };

export default function ExpensesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 경비관리: 전체 조회(수정 권한)가 있으면 모든 영수증과 현장별 합계를, 아니면 내가 올린 영수증만 보여 준다.
async function Loader() {
  const actor = await getActor("expenses");
  if (!actor) redirect("/"); // '경비관리' 메뉴를 쓸 수 없으면 메인으로
  const all = actorCan(actor, "expenses", "edit");
  const myId = actor.kind === "member" ? actor.member.id : "";
  const items = (await getExpenses()).filter(e => all || e.memberId === myId);
  return (
    <ExpensesAdmin
      items={items}
      sites={(await getSites()).map(s => s.name)}
      myId={myId}
      isAll={all}
      canRegister={actor.kind === "member" && actorCan(actor, "expenses", "register")}
      canEditAny={all}
      canDeleteAny={actorCan(actor, "expenses", "delete")}
    />
  );
}
