/* eslint-disable @next/next/no-img-element */
"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { shrink } from "@/components/admin/AddProduct";
import { printElement } from "@/lib/print-client";
import { VEHICLE_ICONS, type Kind, type LoadPackage, type LoadPackageItem, type Vehicle, type VehicleItem, type VehicleOwnership } from "@/lib/types";

const OWNERSHIPS: { v: VehicleOwnership; label: string }[] = [{ v: "", label: "모름" }, { v: "owned", label: "소유" }, { v: "lease", label: "리스" }, { v: "rent", label: "장기렌트" }];
const OIL_INTERVAL_KM = 5000; // 엔진오일은 마지막 교환 뒤 이만큼(km) 달렸으면 교환 시기로 본다
const INSPECT_WARN_DAYS = 30; // 검사일이 이만큼(일) 안으로 다가오면 알린다
const km = (n: number) => n.toLocaleString("ko-KR") + "km";
const daysTo = (iso: string) => Math.round((new Date(iso + "T00:00:00").getTime() - new Date(new Date().toLocaleDateString("sv-SE") + "T00:00:00").getTime()) / 86400000);
type Badge = { text: string; tone: "red" | "amber" | "gray" };
// 날짜 상태(검사일·보험 만기일): 값 없음·지남(빨강), 임박(주황), 여유(회색)
function dateBadge(date: string, emptyText: string): Badge {
  if (!date) return { text: emptyText, tone: "red" };
  const d = daysTo(date);
  if (d < 0) return { text: `${-d}일 지남`, tone: "red" };
  if (d <= INSPECT_WARN_DAYS) return { text: `D-${d}`, tone: "amber" };
  return { text: "정상", tone: "gray" };
}
const inspectionBadge = (v: Vehicle): Badge => dateBadge(v.inspectionDate, "검사일 확인필요");
const insuranceBadge = (v: Vehicle): Badge => dateBadge(v.insuranceExpiry, "만기일 확인필요");
// 엔진오일: 마지막 교환 뒤 일정 거리 이상 달렸으면 교환 시기
function oilBadge(v: Vehicle): Badge | null {
  return v.mileage && v.oilKm && v.mileage - v.oilKm >= OIL_INTERVAL_KM ? { text: `교환 필요 (${km(v.mileage - v.oilKm)} 주행)`, tone: "amber" } : null;
}
const oilText = (v: Vehicle) => (v.oilDate || v.oilKm ? [v.oilDate, v.oilKm > 0 && km(v.oilKm)].filter(Boolean).join(" · ") : "");
const ownText = (v: Vehicle) => OWNERSHIPS.find(o => o.v === v.ownership && o.v)?.label ?? "";
function Pill({ b }: { b: Badge }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${toneCls[b.tone]}`}>{b.text}</span>;
}
function Info({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-bold text-zinc-500">{k}</dt><dd className="mt-0.5 break-words text-base font-semibold">{children || <span className="text-zinc-400">-</span>}</dd></div>;
}

const toneCls = { red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300", amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", gray: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" } as const;
export type VehicleFormData = { name: string; nickname: string; icon: string; memo: string; driverId: string; model: string; year: string; vin: string; ownership: VehicleOwnership; mileage: number; oilDate: string; oilKm: number; inspectionDate: string; insurer: string; policyNo: string; insuranceExpiry: string; premium: number; insurancePhone: string; insuranceNote: string };

export type MemberLite = { id: string; name: string; roleLabel: string };
export type CatalogLite = { key: string; name: string; kind: Kind; stock: number; image: string; brand: string; trashed: boolean };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const chipOn = "border-blue-600 bg-blue-600 text-white";
const chipOff = "border-black/15 bg-white text-zinc-700 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300";

type Back = { item: VehicleItem; name: string; kind: Kind };
type Dialog =
  | { t: "vehicle"; v: Vehicle | null }
  | { t: "assign"; v: Vehicle }
  | { t: "pkg"; v: Vehicle }
  | { t: "pkgForm"; v: Vehicle; p: LoadPackage | null }
  | { t: "pkgApply"; v: Vehicle; p: LoadPackage }
  | { t: "back"; v: Vehicle; b: Back }
  | { t: "remove"; v: Vehicle }
  | null;

// 차량정보: 차량마다 배치된 연장(개체별)과 나간 상비품(수량)을 보고, 배치·회수·소진을 기록한다.
// 연장은 차량에 배정하면 장비운용(창고) 재고에서 1개 빠지고, 내리면 재고로 돌아온다.
// 상비품은 차량에 실린 수량을 창고 재고와 따로 센다 (싣거나 빼도 창고 재고는 바뀌지 않는다).
export default function VehiclesAdmin({
  vehicles, items, members, catalog, packages, canRegister, canEdit, canDelete,
}: {
  vehicles: Vehicle[]; items: VehicleItem[]; members: MemberLite[]; catalog: CatalogLite[]; packages: LoadPackage[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"vehicle" | "item">("vehicle");
  const [infoId, setInfoId] = useState<string | null>(null); // 차량 정보 보기(상세 화면)로 열어 둔 차량
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const prod = useMemo(() => new Map(catalog.map(p => [p.key, p])), [catalog]);
  const vLabel = (v: Vehicle) => (v.nickname ? `${v.name} (${v.nickname})` : v.name); // 차량 번호가 기본, 별칭은 괄호로
  const memberMap = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);
  const driverOf = (v: Vehicle) => memberMap.get(v.driverId); // 배차된 회원 (없거나 지워진 회원이면 undefined)
  const nameOf = (k: string) => prod.get(k)?.name ?? "삭제된 품목";
  const kindOf = (k: string): Kind => prod.get(k)?.kind ?? "상비품";
  const byVehicle = useMemo(() => {
    const m = new Map<string, VehicleItem[]>();
    items.forEach(i => m.set(i.vehicleId, [...(m.get(i.vehicleId) ?? []), i]));
    return m;
  }, [items]);

  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const shown = vehicles.filter(v => !kw || norm(v.name).includes(kw) || norm(v.nickname).includes(kw) || norm(v.memo).includes(kw) || norm(v.model).includes(kw) || norm(v.vin).includes(kw) || norm(driverOf(v)?.name ?? "").includes(kw) || (byVehicle.get(v.id) ?? []).some(i => norm(nameOf(i.key)).includes(kw) || norm(i.note).includes(kw)));

  // 품목별 현황: 어떤 연장·상비품이 어느 차량에 몇 개 나가 있는가
  const perItem = useMemo(() => {
    const m = new Map<string, { key: string; total: number; at: { v: string; qty: number; note: string }[] }>();
    const vname = new Map(vehicles.map(v => [v.id, vLabel(v)]));
    items.forEach(i => {
      const e = m.get(i.key) ?? { key: i.key, total: 0, at: [] };
      e.total += i.qty;
      e.at.push({ v: vname.get(i.vehicleId) ?? "?", qty: i.qty, note: i.note });
      m.set(i.key, e);
    });
    return [...m.values()].sort((a, b) => Number(kindOf(a.key) !== "연장") - Number(kindOf(b.key) !== "연장") || nameOf(a.key).localeCompare(nameOf(b.key), "ko"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, vehicles, prod]);

  const lastJson = useRef<{ vehicle?: { id: string } }>({}); // 마지막 응답 (차량 등록 뒤 새 차량 번호를 알기 위해)
  async function call(body: Record<string, unknown>, done: string, url = "/api/admin/vehicles"): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string; vehicle?: { id: string } };
      lastJson.current = j;
      if (!r.ok) throw new Error(j.error ?? "처리하지 못했어요.");
      setToast(done);
      setTimeout(() => setToast(""), 2500);
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "처리하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  // 고른 품목을 차례로 싣는다. 도중에 실패하면 거기서 멈추고, 이미 실린 품목 번호를 돌려준다(선택에서 빠진다).
  async function assignMany(v: Vehicle, rows: { key: string; qty: number; note: string; name: string }[]): Promise<string[]> {
    if (busy) return [];
    setBusy(true);
    setErr("");
    const done: string[] = [];
    try {
      for (const r of rows) {
        const res = await fetch("/api/admin/vehicles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "assign", id: v.id, key: r.key, qty: r.qty, note: r.note }) });
        if (res.status === 401) { router.replace("/"); return done; }
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error("“" + r.name + "”: " + (j.error ?? "싣지 못했어요.") + (done.length ? " (앞의 " + done.length + "개는 실렸어요)" : ""));
        done.push(r.key);
      }
      setToast(rows.length === 1 ? rows[0].name + "을(를) " + vLabel(v) + "에 실었어요" : "품목 " + rows.length + "개를 " + vLabel(v) + "에 실었어요");
      setTimeout(() => setToast(""), 2500);
      setDlg(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "싣지 못했어요.");
    } finally {
      setBusy(false);
      router.refresh();
    }
    return done;
  }
  // 차량 저장: 정보를 저장한 뒤, 고른 사진을 올린다 (사진이 실패해도 차량은 저장돼 있다)
  async function saveVehicle(cur: Vehicle | null, d: VehicleFormData, ph: { files: File[]; note: string }) {
    const ok = await call(cur ? { action: "update", id: cur.id, ...d } : { action: "add", ...d }, cur ? "차량 정보를 수정했어요" : "차량을 등록했어요");
    if (!ok) return;
    if (ph.files.length > 0) {
      const id = cur?.id ?? lastJson.current.vehicle?.id;
      try {
        if (!id) throw new Error("no id");
        const fd = new FormData();
        fd.set("action", "add");
        fd.set("id", id);
        fd.set("note", ph.note);
        for (const f of ph.files) {
          const blob = await shrink(f, 1400);
          fd.append("photo", new File([blob], blob.type === "image/webp" ? "vehicle.webp" : "vehicle.jpg", { type: blob.type }));
        }
        const r = await fetch("/api/vehicle-photos", { method: "POST", body: fd });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "사진 오류");
        router.refresh();
      } catch (e) {
        setToast("차량은 저장했지만 사진은 올리지 못했어요. " + (e instanceof Error && e.message !== "no id" ? e.message : "차량 정보 수정에서 다시 올려 주세요."));
        setTimeout(() => setToast(""), 5000);
      }
    }
    setDlg(null);
  }
  async function removePhoto(vehicleId: string, url: string): Promise<boolean> {
    try {
      const r = await fetch("/api/vehicle-photos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", id: vehicleId, url }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "지우지 못했어요.");
      router.refresh();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "지우지 못했어요.");
      return false;
    }
  }
  const close = () => { if (!busy) { setDlg(null); setErr(""); } };
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 차량을 펼치면 나오는 상세: 싣기·정보 수정·삭제 버튼과 실린 연장·상비품
  const detail = (v: Vehicle) => {
    const list = byVehicle.get(v.id) ?? [];
    const tools = list.filter(i => kindOf(i.key) === "연장");
    const supplies = list.filter(i => kindOf(i.key) !== "연장");
    return (
      <div className="px-4 pb-4">
        <div className="flex flex-wrap gap-2 py-3">
          {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "pkg", v }); }} className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-bold text-white">📦 적재 패키지</button>}
          <button type="button" onClick={() => { setInfoId(v.id); window.scrollTo({ top: 0 }); }} className="rounded-xl border border-blue-600 px-3.5 py-2 text-sm font-bold text-blue-700 dark:text-blue-300">차량 정보 보기</button>
          {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "vehicle", v }); }} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold dark:border-white/15">차량 정보 수정</button>}
          {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "remove", v }); }} className="rounded-xl bg-red-50 px-3.5 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">차량 삭제</button>}
        </div>
        <Group title="연장" tone="tool" rows={tools} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v, b }); }} />
        <Group title="상비품" tone="supply" rows={supplies} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v, b }); }} />
      </div>
    );
  };
  const infoV = infoId ? vehicles.find(x => x.id === infoId) : undefined;
  const loadText = (v: Vehicle) => {
    const list = byVehicle.get(v.id) ?? [];
    const tools = list.filter(i => kindOf(i.key) === "연장").reduce((n, i) => n + i.qty, 0);
    const supplies = list.filter(i => kindOf(i.key) !== "연장");
    return `연장 ${tools}개 · 상비품 ${supplies.length}종 (${supplies.reduce((n, i) => n + i.qty, 0)}개)`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      {infoV ? (
        <div className="py-5" id="vehicle-sheet">
          <button type="button" onClick={() => setInfoId(null)} className="text-sm font-semibold text-zinc-500 hover:text-blue-600">← 차량 목록</button>
          <header className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-extrabold tracking-wide">{infoV.name}</h1>
            {infoV.nickname && <span className="text-lg font-semibold text-zinc-500">{infoV.nickname}</span>}
            <Pill b={inspectionBadge(infoV)} />
            {oilBadge(infoV) && <Pill b={oilBadge(infoV)!} />}
            <span className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => void printElement(document.getElementById("vehicle-sheet"), { title: `${infoV.name} 차량 정보`, heading: undefined })} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold dark:border-white/15">🖨 인쇄</button>
              {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "pkg", v: infoV }); }} className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-bold text-white">📦 적재 패키지</button>}
              {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "vehicle", v: infoV }); }} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold dark:border-white/15">차량 정보 수정</button>}
              {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "remove", v: infoV }); }} className="rounded-xl bg-red-50 px-3.5 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">차량 삭제</button>}
            </span>
          </header>
          {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}

          <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900" id="vs-basic" aria-label="기본 정보">
            <div className="flex items-center gap-2"><h2 className="mr-auto text-sm font-extrabold">기본 정보</h2><button type="button" onClick={() => void printElement(document.getElementById("vs-basic"), { title: `${infoV.name} 기본 정보`, heading: `${infoV.name} · 기본 정보` })} className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-bold dark:border-white/15">🖨 인쇄</button></div>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Info k="차종">{infoV.model}</Info>
              <Info k="연식">{infoV.year}</Info>
              <Info k="소유 형태">{ownText(infoV)}</Info>
              <Info k="차대번호"><span className="font-mono text-sm">{infoV.vin}</span></Info>
              <Info k="현재 키로수">{infoV.mileage > 0 ? km(infoV.mileage) : ""}</Info>
              <Info k="배차 회원">{driverOf(infoV) ? `${driverOf(infoV)!.name} · ${driverOf(infoV)!.roleLabel}` : ""}</Info>
              <Info k="차량 검사일">{infoV.inspectionDate && <>{infoV.inspectionDate} <Pill b={inspectionBadge(infoV)} /></>}</Info>
              <Info k="엔진오일 마지막 교환">{oilText(infoV)}</Info>
              <Info k="교환 뒤 주행">{infoV.mileage && infoV.oilKm && infoV.mileage >= infoV.oilKm ? <>{km(infoV.mileage - infoV.oilKm)}{oilBadge(infoV) && <> <Pill b={oilBadge(infoV)!} /></>}</> : ""}</Info>
              <Info k="등록일">{new Date(infoV.createdAt).toLocaleDateString("ko-KR")}</Info>
            </dl>
            {infoV.memo && (
              <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
                <div className="text-xs font-bold text-zinc-500">비고</div>
                <p className="mt-1 whitespace-pre-line break-words text-sm">{infoV.memo}</p>
              </div>
            )}
          </section>

          <section className="mt-3 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900" id="vs-ins" aria-label="보험 정보">
            <div className="flex items-center gap-2"><h2 className="mr-auto text-sm font-extrabold">보험 정보</h2><button type="button" onClick={() => void printElement(document.getElementById("vs-ins"), { title: `${infoV.name} 보험 정보`, heading: `${infoV.name} · 보험 정보` })} className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-bold dark:border-white/15">🖨 인쇄</button></div>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Info k="보험사">{infoV.insurer}</Info>
              <Info k="증권번호"><span className="font-mono text-sm">{infoV.policyNo}</span></Info>
              <Info k="보험 만기일">{infoV.insuranceExpiry ? <>{infoV.insuranceExpiry} <Pill b={insuranceBadge(infoV)} /></> : <Pill b={insuranceBadge(infoV)} />}</Info>
              <Info k="연 보험료">{infoV.premium > 0 ? infoV.premium.toLocaleString("ko-KR") + "원" : ""}</Info>
              <Info k="보험 연락처">{infoV.insurancePhone}</Info>
            </dl>
            {infoV.insuranceNote && (
              <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
                <div className="text-xs font-bold text-zinc-500">특이사항</div>
                <p className="mt-1 whitespace-pre-line break-words text-sm">{infoV.insuranceNote}</p>
              </div>
            )}
          </section>

          <section className="mt-3 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900" id="vs-load" aria-label="적재 현황">
            <div className="flex items-center gap-2"><h2 className="mr-auto text-sm font-extrabold">적재 현황 <span className="font-normal text-zinc-500">· {loadText(infoV)}</span></h2><button type="button" onClick={() => void printElement(document.getElementById("vs-load"), { title: `${infoV.name} 적재 현황`, heading: `${infoV.name} · 적재 현황` })} className="rounded-lg border border-black/15 px-2.5 py-1 text-xs font-bold dark:border-white/15">🖨 인쇄</button></div>
            {(() => {
              const list = byVehicle.get(infoV.id) ?? [];
              return (
                <>
                  <Group title="연장" tone="tool" rows={list.filter(i => kindOf(i.key) === "연장")} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v: infoV, b }); }} />
                  <Group title="상비품" tone="supply" rows={list.filter(i => kindOf(i.key) !== "연장")} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v: infoV, b }); }} />
                </>
              );
            })()}
          </section>
        </div>
      ) : (
      <>
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">차량정보</h1>
        <span className="text-sm text-zinc-500">차량 {vehicles.length}대</span>
        {canRegister && <button type="button" onClick={() => { setErr(""); setDlg({ t: "vehicle", v: null }); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 차량 등록</button>}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([["vehicle", "차량 정보"], ["item", "적재 품목별"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-4 py-2 ${view === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={() => void printElement(document.getElementById("vehicle-ledger"), { title: "차량 관리 대장", heading: "차량 관리 대장", landscape: true })} disabled={shown.length === 0} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold disabled:opacity-40 dark:border-white/15">🖨 인쇄</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="차량·품목 검색" className="min-w-[10rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900" />
      </div>

      {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}

      {view === "vehicle" ? (
        <div className="mt-4">
          {vehicles.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 차량이 없어요.{canRegister ? " 위의 “차량 등록”으로 먼저 차량을 추가해 주세요." : ""}</p>}
          {vehicles.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">검색 결과가 없어요.</p>}

          {/* 인쇄 전용 차량 대장: 화면에는 보이지 않고, 「인쇄」를 누르면 가로 A4 로 출력된다 */}
          <div id="vehicle-ledger" className="hidden">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
              <thead>
                <tr>{["차량 번호", "별칭", "차종", "연식", "차대번호", "소유", "키로수", "엔진오일 교환", "검사일", "보험사", "증권번호", "보험 만기", "배차", "비고"].map(h => <th key={h} style={{ border: "1px solid #999", background: "#eee", padding: "3px 4px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map(v => (
                  <tr key={v.id}>
                    {[v.name, v.nickname, v.model, v.year, v.vin, ownText(v), v.mileage > 0 ? km(v.mileage) : "", oilText(v), v.inspectionDate, v.insurer, v.policyNo, v.insuranceExpiry, driverOf(v)?.name ?? "", v.memo].map((c, i) => <td key={i} style={{ border: "1px solid #999", padding: "3px 4px", verticalAlign: "top", whiteSpace: i === 13 ? "pre-line" : "nowrap" }}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 넓은 화면: 한 줄에 차량 한 대, 중요한 정보만 (자세한 내용은 「차량 정보 보기」) */}
          {shown.length > 0 && (
            <div className="hidden overflow-x-auto rounded-2xl border border-black/10 bg-white md:block dark:border-white/10 dark:bg-zinc-900">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-bold text-zinc-500 dark:bg-zinc-800/60">
                  <tr>
                    {["차량 번호", "차종 · 연식", "키로수", "검사일", "보험 만기", "배차", "적재"].map(h => <th key={h} className="whitespace-nowrap px-3 py-2.5">{h}</th>)}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map(v => {
                    const isOpen = open.has(v.id) || (kw !== "" && (byVehicle.get(v.id) ?? []).length > 0);
                    const ib = inspectionBadge(v);
                    const ob = oilBadge(v);
                    return (
                      <Fragment key={v.id}>
                        <tr onClick={() => toggle(v.id)} aria-expanded={isOpen} className="cursor-pointer border-t border-black/10 align-middle hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-zinc-800/50">
                          <td className="whitespace-nowrap px-3 py-2.5"><b className="text-lg font-extrabold tracking-wide">{v.name}</b>{v.nickname && <span className="ml-2 text-xs font-semibold text-zinc-500">{v.nickname}</span>}</td>
                          <td className="whitespace-nowrap px-3 py-2.5">{[v.model, v.year && `${v.year}년식`].filter(Boolean).join(" · ") || <span className="text-zinc-400">-</span>}</td>
                          <td className="whitespace-nowrap px-3 py-2.5">{v.mileage > 0 ? km(v.mileage) : <span className="text-zinc-400">-</span>}{ob && <div className="mt-0.5"><Pill b={{ text: "오일교환 필요", tone: ob.tone }} /></div>}</td>
                          <td className="whitespace-nowrap px-3 py-2.5"><Pill b={ib} /></td>
                          <td className="whitespace-nowrap px-3 py-2.5"><Pill b={insuranceBadge(v)} /></td>
                          <td className="whitespace-nowrap px-3 py-2.5">{driverOf(v) ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">{driverOf(v)!.name}</span> : <span className="text-zinc-400">-</span>}</td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300">{loadText(v)}</td>
                          <td className="px-2 py-2.5 text-zinc-400" aria-hidden>{isOpen ? "▲" : "▼"}</td>
                        </tr>
                        {isOpen && <tr className="border-t border-black/5 bg-zinc-50/60 dark:border-white/5 dark:bg-zinc-800/30"><td colSpan={8}>{detail(v)}</td></tr>}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 좁은 화면(휴대폰): 차량마다 카드, 중요한 정보만 */}
          <div className="space-y-3 md:hidden">
            {shown.map(v => {
              const isOpen = open.has(v.id) || (kw !== "" && (byVehicle.get(v.id) ?? []).length > 0);
              const ob = oilBadge(v);
              return (
                <section key={v.id} className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
                  <button type="button" onClick={() => toggle(v.id)} aria-expanded={isOpen} className="block w-full p-4 text-left">
                    <span className="flex items-center gap-2">
                      <b className="min-w-0 flex-1 truncate text-lg font-extrabold tracking-wide">{v.name}{v.nickname && <small className="ml-2 text-xs font-semibold text-zinc-500">{v.nickname}</small>}</b>
                      <Pill b={inspectionBadge(v)} />
                      <span className="text-zinc-400" aria-hidden>{isOpen ? "▲" : "▼"}</span>
                    </span>
                    <span className="mt-1.5 block text-sm">{[v.model, v.year && `${v.year}년식`, v.mileage > 0 && km(v.mileage)].filter(Boolean).join(" · ") || <span className="text-zinc-400">차량 정보 없음</span>}{ob && <> <Pill b={{ text: "오일교환 필요", tone: ob.tone }} /></>}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                      <span className="flex items-center gap-1 text-zinc-500">보험 <Pill b={insuranceBadge(v)} /></span>
                      <span className={driverOf(v) ? "font-bold text-emerald-700 dark:text-emerald-300" : "text-zinc-400"}>{driverOf(v) ? `배차 ${driverOf(v)!.name}` : "배차 안 됨"}</span>
                      <span className="font-semibold text-blue-700 dark:text-blue-300">{loadText(v)}</span>
                    </span>
                  </button>
                  {isOpen && <div className="border-t border-black/10 dark:border-white/10">{detail(v)}</div>}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {perItem.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">차량에 배치된 품목이 아직 없어요.</p>}
          {perItem.filter(e => !kw || norm(nameOf(e.key)).includes(kw) || e.at.some(a => norm(a.v).includes(kw))).map(e => (
            <div key={e.key} className="flex items-start gap-3 rounded-2xl border border-black/10 bg-white p-3.5 dark:border-white/10 dark:bg-zinc-900">
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${kindOf(e.key) === "연장" ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"}`}>{kindOf(e.key)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{nameOf(e.key)} <span className="font-normal text-zinc-500">· 차량 적재 합계 {e.total}개</span></div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  {e.at.map((a, i) => <span key={i} className="rounded-full bg-zinc-100 px-2.5 py-1 dark:bg-zinc-800">{a.v}{a.note ? ` (${a.note})` : ""} · {a.qty}개</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {dlg?.t === "vehicle" && <VehicleForm key={dlg.v?.id ?? "new"} v={dlg.v} members={members} busy={busy} err={err} onClose={close} onSave={(d, ph) => void saveVehicle(dlg.v, d, ph)} onRemovePhoto={url => (dlg.v ? removePhoto(dlg.v.id, url) : Promise.resolve(false))} />}
      {dlg?.t === "pkg" && <PackageDialog v={dlg.v} packages={packages} catalog={catalog} canEdit={canEdit} busy={busy} err={err} onClose={close}
        onApply={p => { setErr(""); setDlg({ t: "pkgApply", v: dlg.v, p }); }}
        onNew={() => { setErr(""); setDlg({ t: "pkgForm", v: dlg.v, p: null }); }}
        onEdit={p => { setErr(""); setDlg({ t: "pkgForm", v: dlg.v, p }); }}
        onRemove={p => void call({ action: "remove", id: p.id }, "패키지를 지웠어요", "/api/admin/load-packages")}
        onDirect={() => { setErr(""); setDlg({ t: "assign", v: dlg.v }); }} />}
      {dlg?.t === "pkgForm" && <AssignForm key={"pkg" + (dlg.p?.id ?? "new")} v={dlg.v} catalog={catalog.filter(p => !p.trashed)} busy={busy} err={err} onClose={close} onSave={async () => []}
        pkg={{ id: dlg.p?.id ?? null, name: dlg.p?.name ?? "", items: dlg.p?.items ?? [], onBack: () => { setErr(""); setDlg({ t: "pkg", v: dlg.v }); },
          onSavePkg: (name, its) => void call({ action: "save", id: dlg.p?.id ?? "", name, items: its }, "패키지를 저장했어요", "/api/admin/load-packages").then(ok => { if (ok) setDlg({ t: "pkg", v: dlg.v }); }) }} />}
      {dlg?.t === "pkgApply" && <PackageApply v={dlg.v} p={dlg.p} catalog={catalog} busy={busy} err={err} onClose={close} onBack={() => { setErr(""); setDlg({ t: "pkg", v: dlg.v }); }} onSave={rows => void assignMany(dlg.v, rows)} />}
      {dlg?.t === "assign" && <AssignForm key={dlg.v.id} v={dlg.v} catalog={catalog.filter(p => !p.trashed)} busy={busy} err={err} onClose={close} onSave={rows => assignMany(dlg.v, rows)} />}
      {dlg?.t === "back" && <BackForm key={dlg.b.item.id} v={dlg.v} b={dlg.b} busy={busy} err={err} onClose={close} onSave={qty => call({ action: "return", id: dlg.b.item.id, qty }, dlg.b.kind === "연장" ? `${dlg.b.name}을(를) 차량에서 내려 창고 재고로 돌렸어요` : `${dlg.b.name} ${qty}개를 차량에서 뺐어요`).then(ok => { if (ok) setDlg(null); })} />}
      <Modal open={dlg?.t === "remove"} onClose={close}>
        {dlg?.t === "remove" && (
          <div>
            <h2 className="text-lg font-bold">“{vLabel(dlg.v)}” 차량을 삭제할까요?</h2>
            {(() => {
              const list = byVehicle.get(dlg.v.id) ?? [];
              const tools = list.filter(i => kindOf(i.key) === "연장");
              const supplies = list.filter(i => kindOf(i.key) !== "연장");
              return list.length === 0 ? <p className="mt-1 text-sm text-zinc-500">배치된 품목이 없어요.</p> : (
                <p className="mt-1 text-sm text-zinc-500">차량에 실린 품목은 모두 되돌린 뒤 삭제해요. 연장 {tools.reduce((n, i) => n + i.qty, 0)}개는 창고 재고로 돌아가고, 상비품 {supplies.length}종({supplies.reduce((n, i) => n + i.qty, 0)}개)은 차량에서 빠져요.</p>
              );
            })()}
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "remove", id: dlg.v.id }, "차량을 삭제하고, 실려 있던 품목을 되돌렸어요").then(ok => { if (ok) setDlg(null); })} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// 차량에 실린 품목: 사진 카드 격자. 수량은 사진 위 배지로 크게 보여 준다.
export function Group({ title, tone, rows, nameOf, prod, canEdit, onBack }: { title: string; tone: "tool" | "supply"; rows: VehicleItem[]; nameOf: (k: string) => string; prod: Map<string, CatalogLite>; canEdit: boolean; onBack: (b: Back) => void }) {
  const total = rows.reduce((n, i) => n + i.qty, 0);
  const head = tone === "tool" ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200" : "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200";
  const badge = tone === "tool" ? "bg-blue-600" : "bg-amber-600";
  return (
    <div className="mt-3 first:mt-1">
      <h3 className="flex items-center gap-2 text-sm font-extrabold">
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${head}`}>{title}</span>
        <span className="text-xs font-semibold text-zinc-500">{rows.length === 0 ? "없어요" : `${rows.length}종 · 총 ${total}개`}</span>
      </h3>
      {rows.length > 0 && (
        <ul className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9">
          {rows.map(i => {
            const p = prod.get(i.key);
            const isTool = p?.kind === "연장";
            return (
              <li key={i.id} className="flex flex-col overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
                <div className="relative">
                  {p?.image ? (
                    <img src={p.image} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
                  ) : <div className="aspect-square w-full bg-zinc-100 dark:bg-zinc-800" />}
                  <span className={`absolute right-1 top-1 rounded-full px-1.5 py-px text-[11px] font-extrabold leading-tight text-white shadow ${badge}`}>{isTool && i.qty === 1 ? "1개" : "×" + i.qty}</span>
                </div>
                <div className="flex flex-1 flex-col gap-1 p-1.5">
                  <span className="line-clamp-2 min-h-[2.3em] text-[11px] font-bold leading-snug">{nameOf(i.key)}</span>
                  {i.note && <span className="truncate rounded bg-zinc-100 px-1 py-px text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{i.note}</span>}
                  {canEdit && <button type="button" onClick={() => onBack({ item: i, name: nameOf(i.key), kind: p?.kind ?? "상비품" })} className="mt-auto rounded-md border border-black/15 py-1 text-[11px] font-bold hover:border-red-400 hover:text-red-600 dark:border-white/15">{isTool ? "내리기" : "빼기"}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VehicleForm({ v, members, busy, err, onClose, onSave, onRemovePhoto }: { v: Vehicle | null; members: MemberLite[]; busy: boolean; err: string; onClose: () => void; onSave: (d: VehicleFormData, ph: { files: File[]; note: string }) => void; onRemovePhoto: (url: string) => Promise<boolean> }) {
  const [driverId, setDriverId] = useState(v && members.some(m => m.id === v.driverId) ? v.driverId : "");
  const [icon] = useState(v?.icon ?? VEHICLE_ICONS[0]); // 아이콘은 더 이상 화면에 쓰지 않는다 (기존 값 유지)
  const [name, setName] = useState(v?.name ?? "");
  const [nickname, setNickname] = useState(v?.nickname ?? "");
  const [memo, setMemo] = useState(v?.memo ?? "");
  const [model, setModel] = useState(v?.model ?? "");
  const [year, setYear] = useState(v?.year ?? "");
  const [vin, setVin] = useState(v?.vin ?? "");
  const [ownership, setOwnership] = useState<VehicleOwnership>(v?.ownership ?? "");
  const [mileage, setMileage] = useState(v?.mileage ? String(v.mileage) : "");
  const [oilDate, setOilDate] = useState(v?.oilDate ?? "");
  const [oilKm, setOilKm] = useState(v?.oilKm ? String(v.oilKm) : "");
  const [inspectionDate, setInspectionDate] = useState(v?.inspectionDate ?? "");
  const [insurer, setInsurer] = useState(v?.insurer ?? "");
  const [policyNo, setPolicyNo] = useState(v?.policyNo ?? "");
  const [insuranceExpiry, setInsuranceExpiry] = useState(v?.insuranceExpiry ?? "");
  const [premium, setPremium] = useState(v?.premium ? String(v.premium) : "");
  const [insurancePhone, setInsurancePhone] = useState(v?.insurancePhone ?? "");
  const [insuranceNote, setInsuranceNote] = useState(v?.insuranceNote ?? "");
  const [tab, setTab] = useState<"basic" | "care" | "ins" | "assign" | "photo">("basic"); // 입력 구역 탭
  // 현황 사진: 이미 올린 사진(지우면 바로 지워진다) + 이번에 새로 고른 사진(저장할 때 올라간다)
  const [fresh, setFresh] = useState<{ id: number; file: File; url: string }[]>([]);
  const [pnote, setPnote] = useState("");
  const [gone, setGone] = useState<Set<string>>(new Set());
  const existing = (v?.photos ?? []).filter(p => !gone.has(p.url));
  const addFresh = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list];
    setFresh(prev => [...prev, ...picked.slice(0, Math.max(0, 4 - prev.length)).map((file, i) => ({ id: Date.now() + i, file, url: URL.createObjectURL(file) }))]);
  };
  const dropFresh = (id: number) => setFresh(prev => { const x = prev.find(p => p.id === id); if (x) URL.revokeObjectURL(x.url); return prev.filter(p => p.id !== id); });
  const dropOld = async (url: string) => { if (await onRemovePhoto(url)) setGone(prev => new Set(prev).add(url)); };
  const digits = (s: string) => s.replace(/\D/g, "").slice(0, 7);
  return (
    <Modal open onClose={onClose} wide>
      <form onSubmit={e => { e.preventDefault(); if (!busy) onSave({ name, nickname, icon, memo, driverId, model, year, vin, ownership, mileage: Number(mileage || 0), oilDate, oilKm: Number(oilKm || 0), inspectionDate, insurer, policyNo, insuranceExpiry, premium: Number(premium || 0), insurancePhone, insuranceNote }, { files: fresh.map(f => f.file), note: pnote }); }}>
        <h2 className="text-lg font-bold">{v ? "차량 정보 수정" : "차량 등록"}</h2>
        <div className="mt-3 flex gap-1 border-b border-black/10 dark:border-white/10" role="tablist" aria-label="입력 구역">
          <button key="basic" type="button" role="tab" aria-selected={tab === "basic"} onClick={() => setTab("basic")} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === "basic" ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>기본 정보{true && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}</button>
          <button key="care" type="button" role="tab" aria-selected={tab === "care"} onClick={() => setTab("care")} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === "care" ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>정비·검사{!!(mileage || inspectionDate || oilDate || oilKm) && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}</button>
          <button key="ins" type="button" role="tab" aria-selected={tab === "ins"} onClick={() => setTab("ins")} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === "ins" ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>보험{!!(insurer || policyNo || insuranceExpiry || premium || insurancePhone || insuranceNote) && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}</button>
          <button key="assign" type="button" role="tab" aria-selected={tab === "assign"} onClick={() => setTab("assign")} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === "assign" ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>배차·비고{!!(driverId || memo) && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}</button>
          <button key="photo" type="button" role="tab" aria-selected={tab === "photo"} onClick={() => setTab("photo")} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === "photo" ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>사진{(fresh.length > 0 || existing.length > 0) && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}</button>
        </div>

        <div className={`mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2 ${tab === "basic" ? "" : "hidden"}`} role="tabpanel">
          <div><label htmlFor="vh-name" className="block text-sm font-bold">차량 번호</label><input id="vh-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="예: 12가3456" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-nick" className="block text-sm font-bold">별칭 <span className="font-normal text-zinc-500">(선택)</span></label><input id="vh-nick" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={20} placeholder="예: 1호차" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-model" className="block text-sm font-bold">차종 <span className="font-normal text-zinc-500">(선택)</span></label><input id="vh-model" value={model} onChange={e => setModel(e.target.value)} maxLength={30} placeholder="예: 포터, 봉고, K3" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-year" className="block text-sm font-bold">연식 <span className="font-normal text-zinc-500">(선택)</span></label><input id="vh-year" value={year} onChange={e => setYear(e.target.value)} maxLength={10} placeholder="예: 2017, 2022/11" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-vin" className="block text-sm font-bold">차대번호 <span className="font-normal text-zinc-500">(선택)</span></label><input id="vh-vin" value={vin} onChange={e => setVin(e.target.value)} maxLength={30} placeholder="KMFZCY7KAJU476218" autoComplete="off" autoCapitalize="characters" spellCheck={false} className={`${inputCls.replace("py-3", "py-2.5")} mt-1 font-mono`} /></div>
          <div><div className="block text-sm font-bold">소유 형태 <span className="font-normal text-zinc-500">(선택)</span></div><div className="mt-1 flex gap-1" role="radiogroup" aria-label="소유 형태">{OWNERSHIPS.map(o => <button key={o.v || "none"} type="button" role="radio" aria-checked={ownership === o.v} onClick={() => setOwnership(o.v)} className={`flex-1 rounded-xl border py-2 text-xs font-extrabold sm:text-sm ${ownership === o.v ? chipOn : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{o.label}</button>)}</div></div>
        </div>
        <div className={`mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2 ${tab === "care" ? "" : "hidden"}`} role="tabpanel">
          <div><label htmlFor="vh-km" className="block text-sm font-bold">현재 주행거리 <span className="font-normal text-zinc-500">(km, 선택)</span></label><input id="vh-km" inputMode="numeric" value={mileage ? Number(mileage).toLocaleString("ko-KR") : ""} onChange={e => setMileage(digits(e.target.value))} placeholder="예: 85,000" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1 text-right`} /></div>
          <div><label htmlFor="vh-inspect" className="block text-sm font-bold">차량 검사일 <span className="font-normal text-zinc-500">(만료·예정일)</span></label><input id="vh-inspect" type="date" value={inspectionDate} onChange={e => setInspectionDate(e.target.value)} className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-oil-date" className="block text-sm font-bold">엔진오일 마지막 교환일 <span className="font-normal text-zinc-500">(선택)</span></label><input id="vh-oil-date" type="date" value={oilDate} onChange={e => setOilDate(e.target.value)} className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-oil-km" className="block text-sm font-bold">교환 때 주행거리 <span className="font-normal text-zinc-500">(km)</span></label><input id="vh-oil-km" inputMode="numeric" value={oilKm ? Number(oilKm).toLocaleString("ko-KR") : ""} onChange={e => setOilKm(digits(e.target.value))} placeholder="예: 80,000" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1 text-right`} /></div>
          <p className="-mt-1 text-xs text-zinc-500 sm:col-span-2">현재 주행거리가 마지막 교환 뒤 5,000km를 넘으면 목록에 「오일교환 필요」로 표시돼요.</p>
        </div>
        <div className={`mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2 ${tab === "ins" ? "" : "hidden"}`} role="tabpanel">
          <div><label htmlFor="vh-insurer" className="block text-sm font-bold">보험사</label><input id="vh-insurer" value={insurer} onChange={e => setInsurer(e.target.value)} maxLength={30} placeholder="예: 삼성화재" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-policy" className="block text-sm font-bold">증권번호</label><input id="vh-policy" value={policyNo} onChange={e => setPolicyNo(e.target.value)} maxLength={40} autoComplete="off" spellCheck={false} className={`${inputCls.replace("py-3", "py-2.5")} mt-1 font-mono`} /></div>
          <div><label htmlFor="vh-ins-exp" className="block text-sm font-bold">보험 만기일</label><input id="vh-ins-exp" type="date" value={insuranceExpiry} onChange={e => setInsuranceExpiry(e.target.value)} className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-premium" className="block text-sm font-bold">연 보험료 <span className="font-normal text-zinc-500">(원)</span></label><input id="vh-premium" inputMode="numeric" value={premium ? Number(premium).toLocaleString("ko-KR") : ""} onChange={e => setPremium(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="예: 1,200,000" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1 text-right`} /></div>
          <div><label htmlFor="vh-ins-phone" className="block text-sm font-bold">보험 연락처 <span className="font-normal text-zinc-500">(담당자·긴급출동)</span></label><input id="vh-ins-phone" inputMode="tel" value={insurancePhone} onChange={e => setInsurancePhone(e.target.value)} maxLength={30} placeholder="예: 1588-5114" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
          <div><label htmlFor="vh-ins-note" className="block text-sm font-bold">보험 특이사항</label><input id="vh-ins-note" value={insuranceNote} onChange={e => setInsuranceNote(e.target.value)} maxLength={200} placeholder="예: 운전자 만 26세 이상, 특약" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} /></div>
        </div>
        <div className={`mt-3 grid gap-x-3 gap-y-3 sm:grid-cols-2 ${tab === "assign" ? "" : "hidden"}`} role="tabpanel">
          <div><label htmlFor="vh-driver" className="block text-sm font-bold">배차 회원 <span className="font-normal text-zinc-500">(사내 회원만)</span></label><select id="vh-driver" value={driverId} onChange={e => setDriverId(e.target.value)} className={`${inputCls.replace("py-3", "py-2.5")} mt-1`}><option value="">배차 안 함</option>{members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.roleLabel}</option>)}</select></div>
          <div className="sm:col-span-2"><label htmlFor="vh-memo" className="block text-sm font-bold">비고 <span className="font-normal text-zinc-500">(선택, 여러 줄 가능)</span></label><textarea id="vh-memo" value={memo} onChange={e => setMemo(e.target.value)} maxLength={1000} rows={4} placeholder={"예: 지난주 확인결과 금주 오일교체 예정\n당분간 5천키로로 교체 예정"} className={`${inputCls.replace("py-3", "py-2.5")} mt-1 resize-y leading-relaxed`} /></div>
        </div>
        <div className={`mt-3 ${tab === "photo" ? "" : "hidden"}`} role="tabpanel">
          <p className="text-sm text-zinc-500">지금 차량 상태를 사진으로 남겨요 (외관, 계기판 키로수 등). 새로 고른 사진은 「저장」을 누르면 올라가요. 한 번에 최대 4장.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {existing.map(p => (
              <span key={p.url} className="relative">
                <img src={p.url} alt={p.note || "올린 차량 사진"} className="h-24 w-20 rounded-xl bg-zinc-100 object-cover dark:bg-zinc-800" />
                <span className="absolute inset-x-0 bottom-0 rounded-b-xl bg-black/60 px-1 py-0.5 text-center text-[10px] font-semibold text-white">{new Date(p.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</span>
                <button type="button" aria-label="올린 사진 지우기" disabled={busy} onClick={() => void dropOld(p.url)} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-black/75 text-xs font-bold text-white disabled:opacity-50">✕</button>
              </span>
            ))}
            {fresh.map(p => (
              <span key={p.id} className="relative">
                <img src={p.url} alt="새로 고른 사진" className="h-24 w-20 rounded-xl bg-zinc-100 object-cover ring-2 ring-blue-500 dark:bg-zinc-800" />
                <button type="button" aria-label="사진 빼기" onClick={() => dropFresh(p.id)} className="absolute -right-1.5 -top-1.5 h-6 w-6 rounded-full bg-black/75 text-xs font-bold text-white">✕</button>
              </span>
            ))}
            {fresh.length < 4 && (
              <label className="flex h-24 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-blue-400 text-xs font-bold text-blue-700 dark:text-blue-300">
                <span className="text-2xl" aria-hidden>📷</span>사진 추가
                <input type="file" accept="image/*" multiple className="sr-only" onChange={e => { addFresh(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <label htmlFor="vh-pnote" className="mt-4 block text-sm font-bold">현재 상태 메모 <span className="font-normal text-zinc-500">(새 사진에 붙어요, 선택)</span></label>
          <input id="vh-pnote" value={pnote} onChange={e => setPnote(e.target.value)} maxLength={200} placeholder="예: 우측 문 긁힘, 계기판 85,000km" autoComplete="off" className={`${inputCls.replace("py-3", "py-2.5")} mt-1`} />
        </div>
        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        <div className="sticky -bottom-5 -mx-5 mt-4 flex gap-2 border-t border-black/10 bg-white px-5 pb-5 pt-3 dark:border-white/10 dark:bg-zinc-900">
          <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button disabled={busy || !name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}

// 적재 패키지 목록: 패키지를 고르면 이 차량에 한 번에 적재한다. 패키지 만들기·고치기·지우기도 여기서.
function PackageDialog({ v, packages, catalog, canEdit, busy, err, onClose, onApply, onNew, onEdit, onRemove, onDirect }: { v: Vehicle; packages: LoadPackage[]; catalog: CatalogLite[]; canEdit: boolean; busy: boolean; err: string; onClose: () => void; onApply: (p: LoadPackage) => void; onNew: () => void; onEdit: (p: LoadPackage) => void; onRemove: (p: LoadPackage) => void; onDirect: () => void }) {
  const byKey = new Map(catalog.map(p => [p.key, p]));
  const [del, setDel] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} wide>
      <h2 className="text-lg font-bold">{v.name} 적재 패키지</h2>
      <p className="mt-1 text-sm text-zinc-500">자주 싣는 연장·상비품 묶음이에요. 패키지를 고르면 한 번에 적재돼요. 연장은 창고 재고에서 빠지고, 상비품은 차량 수량으로만 세요.</p>
      <ul className="mt-3 space-y-2">
        {packages.length === 0 && <li className="rounded-xl bg-zinc-50 p-4 text-center text-sm text-zinc-500 dark:bg-zinc-800/60">만들어 둔 패키지가 없어요.{canEdit ? " 아래 「새 패키지 만들기」로 자주 싣는 세트를 만들어 보세요." : ""}</li>}
        {packages.map(p => {
          const tools = p.items.filter(i => byKey.get(i.key)?.kind === "연장").length;
          const supplies = p.items.length - tools;
          const names = p.items.map(i => `${byKey.get(i.key)?.name ?? "삭제된 품목"} ${i.qty}`);
          return (
            <li key={p.id} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="flex flex-wrap items-center gap-x-2">
                <b className="text-base">{p.name}</b>
                <span className="text-xs font-semibold text-zinc-500">연장 {tools}종 · 상비품 {supplies}종</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-300">{names.slice(0, 5).join(", ")}{names.length > 5 && ` 외 ${names.length - 5}종`}</p>
              {del === p.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-red-600">“{p.name}” 패키지를 지울까요? (이미 적재된 품목은 그대로예요)</span>
                  <button type="button" disabled={busy} onClick={() => setDel(null)} className="rounded-lg bg-zinc-100 px-3 py-1.5 font-bold dark:bg-zinc-800">취소</button>
                  <button type="button" disabled={busy} onClick={() => { onRemove(p); setDel(null); }} className="rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">지우기</button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {canEdit && <button type="button" onClick={() => onApply(p)} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-bold text-white">이 차량에 적재</button>}
                  {canEdit && <button type="button" onClick={() => onEdit(p)} className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-bold dark:border-white/15">수정</button>}
                  {canEdit && <button type="button" onClick={() => setDel(p.id)} className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {canEdit && <button type="button" onClick={onNew} className="rounded-xl border border-blue-600 px-4 py-2.5 text-sm font-bold text-blue-700 dark:text-blue-300">+ 새 패키지 만들기</button>}
        {canEdit && <button type="button" onClick={onDirect} className="rounded-xl border border-black/15 px-4 py-2.5 text-sm font-bold dark:border-white/15">품목 직접 적재</button>}
        <button type="button" onClick={onClose} className="ml-auto rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-bold dark:bg-zinc-800">닫기</button>
      </div>
    </Modal>
  );
}

// 패키지를 이 차량에 적재하기 전 확인: 창고 재고가 모자란 연장은 빼고 적재한다
function PackageApply({ v, p, catalog, busy, err, onClose, onBack, onSave }: { v: Vehicle; p: LoadPackage; catalog: CatalogLite[]; busy: boolean; err: string; onClose: () => void; onBack: () => void; onSave: (rows: { key: string; qty: number; note: string; name: string }[]) => void }) {
  const byKey = new Map(catalog.map(c => [c.key, c]));
  const rows = p.items.map(i => { const c = byKey.get(i.key); return { i, c, gone: !c || c.trashed, short: !!c && c.kind === "연장" && c.stock < i.qty }; });
  const ok = rows.filter(r => !r.gone && !r.short);
  return (
    <Modal open onClose={onClose} wide>
      <h2 className="text-lg font-bold">“{p.name}” 적재</h2>
      <p className="mt-1 text-sm text-zinc-500">{v.name}에 아래 품목을 적재해요. 창고 재고가 모자란 연장은 빼고 적재돼요.</p>
      <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
        {rows.map(r => (
          <li key={r.i.key} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-semibold">{r.c?.name ?? "삭제된 품목"}</span>
            <span className="shrink-0 text-xs text-zinc-500">{r.c?.kind === "연장" ? `재고 ${r.c.stock} · ` : ""}{r.i.qty}개</span>
            {r.gone ? <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-bold dark:bg-zinc-700">품목 없음</span> : r.short ? <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-300">재고 부족</span> : <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">적재</span>}
          </li>
        ))}
      </ul>
      {ok.length < rows.length && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{rows.length - ok.length}개 품목은 적재하지 않아요 (재고 부족·없는 품목).</p>}
      {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" disabled={busy} onClick={onBack} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">← 패키지 목록</button>
        <button type="button" disabled={busy || ok.length === 0} onClick={() => onSave(ok.map(r => ({ key: r.i.key, qty: r.i.qty, note: "", name: r.c!.name })))} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "적재 중…" : `${ok.length}개 품목 적재`}</button>
      </div>
    </Modal>
  );
}

function AssignForm({ v, catalog, busy, err, onClose, onSave, pkg }: { v: Vehicle; pkg?: { id: string | null; name: string; items: LoadPackageItem[]; onSavePkg: (name: string, items: LoadPackageItem[]) => void; onBack: () => void }; catalog: CatalogLite[]; busy: boolean; err: string; onClose: () => void; onSave: (rows: { key: string; qty: number; note: string; name: string }[]) => Promise<string[]> }) {
  const [kind, setKind] = useState<Kind>("연장");
  const [q, setQ] = useState("");
  // 고른 품목 (탭을 바꿔도 유지된다). 연장은 1개씩(메모 선택), 상비품은 수량
  const [sel, setSel] = useState<Map<string, { qty: string; note: string }>>(() => new Map((pkg?.items ?? []).map(i => [i.key, { qty: String(i.qty), note: "" }])));
  const [pname, setPname] = useState(pkg?.name ?? ""); // 패키지 이름 (패키지 만들기 모드)
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const list = catalog.filter(p => p.kind === kind && (!kw || `${p.name}${p.brand}`.replace(/\s+/g, "").toLowerCase().includes(kw)));
  const byKey = new Map(catalog.map(p => [p.key, p]));
  const rows = [...sel.entries()].flatMap(([key, x]) => { const p = byKey.get(key); return p ? [{ p, qty: Number(x.qty) || 0, note: x.note }] : []; });
  const over = pkg ? undefined : rows.find(r => r.p.kind === "연장" && r.qty > r.p.stock); // 연장은 창고 재고보다 많이 실을 수 없다
  const bad = rows.length === 0 || rows.some(r => r.qty < 1) || !!over || (!!pkg && !pname.trim());
  const counts = { 연장: rows.filter(r => r.p.kind === "연장").length, 상비품: rows.filter(r => r.p.kind !== "연장").length };
  const toggle = (p: CatalogLite) => setSel(prev => { const n = new Map(prev); if (n.has(p.key)) n.delete(p.key); else n.set(p.key, { qty: "1", note: "" }); return n; });
  const patch = (key: string, x: Partial<{ qty: string; note: string }>) => setSel(prev => { const n = new Map(prev); const cur = n.get(key); if (cur) n.set(key, { ...cur, ...x }); return n; });
  const allShown = list.filter(p => pkg || !(p.kind === "연장" && p.stock < 1));
  const allOn = allShown.length > 0 && allShown.every(p => sel.has(p.key));
  const toggleAll = () => setSel(prev => { const n = new Map(prev); if (allOn) allShown.forEach(p => n.delete(p.key)); else allShown.forEach(p => { if (!n.has(p.key)) n.set(p.key, { qty: "1", note: "" }); }); return n; });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || bad) return;
    if (pkg) return pkg.onSavePkg(pname, rows.map(r => ({ key: r.p.key, qty: r.qty })));
    const done = await onSave(rows.map(r => ({ key: r.p.key, qty: r.qty, note: r.note, name: r.p.name })));
    if (done.length) setSel(prev => { const n = new Map(prev); done.forEach(k => n.delete(k)); return n; }); // 이미 실린 것은 선택에서 뺀다 (다시 누르면 두 번 실리지 않게)
  }
  return (
    <Modal open onClose={onClose} wide>
      <form onSubmit={submit}>
        <h2 className="text-lg font-bold">{pkg ? (pkg.id ? "적재 패키지 수정" : "새 적재 패키지 만들기") : `${v.name} 품목 직접 적재`}</h2>
        {pkg && (
          <>
            <label htmlFor="pk-name" className="mt-3 block text-sm font-bold">패키지 이름</label>
            <input id="pk-name" autoFocus value={pname} onChange={e => setPname(e.target.value)} maxLength={30} placeholder="예: 기본 용접 세트, 타일 작업 세트" autoComplete="off" className={inputCls} />
          </>
        )}
        <p className="mt-1 text-sm text-zinc-500">여러 품목을 한 번에, 수량도 2개 이상 넣을 수 있어요. 연장은 실은 수량만큼 창고 재고에서 빠지고, 상비품은 차량 수량만 따로 세요(창고 재고는 그대로).</p>
        <div className="mt-3 flex gap-2">
          {(["연장", "상비품"] as const).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-xl border py-2.5 text-sm font-extrabold ${kind === k ? chipOn : chipOff}`}>{k}{counts[k] > 0 && <small className="ml-1.5 opacity-80">{counts[k]}개 선택</small>}</button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="품목 검색" className={inputCls + " !mt-0 flex-1"} />
          <button type="button" onClick={toggleAll} disabled={allShown.length === 0} className="shrink-0 rounded-xl border border-black/15 px-3 py-3 text-sm font-bold disabled:opacity-40 dark:border-white/15">{allOn ? "전체 해제" : "전체 선택"}</button>
        </div>
        <ul className="mt-2 max-h-[38vh] divide-y divide-black/5 overflow-y-auto rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
          {list.length === 0 && <li className="p-4 text-center text-sm text-zinc-500">품목이 없어요.</li>}
          {list.map(p => {
            const on = sel.get(p.key);
            const out = p.kind === "연장" && p.stock < 1;
            return (
              <li key={p.key} className={on ? "bg-blue-50 dark:bg-blue-500/15" : ""}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <button type="button" role="checkbox" aria-checked={!!on} disabled={out && !pkg} onClick={() => toggle(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-40">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm text-white ${on ? "border-blue-600 bg-blue-600" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"}`} aria-hidden>{on ? "✓" : ""}</span>
                    {p.image ? (
                      <img src={p.image} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain" />
                    ) : <span className="h-10 w-10 shrink-0 rounded-lg bg-zinc-100 dark:bg-zinc-800" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>
                    {p.kind === "연장" && <span className="shrink-0 text-xs text-zinc-500">창고 재고 {p.stock}</span>}
                  </button>
                  {on && (
                    <label className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">수량
                      <input aria-label={p.name + " 수량"} inputMode="numeric" value={on.qty} onChange={e => patch(p.key, { qty: e.target.value.replace(/\D/g, "").slice(0, 5) })} onFocus={e => e.target.select()} autoComplete="off" className="w-16 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-right text-sm font-bold text-zinc-900 outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100" />
                    </label>
                  )}
                  {on && p.kind === "연장" && !pkg && (
                    <input aria-label={p.name + " 구분 메모"} value={on.note} onChange={e => patch(p.key, { note: e.target.value })} maxLength={60} placeholder="메모(선택)" autoComplete="off" className="w-28 shrink-0 rounded-lg border border-black/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {over && <p className="mt-3 text-sm text-red-500" role="alert">“{over.p.name}”은 창고 재고({over.p.stock}개)보다 많이 실을 수 없어요.</p>}
        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={pkg ? pkg.onBack : onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">{pkg ? "← 패키지 목록" : "취소"}</button>
          <button disabled={busy || bad} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{pkg ? (busy ? "저장 중…" : rows.length > 0 ? `패키지 저장 (${rows.length}개 품목)` : "패키지 저장") : busy ? "싣는 중…" : rows.length > 0 ? `${rows.length}개 싣기` : "싣기"}</button>
        </div>
      </form>
    </Modal>
  );
}

function BackForm({ v, b, busy, err, onClose, onSave }: { v: Vehicle; b: Back; busy: boolean; err: string; onClose: () => void; onSave: (qty: number) => void }) {
  const [qty, setQty] = useState(String(b.item.qty));
  const n = Number(qty) || 0;
  const bad = n < 1 || n > b.item.qty;
  return (
    <Modal open onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (!busy && !bad) onSave(n); }}>
        <h2 className="text-lg font-bold">{b.name}</h2>
        <p className="mt-1 text-sm text-zinc-500">{v.nickname || v.name}에 {b.item.qty}개 있어요{b.item.note ? ` (${b.item.note})` : ""}.</p>
        {b.item.qty > 1 && (
          <>
            <label htmlFor="bk-qty" className="mt-4 block text-sm font-bold">수량</label>
            <input id="bk-qty" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, "").slice(0, 5))} onFocus={e => e.target.select()} autoComplete="off" className={inputCls} />
          </>
        )}
        <p className="mt-3 text-xs text-zinc-500">{b.kind === "연장" ? "내리면 창고 재고로 돌아가요." : "차량에서만 빠지고, 창고 재고는 바뀌지 않아요."}</p>
        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button disabled={busy || bad} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "차량에서 빼기"}</button>
        </div>
      </form>
    </Modal>
  );
}
