"use client";

import Link from "next/link";
import { Group, type CatalogLite } from "@/components/admin/VehiclesAdmin";
import type { Vehicle, VehicleItem } from "@/lib/types";

// 배차받은 담당자가 자기 차량에 실린 연장·상비품을 확인하는 화면 (보기 전용)
export default function MyVehicles({ vehicles, items, catalog, name }: { vehicles: Vehicle[]; items: VehicleItem[]; catalog: CatalogLite[]; name: string }) {
  const prod = new Map(catalog.map(p => [p.key, p]));
  const nameOf = (k: string) => prod.get(k)?.name ?? "삭제된 품목";
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">← 메뉴</Link>
        <h1 className="mr-auto text-xl font-extrabold">내 차량</h1>
        <span className="text-sm text-zinc-500">{name}님께 배차된 차량 {vehicles.length}대</span>
      </header>
      {vehicles.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">배차된 차량이 없어요.</p>}
      <div className="space-y-3">
        {vehicles.map(v => {
          const list = items.filter(i => i.vehicleId === v.id);
          const tools = list.filter(i => prod.get(i.key)?.kind === "연장");
          const supplies = list.filter(i => prod.get(i.key)?.kind !== "연장");
          return (
            <section key={v.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
              <div className="flex items-center gap-3">
                <span className="text-3xl" aria-hidden>{v.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-extrabold">{v.nickname || v.name}{v.nickname && <span className="ml-2 text-sm font-semibold text-zinc-500">{v.name}</span>}</div>
                  {v.memo && <div className="truncate text-xs text-zinc-500">{v.memo}</div>}
                </div>
              </div>
              <Group title="연장" tone="tool" rows={tools} nameOf={nameOf} prod={prod} canEdit={false} onBack={() => undefined} />
              <Group title="상비품" tone="supply" rows={supplies} nameOf={nameOf} prod={prod} canEdit={false} onBack={() => undefined} />
            </section>
          );
        })}
      </div>
    </main>
  );
}
