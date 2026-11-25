import { Suspense } from "react";
import { redirect } from "next/navigation";
import InventoryAdmin from "@/components/admin/InventoryAdmin";
import { getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getInventory, getInventoryExcluded, getProducts } from "@/lib/db";
import { inventoryTrades } from "@/lib/inventory";

export const metadata = { title: "장비조사 · 빌드메이트" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 장비조사: 창고장비현황의 상비품이 공정(대분류)별로 먼저 채워져 있고, 조사자가 필요 없는 것은 삭제(→ 창고장비현황 휴지통), 필요한 것은 공정·카테고리를 골라 추가(→ 창고장비현황의 같은 공정·카테고리)한다.
async function Loader() {
  const actor = await getActor("inventory");
  if (!actor) redirect("/"); // '장비조사' 메뉴를 쓸 수 없으면 메인으로
  const { admin, trades: scopeTrades } = await inventoryTrades(actor);
  const [products, catTrades, log, allCats, excluded] = await Promise.all([getProducts(), getCategoryTrades(), getInventory(), getCategories(), getInventoryExcluded()]);
  // 장비조사에서 제외한 공정·카테고리는 목록·선택지에서 뺀다 (모든 권한이 있는 사람이 정한다)
  const trades = scopeTrades.filter(t => !excluded.trades.includes(t));
  // 공정마다 고를 수 있는 카테고리 (창고장비현황의 카테고리)
  const categories = Object.fromEntries(trades.map(t => [t, allCats.filter(c => catTrades[c] === t && !excluded.categories.includes(c))]));
  return (
    <InventoryAdmin
      trades={trades}
      categories={categories}
      products={products.flatMap(p => { const trade = catTrades[p.category] ?? ""; return p.kind === "상비품" && trades.includes(trade) && !excluded.categories.includes(p.category) ? [{ key: p.key, trade, category: p.category, name: p.name }] : []; })}
      log={log.filter(e => trades.includes(e.category))}
      admin={admin}
      setup={admin ? { trades: scopeTrades, categories: Object.fromEntries(scopeTrades.map(t => [t, allCats.filter(c => catTrades[c] === t)])), excluded } : null}
    />
  );
}
