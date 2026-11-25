import { Suspense } from "react";
import { redirect } from "next/navigation";
import HistoryAdmin from "@/components/admin/HistoryAdmin";
import { getActor } from "@/lib/auth";
import { getAudit } from "@/lib/db";
import { isStaffAdmin, memberRoles, MENUS } from "@/lib/roles";

export const metadata = { title: "변경이력 · 빌드메이트" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 변경이력: 모든 메뉴의 추가·수정·삭제를 누가 언제 했는지 모아서 보여 준다 (최근 5000건).
async function Loader() {
  const actor = await getActor("history");
  if (!actor) redirect("/"); // 변경이력 메뉴를 쓸 수 없으면 메인으로
  let entries: Awaited<ReturnType<typeof getAudit>> = [];
  let error = "";
  try {
    entries = await getAudit();
  } catch {
    error = "변경이력을 불러오지 못했어요. 변경이력 테이블이 아직 없다면 supabase/add-audit.sql 을 한 번 실행해 주세요.";
  }
  const canDelete = actor.kind === "root" || isStaffAdmin(memberRoles(actor.member)); // 모든 권한이 있는 사람만 삭제
  return <HistoryAdmin entries={entries} menus={MENUS.map(m => ({ key: m.key, label: m.label }))} error={error} canDelete={canDelete} />;
}
