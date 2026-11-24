import { Suspense } from "react";
import { redirect } from "next/navigation";
import VehiclesAdmin, { type CatalogLite } from "@/components/admin/VehiclesAdmin";
import { getActor, vehiclesFull } from "@/lib/auth";
import { getLoadPackages, getActiveMembers, getProducts, getTeams, getTrash, getVehicleItems, getVehicles } from "@/lib/db";
import { sideOf, teamGroup, teamLabel } from "@/lib/roles";

export const metadata = { title: "차량정보 · 빌드메이트" };

export default function VehiclesPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

async function Loader() {
  const actor = await getActor("vehicles");
  if (!actor) redirect("/"); // '차량정보' 메뉴를 쓸 수 없으면 메인으로
  const [vehicles, items, products, trash, memberList, teams] = await Promise.all([getVehicles(), getVehicleItems(), getProducts(), getTrash(), getActiveMembers(), getTeams()]);
  // 배차는 사내 회원(사무실·현장)만 — 거래처 회원은 제외한다
  const members = memberList.filter(m => { const g = teamGroup(teams, m.role); return g !== null && sideOf(g) === "inhouse"; }).map(m => ({ id: m.id, name: m.name, roleLabel: teamLabel(teams, m.role) })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  // 연장·상비품만 내려 보낸다 (휴지통에 있는 품목도 이미 배치된 것은 이름이 보여야 한다)
  const lite = (trashed: boolean) => (p: { key: string; name: string; kind: CatalogLite["kind"]; stock: number; image: string; brand: string; category: string }): CatalogLite =>
    ({ key: p.key, name: p.name, kind: p.kind, stock: p.stock, image: p.image, brand: p.brand, category: p.category ?? "", trashed });
  const catalog = [...products.filter(p => p.kind !== "자재").map(lite(false)), ...trash.filter(p => p.kind !== "자재").map(lite(true))];
  // 모든 권한: 모든 차량을 보고 등록·수정·적재·삭제까지 관리한다.
  // 일부 권한: 나에게 배치된(운전자로 지정된) 차량의 정보만 보기로 확인한다.
  const full = vehiclesFull(actor);
  const selfId = actor.kind === "member" ? actor.member.id : "";
  const mine = full ? vehicles : vehicles.filter(v => !!selfId && v.driverId === selfId);
  const mineIds = new Set(mine.map(v => v.id));
  return (
    <VehiclesAdmin
      vehicles={mine}
      items={full ? items : items.filter(i => mineIds.has(i.vehicleId))}
      members={full ? members : members.filter(m => m.id === selfId)}
      catalog={catalog}
      packages={full ? await getLoadPackages() : []}
      ownOnly={!full}
      canRegister={full}
      canEdit={full}
      canDelete={full}
    />
  );
}
