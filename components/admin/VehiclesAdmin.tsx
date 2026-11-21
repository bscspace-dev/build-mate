"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Sheet";
import { VEHICLE_ICONS, type Kind, type Vehicle, type VehicleItem } from "@/lib/types";

export type MemberLite = { id: string; name: string; roleLabel: string };
export type CatalogLite = { key: string; name: string; kind: Kind; stock: number; image: string; brand: string; trashed: boolean };

const inputCls = "mt-1.5 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const chipOn = "border-blue-600 bg-blue-600 text-white";
const chipOff = "border-black/15 bg-white text-zinc-700 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-300";

type Back = { item: VehicleItem; name: string; kind: Kind };
type Dialog =
  | { t: "vehicle"; v: Vehicle | null }
  | { t: "assign"; v: Vehicle }
  | { t: "back"; v: Vehicle; b: Back }
  | { t: "remove"; v: Vehicle }
  | null;

// 차량운용: 차량마다 배치된 연장(개체별)과 나간 상비품(수량)을 보고, 배치·회수·소진을 기록한다.
// 연장은 차량에 배정하면 장비운용(창고) 재고에서 1개 빠지고, 내리면 재고로 돌아온다.
// 상비품은 차량에 실린 수량을 창고 재고와 따로 센다 (싣거나 빼도 창고 재고는 바뀌지 않는다).
export default function VehiclesAdmin({
  vehicles, items, members, catalog, canRegister, canEdit, canDelete,
}: {
  vehicles: Vehicle[]; items: VehicleItem[]; members: MemberLite[]; catalog: CatalogLite[]; canRegister: boolean; canEdit: boolean; canDelete: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"vehicle" | "item">("vehicle");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const prod = useMemo(() => new Map(catalog.map(p => [p.key, p])), [catalog]);
  const vLabel = (v: Vehicle) => v.nickname || v.name;
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
  const shown = vehicles.filter(v => !kw || norm(v.name).includes(kw) || norm(v.nickname).includes(kw) || norm(v.memo).includes(kw) || norm(driverOf(v)?.name ?? "").includes(kw) || (byVehicle.get(v.id) ?? []).some(i => norm(nameOf(i.key)).includes(kw) || norm(i.note).includes(kw)));

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

  async function call(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/admin/vehicles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.status === 401) { router.replace("/"); return false; }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
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
  const close = () => { if (!busy) { setDlg(null); setErr(""); } };
  const toggle = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">차량운용</h1>
        <span className="text-sm text-zinc-500">차량 {vehicles.length}대</span>
        {canRegister && <button type="button" onClick={() => { setErr(""); setDlg({ t: "vehicle", v: null }); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ 차량 등록</button>}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-xl border border-black/15 text-sm font-bold dark:border-white/15" role="group" aria-label="보기 방식">
          {([["vehicle", "차량별"], ["item", "품목별"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-4 py-2 ${view === v ? "bg-blue-600 text-white" : "bg-white dark:bg-zinc-900"}`}>{label}</button>
          ))}
        </div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="차량·품목 검색" className="min-w-[10rem] flex-1 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 sm:max-w-xs dark:border-white/15 dark:bg-zinc-900" />
      </div>

      {toast && <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" role="status">{toast}</p>}

      {view === "vehicle" ? (
        <div className="mt-4 space-y-3">
          {vehicles.length === 0 && <p className="rounded-2xl bg-white p-8 text-center text-zinc-500 dark:bg-zinc-900">등록된 차량이 없어요.{canRegister ? " 위의 “차량 등록”으로 먼저 차량을 추가해 주세요." : ""}</p>}
          {vehicles.length > 0 && shown.length === 0 && <p className="p-8 text-center text-zinc-500">검색 결과가 없어요.</p>}
          {shown.map(v => {
            const list = byVehicle.get(v.id) ?? [];
            const tools = list.filter(i => kindOf(i.key) === "연장");
            const supplies = list.filter(i => kindOf(i.key) !== "연장");
            const out = supplies.reduce((n, i) => n + i.qty, 0);
            const isOpen = open.has(v.id) || (kw !== "" && list.length > 0);
            return (
              <section key={v.id} className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
                <button type="button" onClick={() => toggle(v.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-4 text-left">
                  <span className="text-2xl" aria-hidden>{v.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-extrabold">{vLabel(v)}{v.nickname && <span className="ml-2 text-xs font-semibold text-zinc-500">{v.name}</span>}</span>
                    <span className={`mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-bold ${driverOf(v) ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>{driverOf(v) ? `👤 ${driverOf(v)!.name} · ${driverOf(v)!.roleLabel}` : "배차 안 됨"}</span>
                    {v.memo && <span className="block truncate text-xs text-zinc-500">{v.memo}</span>}
                  </span>
                  <span className="shrink-0 text-right text-xs font-semibold leading-5">
                    <span className="block text-blue-700 dark:text-blue-300">연장 {tools.reduce((n, i) => n + i.qty, 0)}개</span>
                    <span className="block text-amber-700 dark:text-amber-300">상비품 {supplies.length}종 · {out}개</span>
                  </span>
                  <span className="text-zinc-400" aria-hidden>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-black/10 px-4 pb-4 dark:border-white/10">
                    <div className="flex flex-wrap gap-2 py-3">
                      {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "assign", v }); }} className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-bold text-white">+ 연장·상비품 싣기</button>}
                      {canEdit && <button type="button" onClick={() => { setErr(""); setDlg({ t: "vehicle", v }); }} className="rounded-xl border border-black/15 px-3.5 py-2 text-sm font-bold dark:border-white/15">차량 정보 수정</button>}
                      {canDelete && <button type="button" onClick={() => { setErr(""); setDlg({ t: "remove", v }); }} className="rounded-xl bg-red-50 px-3.5 py-2 text-sm font-bold text-red-600 dark:bg-red-500/15 dark:text-red-300">차량 삭제</button>}
                    </div>
                    <Group title="연장" tone="tool" rows={tools} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v, b }); }} />
                    <Group title="상비품" tone="supply" rows={supplies} nameOf={nameOf} prod={prod} canEdit={canEdit} onBack={b => { setErr(""); setDlg({ t: "back", v, b }); }} />
                  </div>
                )}
              </section>
            );
          })}
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

      {dlg?.t === "vehicle" && <VehicleForm key={dlg.v?.id ?? "new"} v={dlg.v} members={members} busy={busy} err={err} onClose={close} onSave={(name, nickname, icon, memo, driverId) => call(dlg.v ? { action: "update", id: dlg.v.id, name, nickname, icon, memo, driverId } : { action: "add", name, nickname, icon, memo, driverId }, dlg.v ? "차량 정보를 수정했어요" : "차량을 등록했어요").then(ok => { if (ok) setDlg(null); })} />}
      {dlg?.t === "assign" && <AssignForm key={dlg.v.id} v={dlg.v} catalog={catalog.filter(p => !p.trashed)} busy={busy} err={err} onClose={close} onSave={rows => assignMany(dlg.v, rows)} />}
      {dlg?.t === "back" && <BackForm key={dlg.b.item.id} v={dlg.v} b={dlg.b} busy={busy} err={err} onClose={close} onSave={qty => call({ action: "return", id: dlg.b.item.id, qty }, dlg.b.kind === "연장" ? `${dlg.b.name}을(를) 차량에서 내려 창고 재고로 돌렸어요` : `${dlg.b.name} ${qty}개를 차량에서 뺐어요`).then(ok => { if (ok) setDlg(null); })} />}
      <Modal open={dlg?.t === "remove"} onClose={close}>
        {dlg?.t === "remove" && (
          <div>
            <h2 className="text-lg font-bold">“{vLabel(dlg.v)}” 차량을 삭제할까요?</h2>
            <p className="mt-1 text-sm text-zinc-500">배치된 연장·상비품이 남아 있으면 삭제되지 않아요. 먼저 회수해 주세요.</p>
            {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={close} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={() => void call({ action: "remove", id: dlg.v.id }, "차량을 삭제했어요").then(ok => { if (ok) setDlg(null); })} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "삭제 중…" : "삭제"}</button>
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
                    // eslint-disable-next-line @next/next/no-img-element
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

function VehicleForm({ v, members, busy, err, onClose, onSave }: { v: Vehicle | null; members: MemberLite[]; busy: boolean; err: string; onClose: () => void; onSave: (name: string, nickname: string, icon: string, memo: string, driverId: string) => void }) {
  const [driverId, setDriverId] = useState(v && members.some(m => m.id === v.driverId) ? v.driverId : "");
  const [icon, setIcon] = useState(v?.icon ?? VEHICLE_ICONS[0]);
  const [name, setName] = useState(v?.name ?? "");
  const [nickname, setNickname] = useState(v?.nickname ?? "");
  const [memo, setMemo] = useState(v?.memo ?? "");
  return (
    <Modal open onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); if (!busy) onSave(name, nickname, icon, memo, driverId); }}>
        <h2 className="text-lg font-bold">{v ? "차량 정보 수정" : "차량 등록"}</h2>
        <div className="mt-4 text-sm font-bold">아이콘</div>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="차량 아이콘">
          {VEHICLE_ICONS.map(ic => (
            <button key={ic} type="button" role="radio" aria-checked={icon === ic} onClick={() => setIcon(ic)} className={`h-12 w-12 rounded-xl border text-2xl ${icon === ic ? "border-blue-600 bg-blue-50 ring-2 ring-blue-600 dark:bg-blue-500/20" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>{ic}</button>
          ))}
        </div>

        <label htmlFor="vh-name" className="mt-4 block text-sm font-bold">차량 번호</label>
        <input id="vh-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="예: 12가3456" autoComplete="off" className={inputCls} />
        <label htmlFor="vh-nick" className="mt-4 block text-sm font-bold">별칭 <span className="font-normal text-zinc-500">(선택)</span></label>
        <input id="vh-nick" value={nickname} onChange={e => setNickname(e.target.value)} maxLength={20} placeholder="예: 1호차" autoComplete="off" className={inputCls} />
        <label htmlFor="vh-driver" className="mt-4 block text-sm font-bold">배차 회원 <span className="font-normal text-zinc-500">(사내 회원만, 선택)</span></label>
        <select id="vh-driver" value={driverId} onChange={e => setDriverId(e.target.value)} className={inputCls}>
          <option value="">배차 안 함</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.roleLabel}</option>)}
        </select>
        <label htmlFor="vh-memo" className="mt-4 block text-sm font-bold">메모 <span className="font-normal text-zinc-500">(선택)</span></label>
        <input id="vh-memo" value={memo} onChange={e => setMemo(e.target.value)} maxLength={200} placeholder="예: 담당 반장, 용도" autoComplete="off" className={inputCls} />
        {err && <p className="mt-3 text-sm text-red-500" role="alert">{err}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button disabled={busy || !name.trim()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignForm({ v, catalog, busy, err, onClose, onSave }: { v: Vehicle; catalog: CatalogLite[]; busy: boolean; err: string; onClose: () => void; onSave: (rows: { key: string; qty: number; note: string; name: string }[]) => Promise<string[]> }) {
  const [kind, setKind] = useState<Kind>("연장");
  const [q, setQ] = useState("");
  // 고른 품목 (탭을 바꿔도 유지된다). 연장은 1개씩(메모 선택), 상비품은 수량
  const [sel, setSel] = useState<Map<string, { qty: string; note: string }>>(new Map());
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const list = catalog.filter(p => p.kind === kind && (!kw || `${p.name}${p.brand}`.replace(/\s+/g, "").toLowerCase().includes(kw)));
  const byKey = new Map(catalog.map(p => [p.key, p]));
  const rows = [...sel.entries()].flatMap(([key, x]) => { const p = byKey.get(key); return p ? [{ p, qty: Number(x.qty) || 0, note: x.note }] : []; });
  const over = rows.find(r => r.p.kind === "연장" && r.qty > r.p.stock); // 연장은 창고 재고보다 많이 실을 수 없다
  const bad = rows.length === 0 || rows.some(r => r.qty < 1) || !!over;
  const counts = { 연장: rows.filter(r => r.p.kind === "연장").length, 상비품: rows.filter(r => r.p.kind !== "연장").length };
  const toggle = (p: CatalogLite) => setSel(prev => { const n = new Map(prev); if (n.has(p.key)) n.delete(p.key); else n.set(p.key, { qty: "1", note: "" }); return n; });
  const patch = (key: string, x: Partial<{ qty: string; note: string }>) => setSel(prev => { const n = new Map(prev); const cur = n.get(key); if (cur) n.set(key, { ...cur, ...x }); return n; });
  const allShown = list.filter(p => !(p.kind === "연장" && p.stock < 1));
  const allOn = allShown.length > 0 && allShown.every(p => sel.has(p.key));
  const toggleAll = () => setSel(prev => { const n = new Map(prev); if (allOn) allShown.forEach(p => n.delete(p.key)); else allShown.forEach(p => { if (!n.has(p.key)) n.set(p.key, { qty: "1", note: "" }); }); return n; });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || bad) return;
    const done = await onSave(rows.map(r => ({ key: r.p.key, qty: r.qty, note: r.note, name: r.p.name })));
    if (done.length) setSel(prev => { const n = new Map(prev); done.forEach(k => n.delete(k)); return n; }); // 이미 실린 것은 선택에서 뺀다 (다시 누르면 두 번 실리지 않게)
  }
  return (
    <Modal open onClose={onClose} wide>
      <form onSubmit={submit}>
        <h2 className="text-lg font-bold">{v.nickname || v.name}에 싣기</h2>
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
                  <button type="button" role="checkbox" aria-checked={!!on} disabled={out} onClick={() => toggle(p)} className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-40">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm text-white ${on ? "border-blue-600 bg-blue-600" : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"}`} aria-hidden>{on ? "✓" : ""}</span>
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
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
                  {on && p.kind === "연장" && (
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
          <button type="button" disabled={busy} onClick={onClose} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button disabled={busy || bad} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "싣는 중…" : rows.length > 0 ? `${rows.length}개 싣기` : "싣기"}</button>
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
