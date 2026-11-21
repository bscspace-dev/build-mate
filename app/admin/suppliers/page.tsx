import { Suspense } from "react";
import { redirect } from "next/navigation";
import SuppliersView, { type SupplierLite } from "@/components/admin/SuppliersView";
import { actorCan, getActor } from "@/lib/auth";
import { getMembers, getTeams } from "@/lib/db";
import { sideOf, teamGroup } from "@/lib/roles";

export const metadata = { title: "거래처 · 빌드메이트" };

export default function SuppliersPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 거래처 목록 (보기 전용). 로그인 아이디 등 계정 정보는 내려 보내지 않고, 이름·팀·취급품목·연락처·주소만 보인다.
async function Loader() {
  const actor = await getActor("suppliers");
  if (!actor) redirect("/"); // '거래처' 메뉴를 쓸 수 없으면 메인으로
  const [members, teams] = await Promise.all([getMembers(), getTeams()]);
  const list: SupplierLite[] = members
    .filter(m => { const g = teamGroup(teams, m.role); return g !== null && sideOf(g) === "coop"; })
    .map(m => ({ id: m.id, name: m.name, handles: m.handles, phone: m.phone, address: m.address }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return <SuppliersView suppliers={list} canRegister={actorCan(actor, "suppliers", "register")} canEdit={actorCan(actor, "suppliers", "edit")} canDelete={actorCan(actor, "suppliers", "delete")} />;
}
