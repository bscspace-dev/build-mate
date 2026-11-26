import { Suspense } from "react";
import { redirect } from "next/navigation";
import InventoryAdmin from "@/components/admin/InventoryAdmin";
import { getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getInventory, getInventoryExcluded, getProducts, getProductBattery, getInventoryHidden, getItemSets, getProductCompat, getProductTags, getProductVoltage, getProductModels, getPurchaseLinks } from "@/lib/db";
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
  const [products, catTrades, log, allCats, excludedRaw, links, models, batteries, voltages, compats, tagMap, itemSets, hiddenAll] = await Promise.all([getProducts(), getCategoryTrades(), getInventory(), getCategories(), getInventoryExcluded(), getPurchaseLinks().catch(() => ({} as Record<string, { url: string }>)), getProductModels().catch(() => ({} as Record<string, string>)), getProductBattery().catch(() => ({} as Record<string, string>)), getProductVoltage().catch(() => ({} as Record<string, string>)), getProductCompat().catch(() => ({} as Record<string, string>)), getProductTags().catch(() => ({} as Record<string, string[]>)), getItemSets().catch(() => []), getInventoryHidden().catch(() => ({} as Record<string, string[]>))]);
  // 창고장비현황에서 없어진(삭제된) 공정·카테고리는 제외 목록에서도 뺀다 (예전 설정이 그대로 남아 있지 않게)
  const excluded = { trades: excludedRaw.trades.filter(t => scopeTrades.includes(t)), categories: excludedRaw.categories.filter(c => allCats.includes(c) && !!catTrades[c]) };
  // 장비조사에서 제외한 공정·카테고리는 목록·선택지에서 뺀다 (모든 권한이 있는 사람이 정한다)
  const trades = scopeTrades.filter(t => !excluded.trades.includes(t));
  // 공정마다 고를 수 있는 카테고리 (창고장비현황의 카테고리)
  const categories = Object.fromEntries(trades.map(t => [t, allCats.filter(c => catTrades[c] === t && !excluded.categories.includes(c))]));
  return (
    <InventoryAdmin
      trades={trades}
      categories={categories}
      products={products.flatMap(p => { const trade = catTrades[p.category] ?? ""; return (p.kind === "상비품" || p.kind === "자재" || p.kind === "연장") && trades.includes(trade) && !excluded.categories.includes(p.category) ? [{ key: p.key, kind: p.kind, stock: p.stock ?? 0, price: p.price ?? 0, image: p.image || "", link: links[p.key]?.url ?? "", brand: p.brand ?? "", model: models[p.key] ?? "", battery: batteries[p.key] ?? "", voltage: voltages[p.key] ?? "", compat: compats[p.key] ?? "", tags: tagMap[p.key] ?? [], trade, category: p.category, name: p.name }] : []; })}
      log={log.filter(e => trades.includes(e.category))}
      admin={admin}
      hidden={hiddenAll[actor.kind === "member" ? actor.member.id : "root"] ?? []}
      itemSets={itemSets.map(x => ({ id: x.id, name: x.name, count: x.keys.length }))}
      setup={admin ? { trades: scopeTrades, categories: Object.fromEntries(scopeTrades.map(t => [t, allCats.filter(c => catTrades[c] === t)])), excluded } : null}
    />
  );
}
