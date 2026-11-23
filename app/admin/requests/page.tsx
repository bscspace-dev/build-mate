import { Suspense } from "react";
import { redirect } from "next/navigation";
import RequestsAdmin from "@/components/admin/RequestsAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getRequests } from "@/lib/db";

export const metadata = { title: "자재요청 현황 · 빌드메이트" };

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("requests");
  if (!actor) redirect("/"); // '자재요청 현황' 메뉴를 쓸 수 없으면 메인으로
  return <RequestsAdmin initialRequests={await getRequests()} canHandle={actorCan(actor, "requests", "edit")} />;
}
