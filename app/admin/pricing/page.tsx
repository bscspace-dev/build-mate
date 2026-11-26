import { Suspense } from "react";
import { redirect } from "next/navigation";
import PricingAdmin from "@/components/admin/PricingAdmin";
import { getActor } from "@/lib/auth";
import { getCategories, getCategoryTrades, getInventory, getFavoriteVendors, getPricingSnapshots, getProducts, getPurchaseLinks, getPurchaseOptions, getVendorShipping } from "@/lib/db";
import type { PurchaseOption, VendorShipping } from "@/lib/types";
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
  const { admin, trades } = await inventoryTrades(actor, "pricing");
  const [products, catTrades, log, allCats, baseLinks, snaps, favorites, options, vendorShip] = await Promise.all([getProducts(), getCategoryTrades(), getInventory(), getCategories(), getPurchaseLinks(), getPricingSnapshots().catch(() => []), getFavoriteVendors().catch(() => [] as string[]), getPurchaseOptions().catch((): Record<string, PurchaseOption[]> => ({})), getVendorShipping().catch((): Record<string, VendorShipping> => ({}))]);
  // 판매 옵션(묶음·단품 등): 품목 아래에 옵션 행으로 이어 붙이고, 구매처·링크는 옵션 행 키(품목키#옵션id)로 합친다
  const links = { ...baseLinks };
  for (const [k, list] of Object.entries(options)) for (const o of list) links[`${k}#${o.id}`] = { url: o.url, vendor: o.vendor, unit: o.unit };
  const categories = Object.fromEntries(trades.map(t => [t, allCats.filter(c => catTrades[c] === t)]));
  const catOf = new Map(products.map(p => [p.key, p.category]));
  return (
    <PricingAdmin
      trades={trades}
      categories={categories}
      products={products.flatMap(p => {
        const trade = catTrades[p.category] ?? "";
        if ((p.kind !== "상비품" && p.kind !== "자재" && p.kind !== "연장") || !trades.includes(trade)) return [];
        const base = { key: p.key, kind: p.kind, stock: p.stock ?? 0, trade, category: p.category, name: p.name, image: p.image || "", price: p.price, incl: p.priceInclVat && Math.round(p.priceInclVat / 1.1) === p.price ? p.priceInclVat : null };
        const opts = (options[p.key] ?? []).map(o => ({ ...base, key: `${p.key}#${o.id}`, base: p.key, price: o.price, incl: o.incl && Math.round(o.incl / 1.1) === o.price ? o.incl : null }));
        return [base, ...opts];
      })}
      log={log.filter(e => trades.includes(e.category)).map(e => ({ ...e, productCategory: catOf.get(e.productKey) ?? "" }))}
      links={links}
      vendorShip={vendorShip}
      favorites={favorites}
      snapshots={snaps.map(x => ({ id: x.id, name: x.name, at: x.at, byName: x.byName, count: x.items.length, excluded: (x.excluded ?? []).length }))}
      admin={admin}
    />
  );
}
