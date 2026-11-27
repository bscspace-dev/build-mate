import { Suspense } from "react";
import { redirect } from "next/navigation";
import AdminCatalog, { type InvMark } from "@/components/admin/AdminCatalog";
import { actorCan, getActor } from "@/lib/auth";
import { activeLinks, copyKey } from "@/lib/product-link";
import { headOf } from "@/lib/sub-path";
import { getCategories, getCategoryTrades, getInventory, getProducts, getProductBattery, getProductCompat, getProductTags, getProductVoltage, getProductModels, getPurchaseLinks, getProductLinks, getTrades, getTrash, getVehicleItems, getVehicles } from "@/lib/db";

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
  const [productsRaw, trash, trades, categories, categoryTrades, vehicles, vitems, models, batteries, voltages, compats, tagMap] = await Promise.all([getProducts(), getTrash(), getTrades(), getCategories(), getCategoryTrades(), getVehicles(), getVehicleItems(), getProductModels().catch(() => ({} as Record<string, string>)), getProductBattery().catch(() => ({} as Record<string, string>)), getProductVoltage().catch(() => ({} as Record<string, string>)), getProductCompat().catch(() => ({} as Record<string, string>)), getProductTags().catch(() => ({} as Record<string, string[]>))]);
  const plinks = await getProductLinks().catch(() => []);
  const merged = (p: (typeof productsRaw)[number]) => (models[p.key] || batteries[p.key] || voltages[p.key] || compats[p.key] || tagMap[p.key] ? { ...p, ...(models[p.key] ? { model: models[p.key] } : {}), ...(batteries[p.key] ? { battery: batteries[p.key] } : {}), ...(voltages[p.key] ? { voltage: voltages[p.key] } : {}), ...(compats[p.key] ? { compat: compats[p.key] } : {}), ...(tagMap[p.key] ? { tags: tagMap[p.key] } : {}) } : p); // 연장 제품명(모델명)·배터리 포함 여부
  // 공통 연결 복사본: 다른 공정·카테고리 목록에도 보이지만 재고·가격·링크·사진은 원본 하나를 같이 쓴다
  const copies = activeLinks(productsRaw, categoryTrades, plinks).map(({ link, p, from }) => ({ ...merged(p), key: copyKey(link), category: link.category, sub: headOf(link.category, categoryTrades, trades), copyOf: from }));
  const products = [...productsRaw.map(merged), ...copies];
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
      if (e.action === "add" && !m.add) m.add = { by: e.byName, at: e.createdAt, src: "장비조사" };
      if (e.action === "delete" && !m.del) m.del = { by: e.byName, at: e.createdAt, src: "장비조사" };
    }
  } catch { /* 표시만 생략 */ }
  const links = await getPurchaseLinks().catch(() => ({} as Awaited<ReturnType<typeof getPurchaseLinks>>)); // 등록해 둔 구매처·판매단위
  const vendors = Object.fromEntries(Object.entries(links).filter(([, i]) => i.vendor || i.unit).map(([k, i]) => [k, { vendor: i.vendor, unit: i.unit, url: /^https?:\/\//i.test(i.url) ? i.url : "" }]));
  return <AdminCatalog key={products.reduce((n, p) => n + p.stock, 0) + ":" + JSON.stringify(deployed)} deployed={deployed} invMarks={invMarks} vendors={vendors} initialProducts={products} initialTrash={trash} trades={trades} categories={categories} categoryTrades={categoryTrades} canRegister={actorCan(actor, "catalog", "register")} canEdit={actorCan(actor, "catalog", "edit")} canDelete={actorCan(actor, "catalog", "delete")} />;
}
