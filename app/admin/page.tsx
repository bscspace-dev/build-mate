import { Suspense } from "react";
import { redirect } from "next/navigation";
import AdminCatalog, { type InvMark } from "@/components/admin/AdminCatalog";
import { actorCan, getActor } from "@/lib/auth";
import { isStaffAdmin, memberRoles } from "@/lib/roles";
import { getCategories, getCategoryTrades, getInventory, getInventoryExcluded, getProducts, getPurchaseLinks, getTrades, getTrash, getVehicleItems, getVehicles } from "@/lib/db";

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
  // 장비조사에서 추가·삭제한 품목: 누가 언제 했는지 (최근 기록이 우선). 장비조사 테이블이 아직 없으면 표시만 생략한다.
  const invMarks: Record<string, InvMark> = {};
  try {
    for (const e of await getInventory()) {
      const m = (invMarks[e.productKey] ??= {});
      if (e.action === "add" && !m.add) m.add = { by: e.byName, at: e.createdAt, src: e.memo === "pricing" ? "가격조사" : "장비조사" };
      if (e.action === "delete" && !m.del) m.del = { by: e.byName, at: e.createdAt, src: e.memo === "pricing" ? "가격조사" : "장비조사" };
    }
  } catch { /* 표시만 생략 */ }
  const links = await getPurchaseLinks().catch(() => ({} as Awaited<ReturnType<typeof getPurchaseLinks>>)); // 가격조사에서 등록한 구매처·판매단위
  const vendors = Object.fromEntries(Object.entries(links).filter(([, i]) => i.vendor || i.unit).map(([k, i]) => [k, { vendor: i.vendor, unit: i.unit, url: /^https?:\/\//i.test(i.url) ? i.url : "" }]));
  const invExcluded = await getInventoryExcluded().catch(() => ({ trades: [], categories: [] })); // 장비조사에서 제외한 공정·카테고리
  const canSetInvExclude = actor.kind === "root" || isStaffAdmin(memberRoles(actor.member)) || actorCan(actor, "inventory", "edit"); // 장비조사 '모든 권한'이 있는 사람만 바꾼다
  return <AdminCatalog key={products.reduce((n, p) => n + p.stock, 0) + ":" + JSON.stringify(deployed)} deployed={deployed} invMarks={invMarks} vendors={vendors} invExcluded={invExcluded} canSetInvExclude={canSetInvExclude} initialProducts={products} initialTrash={trash} trades={trades} categories={categories} categoryTrades={categoryTrades} canRegister={actorCan(actor, "catalog", "register")} canEdit={actorCan(actor, "catalog", "edit")} canDelete={actorCan(actor, "catalog", "delete")} />;
}
