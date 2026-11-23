import { Suspense } from "react";
import { redirect } from "next/navigation";
import MyVehicles from "@/components/MyVehicles";
import AdminNav from "@/components/admin/AdminNav";
import type { CatalogLite } from "@/components/admin/VehiclesAdmin";
import { getSessionMember } from "@/lib/member-session";
import { getProducts, getTrash, getVehicleItems, getVehicles } from "@/lib/db";

export const metadata = { title: "내 차량 · 빌드메이트" };

export default function MyVehiclePage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 로그인한 회원에게 배차된 차량만 보여 준다 (메뉴 권한과 상관없이 본인 차량은 볼 수 있다)
async function Loader() {
  const member = await getSessionMember();
  if (!member) redirect("/");
  const [all, items, products, trash] = await Promise.all([getVehicles(), getVehicleItems(), getProducts(), getTrash()]);
  const vehicles = all.filter(v => v.driverId === member.id);
  const ids = new Set(vehicles.map(v => v.id));
  const lite = (trashed: boolean) => (p: { key: string; name: string; kind: CatalogLite["kind"]; stock: number; image: string; brand: string }): CatalogLite =>
    ({ key: p.key, name: p.name, kind: p.kind, stock: p.stock, image: p.image, brand: p.brand, trashed });
  const catalog = [...products.map(lite(false)), ...trash.map(lite(true))];
  return (
    <>
      <AdminNav />
      <MyVehicles name={member.name} myId={member.id} vehicles={vehicles} items={items.filter(i => ids.has(i.vehicleId))} catalog={catalog} />
    </>
  );
}
