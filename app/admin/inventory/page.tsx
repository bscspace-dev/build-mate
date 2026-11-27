import { Suspense } from "react";
import { redirect } from "next/navigation";
import InventoryAdmin from "@/components/admin/InventoryAdmin";
import { getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getInventory, getProducts, getProductBattery, getProductCompat, getProductTags, getProductVoltage, getProductModels, getPurchaseLinks, getProductLinks, getInventoryStars } from "@/lib/db";
import { inventoryTrades } from "@/lib/inventory";
import { activeLinks, copyKey } from "@/lib/product-link";

export const metadata = { title: "장비조사 · 빌드메이트" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 장비조사: 창고현황의 상비품이 공정(대분류)별로 먼저 채워져 있고, 조사자가 필요 없는 것은 삭제(→ 창고현황 휴지통), 필요한 것은 공정·카테고리를 골라 추가(→ 창고현황의 같은 공정·카테고리)한다.
async function Loader() {
  const actor = await getActor("inventory");
  if (!actor) redirect("/"); // '장비조사' 메뉴를 쓸 수 없으면 메인으로
  const { admin, trades } = await inventoryTrades(actor);
  const [products, catTrades, log, allCats, links, models, batteries, voltages, compats, tagMap, plinks, starsAll] = await Promise.all([getProducts(), getCategoryTrades(), getInventory(), getCategories(), getPurchaseLinks().catch(() => ({} as Record<string, { url: string }>)), getProductModels().catch(() => ({} as Record<string, string>)), getProductBattery().catch(() => ({} as Record<string, string>)), getProductVoltage().catch(() => ({} as Record<string, string>)), getProductCompat().catch(() => ({} as Record<string, string>)), getProductTags().catch(() => ({} as Record<string, string[]>)), getProductLinks().catch(() => []), getInventoryStars().catch(() => ({} as Record<string, string[]>))]);
  // 공정마다 고를 수 있는 카테고리 (창고현황의 카테고리)
  const categories = Object.fromEntries(trades.map(t => [t, allCats.filter(c => catTrades[c] === t)]));
  const row = (p: (typeof products)[number], key: string, trade: string, category: string, copyOf: string) => ({ key, kind: p.kind, stock: p.stock ?? 0, price: p.price ?? 0, image: p.image || "", link: links[p.key]?.url ?? "", brand: p.brand ?? "", model: models[p.key] ?? "", battery: batteries[p.key] ?? "", voltage: voltages[p.key] ?? "", compat: compats[p.key] ?? "", tags: tagMap[p.key] ?? [], trade, category, name: p.name, copyOf });
  const kindOk = (k: string): k is "상비품" | "자재" | "연장" => k === "상비품" || k === "자재" || k === "연장";
  // 원본: 놓인 공정·카테고리 그대로 / 공통 연결 복사본: 다른 공정 목록에도 보이지만 재고·가격·링크·사진은 원본 하나
  const own = products.flatMap(p => { const trade = catTrades[p.category] ?? ""; return kindOk(p.kind) && trades.includes(trade) ? [{ ...row(p, p.key, trade, p.category, ""), kind: p.kind as "상비품" | "자재" | "연장" }] : []; });
  const copies = activeLinks(products, catTrades, plinks).flatMap(({ link, p, from }) => kindOk(p.kind) && trades.includes(link.trade) ? [{ ...row(p, copyKey(link), link.trade, link.category, from), kind: p.kind as "상비품" | "자재" | "연장" }] : []);
  const rows = [...own, ...copies];
  return (
    <InventoryAdmin
      trades={trades}
      categories={categories}
      products={rows}
      log={log.filter(e => trades.includes(e.category))}
      admin={admin}
      stars={starsAll[actor.kind === "member" ? actor.member.id : "root"] ?? []}
    />
  );
}
