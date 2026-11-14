import { Suspense } from "react";
import { redirect } from "next/navigation";
import AdminCatalog from "@/components/admin/AdminCatalog";
import { actorCan, getActor } from "@/lib/auth";
import { countResponses, getCategories, getCategoryTrades, getProducts, getTrades, getTrash } from "@/lib/db";

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <AdminLoader />
    </Suspense>
  );
}

async function AdminLoader() {
  // 쿠키를 읽는 순간 요청 시점 렌더링이 된다. 로그인이 없으면 로그인 화면으로.
  const actor = await getActor("catalog");
  if (!actor) redirect("/"); // 소모품 메뉴 권한이 없으면 메인으로
  const [products, trash, trades, responses, categories, categoryTrades] = await Promise.all([getProducts(), getTrash(), getTrades(), countResponses(), getCategories(), getCategoryTrades()]);
  return <AdminCatalog initialProducts={products} initialTrash={trash} trades={trades} responseCount={responses} categories={categories} categoryTrades={categoryTrades} canRegister={actorCan(actor, "catalog", "register")} canEdit={actorCan(actor, "catalog", "edit")} canDelete={actorCan(actor, "catalog", "delete")} />;
}
