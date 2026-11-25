import { Suspense } from "react";
import { redirect } from "next/navigation";
import PricingAdmin from "@/components/admin/PricingAdmin";
import { getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getInventory, getPricingSnapshots, getProducts, getPurchaseLinks } from "@/lib/db";
import { inventoryTrades } from "@/lib/inventory";

export const metadata = { title: "가격조사 · 빌드메이트" };

export default function PricingPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 가격조사: 장비조사와 같은 상비품 목록(공정·카테고리별)에 금액·수량·합계를 적는다.
// 구매완료를 누르면 그 수량이 창고장비현황 재고에 더해지고 '구매완료' 탭으로 옮겨진다.
async function Loader() {
  const actor = await getActor("pricing");
  if (!actor) redirect("/"); // '가격조사' 메뉴를 쓸 수 없으면 메인으로
  const { admin, trades } = await inventoryTrades(actor);
  const [products, catTrades, log, allCats, links, snaps] = await Promise.all([getProducts(), getCategoryTrades(), getInventory(), getCategories(), getPurchaseLinks(), getPricingSnapshots().catch(() => [])]);
  const categories = Object.fromEntries(trades.map(t => [t, allCats.filter(c => catTrades[c] === t)]));
  const catOf = new Map(products.map(p => [p.key, p.category]));
  return (
    <PricingAdmin
      trades={trades}
      categories={categories}
      products={products.flatMap(p => { const trade = catTrades[p.category] ?? ""; return p.kind === "상비품" && trades.includes(trade) ? [{ key: p.key, trade, category: p.category, name: p.name, price: p.price }] : []; })}
      log={log.filter(e => trades.includes(e.category)).map(e => ({ ...e, productCategory: catOf.get(e.productKey) ?? "" }))}
      links={links}
      snapshots={snaps.map(x => ({ id: x.id, name: x.name, at: x.at, byName: x.byName, count: x.items.length, excluded: (x.excluded ?? []).length }))}
      admin={admin}
    />
  );
}
