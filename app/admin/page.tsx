import { Suspense } from "react";
import { redirect } from "next/navigation";
import AdminCatalog from "@/components/admin/AdminCatalog";
import { actorCan, getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getProducts, getTrades, getTrash, getVehicleItems, getVehicles } from "@/lib/db";

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
  const [products, trash, trades, categories, categoryTrades, vehicles, vitems] = await Promise.all([getProducts(), getTrash(), getTrades(), getCategories(), getCategoryTrades(), getVehicles(), getVehicleItems()]);
  // 연장이 어느 차량에 배정돼 있는지 (품목 번호 → 차량 목록). 차량에 실린 수량은 창고 재고와 따로 센다.
  const vmap = new Map(vehicles.map(v => [v.id, v]));
  const deployed: Record<string, { icon: string; label: string; qty: number }[]> = {};
  for (const i of vitems) {
    const v = vmap.get(i.vehicleId);
    if (v) (deployed[i.key] ??= []).push({ icon: v.icon, label: v.nickname || v.name, qty: i.qty });
  }
  return <AdminCatalog key={products.reduce((n, p) => n + p.stock, 0) + ":" + JSON.stringify(deployed)} deployed={deployed} initialProducts={products} initialTrash={trash} trades={trades} categories={categories} categoryTrades={categoryTrades} canRegister={actorCan(actor, "catalog", "register")} canEdit={actorCan(actor, "catalog", "edit")} canDelete={actorCan(actor, "catalog", "delete")} />;
}
