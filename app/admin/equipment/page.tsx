import { Suspense } from "react";
import { redirect } from "next/navigation";
import EquipmentAdmin from "@/components/admin/EquipmentAdmin";
import { actorCan, getActor } from "@/lib/auth";
import { getEquipment } from "@/lib/db";
import { naverReady } from "@/lib/naver-shop";

export const metadata = { title: "장비정보 · 빌드메이트" };

export default function EquipmentPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-zinc-500">불러오는 중…</p>}>
      <Loader />
    </Suspense>
  );
}

// 장비정보: 연장 정보를 모아 두고 최저가를 확인·갱신한다. 네이버 최저가 자동 갱신은 서버에 네이버 키가 있을 때만 켜진다.
async function Loader() {
  const actor = await getActor("equipment");
  if (!actor) redirect("/"); // '장비정보' 메뉴를 쓸 수 없으면 메인으로
  return (
    <EquipmentAdmin
      items={await getEquipment()}
      naverOn={naverReady()}
      canRegister={actorCan(actor, "equipment", "register")}
      canEdit={actorCan(actor, "equipment", "edit")}
      canDelete={actorCan(actor, "equipment", "delete")}
    />
  );
}
