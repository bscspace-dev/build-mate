import { Suspense } from "react";
import { redirect } from "next/navigation";
import PurchasesAdmin from "@/components/admin/PurchasesAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getPurchases } from "@/lib/db";

export const metadata = { title: "구매관리 · 빌드메이트" };

export default function PurchasesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("purchases");
  if (!actor) redirect("/"); // '구매관리' 메뉴를 쓸 수 없으면 메인으로
  return (
    <PurchasesAdmin
      items={await getPurchases()}
      canRegister={actorCan(actor, "purchases", "register")}
      canEdit={actorCan(actor, "purchases", "edit")}
      canDelete={actorCan(actor, "purchases", "delete")}
    />
  );
}
