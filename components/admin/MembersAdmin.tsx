"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { PublicMember } from "@/lib/types";
import {
  effectivePay, memberRoles, PAY_TYPES, payTypeLabel, teamsLabel, menuActionLabel, canSurvey, effectiveMenus, groupLabel, groupsIn, MENU_ACTIONS, MENUS, menuLabel, roleMenus, SIDES, sideLabel, sideOf, teamGroup, teamLabel, teamsIn,
  type ActionKey, type GrantedActions, type GroupKey, type MenuKey, type RoleKey, type SideKey, type Team,
} from "@/lib/roles";
import { Modal } from "@/components/Sheet";

const MAX_TRADES = 3;
const MAX_CATS = 3;
const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";
const inputCls = "mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const tagCls = "rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

type Creds = { loginId: string; password: string };
type ApiResult = { ok: boolean; member?: PublicMember; credentials?: Creds | null; annual?: { total: number | null; used: number }; error?: string };
type Issued = { name: string; kind: "new" | "reset"; creds: Creds };

export default function MembersAdmin({
  scope, leaveYear, leaveBalances, initialMembers, initialTeams, canManageTeams, trades, categoryTrades, submissions, selfId, builtinId,
}: {
  scope: SideKey; // inhouse = 사내 회원 관리, coop = 거래처 관리 — 두 화면은 따로 관리한다
  leaveYear?: number; // 연차 기준 연도 (올해)
  leaveBalances?: Record<string, { total: number | null; used: number }>; // 회원별 올해 연차 총 일수·사용 일수
  initialMembers: PublicMember[];
  initialTeams: Team[];
  canManageTeams: boolean; // 팀명 추가·삭제 권한 (회원 관리의 등록·삭제 권한)
  trades: string[];
  categoryTrades: Record<string, string>; // 카테고리 → 속한 공정 (공정 아래 카테고리를 고르는 데 쓴다)
  submissions: Record<string, Record<string, string>>;
  selfId: string | null; // 지금 로그인한 회원(내장 최고 관리자면 null)
  builtinId: string; // 내장 최고 관리자 아이디
}) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [balances, setBalances] = useState(leaveBalances ?? {});
  const [annualRemain, setAnnualRemain] = useState(""); // 연차 잔여 (4대보험 사무직 기준 회원만, 비우면 미설정)
  const [teams, setTeams] = useState(initialTeams);
  const [name, setName] = useState("");
  const defaultRole: RoleKey = scope === "coop" ? (teamsIn(initialTeams, "outsource")[0]?.key ?? "partner") : "worker";
  const [role, setRole] = useState<RoleKey>(defaultRole);
  const [extraRole, setExtraRole] = useState<RoleKey | "">(""); // 겸직 팀 (사무실 팀 + 현장 팀)
  const [payType, setPayType] = useState<"" | "daily" | "office">(""); // 급여 기준 ("" = 주 팀에 따라 자동)
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedCats, setPickedCats] = useState<string[]>([]);
  const [menus, setMenus] = useState<MenuKey[]>([]); // 팀 기본 메뉴 외에 더 부여하는 메뉴
  const [actions, setActions] = useState<GrantedActions>({}); // 부여하는 메뉴마다 허용할 동작(등록/수정/삭제)
  const [handles, setHandles] = useState(""); // 거래처 취급품목
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [loginId, setLoginId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [side, setSide] = useState<SideKey | "all">(scope); // 이 화면의 구분(사내 또는 거래처)으로 고정
  const [group, setGroup] = useState<GroupKey | "all">(scope === "coop" ? "outsource" : "all"); // 사무실 / 현장 / 외주
  const [filter, setFilter] = useState<RoleKey | "all">("all"); // 팀명
  const [q, setQ] = useState(""); // 이름 검색
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<PublicMember | null>(null);
  const [confirmReset, setConfirmReset] = useState<PublicMember | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  // 팀 관리
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false); // 회원 생성은 항상 닫힌 채로 시작
  const [listOpen, setListOpen] = useState(true);
  const [newTeam, setNewTeam] = useState<Partial<Record<GroupKey, string>>>({});
  const [teamErr, setTeamErr] = useState<{ group: GroupKey; text: string } | null>(null);
  const [confirmTeamDel, setConfirmTeamDel] = useState<Team | null>(null);
  const [teamDelErr, setTeamDelErr] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastId ? null : cur)), 3500);
    return () => window.clearTimeout(t);
  }, [toastId]);

  const say = (text: string) => setToast({ id: Date.now(), text });
  const editingSelf = editId !== null && editId === selfId;
  const needTrades = canSurvey([role, ...(extraRole ? [extraRole] : [])], menus); // 설문에 참여하는 회원만 공정을 갖는다
  const full = picked.length >= MAX_TRADES;

  const inScope = (m: PublicMember) => {
    const g = teamGroup(teams, m.role);
    return g !== null && sideOf(g) === scope;
  };
  const scoped = members.filter(inScope);
  const noun = scope === "coop" ? "거래처" : "회원";
  const sidesShown = SIDES.filter(sd => sd.key === scope);
  const counts = useMemo(() => {
    const m = new Map<RoleKey, number>();
    members.forEach(x => m.set(x.role, (m.get(x.role) ?? 0) + 1));
    return m;
  }, [members]);
  const groupOf = (m: PublicMember): GroupKey | null => teamGroup(teams, m.role);
  const groupCount = (g: GroupKey) => scoped.filter(m => groupOf(m) === g).length;
  const sideCount = (s: SideKey) => groupsIn(s).reduce((n, g) => n + groupCount(g.key), 0);
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const shown = scoped.filter(m => {
    const g = groupOf(m);
    return (
      (!kw || m.name.replace(/\s+/g, "").toLowerCase().includes(kw)) &&
      (side === "all" || (g !== null && sideOf(g) === side)) &&
      (group === "all" || g === group) &&
      (filter === "all" || m.role === filter)
    );
  });
  const pickSide = (s: SideKey | "all") => {
    setSide(s);
    setGroup("all");
    setFilter("all");
  };
  const pickGroup = (g: GroupKey | "all") => {
    setGroup(g);
    setFilter("all");
  };

  function toggleTrade(t: string) {
    setPicked(p => (p.includes(t) ? p.filter(x => x !== t) : p.length >= MAX_TRADES ? p : [...p, t]));
    setPickedCats(cs => cs.filter(c => categoryTrades[c] !== t || !picked.includes(t))); // 공정을 빼면 그 공정의 카테고리도 뺀다
  }
  const catsOfTrade = (p: string[], t: string) => p.filter(c => categoryTrades[c] === t).length;
  function toggleCat(c: string) {
    setPickedCats(p => (p.includes(c) ? p.filter(x => x !== c) : catsOfTrade(p, categoryTrades[c]) >= MAX_CATS ? p : [...p, c]));
  }
  // 팀 선택: 사무실 팀 하나 + 현장 팀 하나까지 함께 고를 수 있다 (둘 다 선택 표시됨).
  //  · 이미 고른 팀을 다시 누르면 뺀다 (하나는 남아야 한다)
  //  · 같은 부서의 다른 팀을 누르면 그 부서의 선택이 바뀐다
  //  · 거래처 쪽 팀은 단독으로만 고른다
  function applyTeams(nr: RoleKey, ne: RoleKey | "") {
    setRole(nr);
    setExtraRole(ne);
    const both = [nr, ...(ne ? [ne] : [])];
    setMenus(p => p.filter(k => !roleMenus(both).includes(k))); // 새 팀의 기본 메뉴와 겹치는 부여는 뺀다
    setActions(p => Object.fromEntries(Object.entries(p).filter(([k]) => !roleMenus(both).includes(k as MenuKey))));
  }
  function toggleTeam(key: RoleKey) {
    const picked = [role, ...(extraRole ? [extraRole] : [])];
    const dual = (x: RoleKey) => { const g = teamGroup(teams, x); return g === "office" || g === "field"; };
    if (picked.includes(key)) {
      if (picked.length === 1) return;
      return applyTeams(picked.find(x => x !== key)!, "");
    }
    if (!dual(key) || !dual(role)) return applyTeams(key, "");
    const g = teamGroup(teams, key);
    if (teamGroup(teams, role) === g) return applyTeams(key, extraRole); // 주 팀과 같은 부서: 주 팀을 바꾼다
    return applyTeams(role, key); // 반대 부서: 겸직 팀으로 함께 선택 (이미 겸직이 있으면 바뀐다)
  }
  function toggleMenu(k: MenuKey) {
    const on = menus.includes(k);
    setMenus(p => (on ? p.filter(x => x !== k) : [...p, k]));
    setActions(p => {
      const { [k]: _removed, ...rest } = p; // 메뉴를 회수하면 그 메뉴의 동작 권한도 같이 사라진다
      void _removed;
      return on || MENU_ACTIONS[k].length === 0 ? rest : { ...rest, [k]: ["view"] }; // 새로 부여하면 '보기'가 기본으로 골라진다
    });
  }
  function toggleAction(menu: MenuKey, a: ActionKey) {
    setActions(p => {
      const cur = p[menu] ?? [];
      if (cur.includes(a)) return { ...p, [menu]: a === "view" ? [] : cur.filter(x => x !== a) }; // 보기를 끄면 등록·수정·삭제도 같이 꺼진다
      return { ...p, [menu]: a === "view" ? [...cur, a] : [...new Set<ActionKey>([...cur, "view", a])] }; // 등록·수정·삭제를 켜면 보기도 같이 켜진다
    });
  }
  function resetForm() {
    setName("");
    setHandles("");
    setPhone("");
    setAddress("");
    setRole(defaultRole);
    setAnnualRemain("");
    setExtraRole("");
    setPayType("");
    setMenus([]);
    setActions({});
    setPicked([]);
    setPickedCats([]);
    setLoginId("");
    setEditId(null);
    setErr("");
  }

  async function call(body: object): Promise<ApiResult> {
    const r = await fetch("/api/admin/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) {
      router.replace("/");
      return { ok: false, error: "권한이 없어요." };
    }
    const j = (await r.json().catch(() => ({}))) as ApiResult;
    return r.ok ? { ...j, ok: true } : { ok: false, error: j.error ?? "요청에 실패했어요." };
  }

  async function callTeams(body: object): Promise<{ ok: boolean; team?: Team; error?: string }> {
    const r = await fetch("/api/admin/teams", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.status === 401) {
      router.replace("/");
      return { ok: false, error: "권한이 없어요." };
    }
    const j = (await r.json().catch(() => ({}))) as { team?: Team; error?: string };
    return r.ok ? { ok: true, team: j.team } : { ok: false, error: j.error ?? "요청에 실패했어요." };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setErr("이름을 적어 주세요.");
    if (needTrades && picked.length < 1) return setErr("자재 요청을 하는 회원은 공정을 1개 이상 골라 주세요.");
    setBusy(true);
    setErr("");
    try {
      const tradesToSend = needTrades ? picked : [];
      const catsToSend = needTrades ? pickedCats.filter(c => picked.includes(categoryTrades[c])) : [];
      const officePay = scope !== "coop" && effectivePay(teams, { role, payType }) === "office";
      const annualRemainToSend = officePay ? (annualRemain.trim() === "" ? null : Number(annualRemain)) : undefined; // 사무직 기준이 아니면 보내지 않는다
      const r = await call(
        editId
          ? { action: "update", id: editId, name, role, extraRole, payType, annualRemain: annualRemainToSend, menus, actions, trades: tradesToSend, categories: catsToSend, handles, phone, address, loginId: loginId || undefined }
          : { action: "add", name, role, extraRole, payType, annualRemain: annualRemainToSend, menus, actions, trades: tradesToSend, categories: catsToSend, handles, phone, address, loginId: loginId || undefined, account: scope !== "coop" },
      );
      if (r.ok && r.member) {
        const m = r.member;
        setMembers(prev => (editId ? prev.map(x => (x.id === m.id ? m : x)) : [...prev, m]));
        if (r.annual) setBalances(prev => ({ ...prev, [m.id]: r.annual! })); // 저장한 연차 잔여를 바로 반영
        if (!editId && r.credentials) setIssued({ name: m.name, kind: "new", creds: r.credentials });
        else say(editId ? "수정했어요" : "등록했어요");
        resetForm();
      } else if (r.error) setErr(r.error);
    } catch {
      setErr("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  function startEdit(m: PublicMember) {
    setEditId(m.id);
    setName(m.name);
    setRole(m.role);
    { const b = balances[m.id]; setAnnualRemain(b && b.total !== null ? String(b.total - b.used) : ""); } // 연차 잔여 = 총 일수 - 이미 쓴 일수
    setExtraRole(m.extraRole ?? "");
    setPayType(m.payType ?? "");
    setMenus(m.menus);
    setActions(Object.fromEntries(m.menus.filter(k => MENU_ACTIONS[k].length > 0).map(k => [k, m.actions?.[k] ?? ["view"]])) as GrantedActions); // 예전 부여(동작 미지정)는 보기만으로 보여 준다
    setPicked(m.trades);
    setPickedCats(m.categories ?? []);
    setHandles(m.handles ?? "");
    setPhone(m.phone ?? "");
    setAddress(m.address ?? "");
    setLoginId(m.loginId ?? "");
    setErr("");
  }

  async function doReset() {
    if (!confirmReset) return;
    const m0 = confirmReset;
    setBusy(true);
    try {
      const r = await call({ action: "reset", id: m0.id });
      if (r.ok && r.member && r.credentials) {
        setMembers(prev => prev.map(x => (x.id === m0.id ? r.member! : x)));
        setIssued({ name: m0.name, kind: m0.loginId ? "reset" : "new", creds: r.credentials });
        setConfirmReset(null);
      } else say(r.error ?? "처리하지 못했어요.");
    } catch {
      say("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      const r = await call({ action: "delete", id: confirmDel.id });
      if (r.ok) {
        setMembers(prev => prev.filter(x => x.id !== confirmDel.id));
        if (editId === confirmDel.id) resetForm();
        say(`${confirmDel.name}님을 삭제했어요`);
        setConfirmDel(null);
      } else say(r.error ?? "삭제하지 못했어요.");
    } catch {
      say("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  async function addTeam(g: GroupKey, e: React.FormEvent) {
    e.preventDefault();
    const label = (newTeam[g] ?? "").trim();
    if (!label || busy) return;
    setBusy(true);
    setTeamErr(null);
    try {
      const r = await callTeams({ action: "add", label, group: g });
      if (r.ok && r.team) {
        setTeams(prev => [...prev, r.team!]);
        setNewTeam(p => ({ ...p, [g]: "" }));
        say(`“${r.team.label}” 팀을 추가했어요`);
      } else setTeamErr({ group: g, text: r.error ?? "추가하지 못했어요." });
    } catch {
      setTeamErr({ group: g, text: "서버에 연결할 수 없어요." });
    }
    setBusy(false);
  }

  async function doDeleteTeam() {
    if (!confirmTeamDel) return;
    const t = confirmTeamDel;
    setBusy(true);
    setTeamDelErr("");
    try {
      const r = await callTeams({ action: "delete", key: t.key });
      if (r.ok) {
        setTeams(prev => prev.filter(x => x.key !== t.key));
        if (role === t.key) setRole(defaultRole);
        if (filter === t.key) setFilter("all");
        say(`“${t.label}” 팀을 삭제했어요`);
        setConfirmTeamDel(null);
      } else setTeamDelErr(r.error ?? "삭제하지 못했어요.");
    } catch {
      setTeamDelErr("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  async function copyIssued() {
    if (!issued) return;
    const text = `[빌드메이트]\n${issued.name}님\n주소: ${origin}/\n아이디: ${issued.creds.loginId}\n임시 비밀번호: ${issued.creds.password}\n(처음 로그인하면 새 비밀번호를 정하게 돼요)`;
    try {
      await navigator.clipboard.writeText(text);
      say("복사했어요. 카톡 등으로 전달해 주세요.");
    } catch {
      say("복사하지 못했어요. 화면의 아이디/비밀번호를 직접 적어 주세요.");
    }
  }

  const formEl = (
    <motion.form
      onSubmit={submit}
      layout
      className="pt-1"
    >
      {editId && <h2 className="text-lg font-bold">회원 수정</h2>}
      <p className="mt-1 text-sm text-zinc-500">
        {editId
          ? "이름·팀·공정·아이디를 바꿀 수 있어요. 최고 관리자·개발팀은 아이디를 횟수 제한 없이 바꿀 수 있어요."
          : scope === "coop"
            ? "이름과 팀만 있으면 등록돼요. 아이디는 필요할 때 목록에서 ‘아이디 생성’을 눌러 만들어요."
            : "만들면 아이디와 임시 비밀번호가 발급돼요. 회원은 처음 로그인할 때 새 비밀번호를 정해야 해요."}
      </p>

      <label htmlFor="mname" className="mt-4 block text-sm font-bold">이름</label>
      <input id="mname" value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder={scope === "coop" ? "예: 가나다 철물 (같은 이름이 있으면 구분)" : "예: 홍길동 (같은 이름이 있으면 홍길동A 처럼 구분)"} autoComplete="off" className={inputCls} />

      {scope === "coop" && (
        <>
          <label htmlFor="mhandles" className="mt-4 block text-sm font-bold">취급품목 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="mhandles" value={handles} onChange={e => setHandles(e.target.value)} maxLength={100} placeholder="예: 합판, 각재, 방부목" autoComplete="off" className={inputCls} />
          <label htmlFor="mphone" className="mt-4 block text-sm font-bold">연락처 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="mphone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={30} placeholder="예: 010-1234-5678" autoComplete="off" className={inputCls} />
          <label htmlFor="maddr" className="mt-4 block text-sm font-bold">주소 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="maddr" value={address} onChange={e => setAddress(e.target.value)} maxLength={200} placeholder="예: 경기도 ○○시 ○○로 12" autoComplete="off" className={inputCls} />
        </>
      )}

      <div className="mt-4 text-sm font-bold">팀 <span className="font-normal text-zinc-500">{scope === "coop" ? "· 거래처 팀(자유롭게 추가할 수 있어요)" : "· 사내(사무실·현장) — 사무실 팀과 현장 팀을 하나씩 함께 고를 수 있어요"}</span></div>
      <div className="mt-2 space-y-3" role="radiogroup" aria-label="팀">
        {sidesShown.map(sd => (
          <div key={sd.key} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="text-xs font-bold text-blue-600 dark:text-blue-300">{sd.label}</div>
            <div className="mt-2 space-y-2">
              {groupsIn(sd.key).map(g => (
                <div key={g.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-12 shrink-0 text-xs font-bold text-zinc-500">{g.label}</span>
                  {teamsIn(teams, g.key).length === 0 && <span className="text-xs text-zinc-400">팀이 없어요</span>}
                  {teamsIn(teams, g.key).map(t => {
                    const on = role === t.key || extraRole === t.key; // 사무실·현장 팀을 하나씩 함께 고를 수 있다
                    const locked = editingSelf && !on; // 내 팀은 스스로 바꿀 수 없다
                    return (
                      <motion.button
                        key={t.key}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        whileTap={locked ? undefined : { scale: 0.94 }}
                        disabled={locked}
                        onClick={() => toggleTeam(t.key)}
                        className={`${chipBase} px-4 py-2 text-[15px] ${on ? chipOn : chipOff} ${locked ? "opacity-35" : ""}`}
                      >
                        {t.label}
                      </motion.button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {editingSelf && <p className="mt-2 text-xs text-zinc-500">내 팀은 직접 바꿀 수 없어요.</p>}

      {scope !== "coop" && (() => {
        const eff = effectivePay(teams, { role, payType });
        return (
          <>
            <div className="mt-4">
              <div className="text-sm font-bold">급여 기준 <span className="font-normal text-zinc-500">· 일수로 계산할지, 4대보험 사무직 기준인지</span></div>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="급여 기준">
                <motion.button type="button" role="radio" aria-checked={payType === ""} whileTap={{ scale: 0.94 }} onClick={() => setPayType("")} className={`${chipBase} px-4 py-2 text-[15px] ${payType === "" ? chipOn : chipOff}`}>자동<small className="ml-1 opacity-80">· 주 팀 기준</small></motion.button>
                {PAY_TYPES.map(p => <motion.button key={p.v} type="button" role="radio" aria-checked={payType === p.v} whileTap={{ scale: 0.94 }} onClick={() => setPayType(p.v)} className={`${chipBase} px-4 py-2 text-[15px] ${payType === p.v ? chipOn : chipOff}`}>{p.label}</motion.button>)}
              </div>
              {eff === "office" && (
                <div className="mt-4 rounded-xl bg-violet-50 p-3 dark:bg-violet-500/10">
                  <label htmlFor="mannual" className="block text-sm font-bold">연차 잔여 <span className="font-normal text-zinc-500">· {leaveYear ?? new Date().getFullYear()}년 · 휴가를 쓸 때마다 자동으로 차감돼요</span></label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input id="mannual" inputMode="decimal" value={annualRemain} onChange={e => setAnnualRemain(e.target.value.replace(/[^\d.]/g, ""))} placeholder="미설정" autoComplete="off" className="w-28 rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-right text-lg font-extrabold outline-none focus:border-violet-500 dark:border-white/15 dark:bg-zinc-900" />
                    <span className="text-sm font-bold">일</span>
                    {editId && balances[editId] && (balances[editId].total !== null || balances[editId].used > 0) && <span className="text-xs text-zinc-500">총 {balances[editId].total ?? "—"}일 · 사용 {balances[editId].used}일</span>}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">남은 연차 일수를 적어 주세요(0.5 단위). 관리자가 휴가를 승인할 때마다 그만큼 줄어들어요. 비워 두면 연차 제한 없이 신청돼요. 잔여를 바꿔 저장하면 이미 쓴 일수는 그대로 두고 총 일수만 맞춰져요.</p>
                </div>
              )}
              <p className="mt-1.5 text-xs text-zinc-500">지금 적용: <b>{payTypeLabel(eff)}</b>{payType === "" && " (주 팀이 사무실이면 사무직 기준, 그 밖은 일수제)"} · 4대보험 사무직 기준은 휴가를 <b>연차에서 차감</b>하고, 일수제는 휴가 일수만 출근에서 제외해요.</p>
            </div>
          </>
        );
      })()}

      <div className="mt-4 text-sm font-bold">
        메뉴 부여 <span className="font-normal text-zinc-500">(선택) · 안 골라도 등록돼요. 팀 기본 메뉴는 항상 쓸 수 있어요</span>
      </div>
      {scope === "coop" && <p className="mt-1 text-xs text-zinc-500">거래처도 메뉴를 부여할 수 있어요. 로그인해서 쓰려면 목록에서 ‘아이디 생성’으로 아이디를 만들어야 해요.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {MENUS.map(mn => {
          const base = roleMenus(role).includes(mn.key);
          const granted = menus.includes(mn.key);
          const on = base || granted;
          const locked = base || !mn.grantable;
          return (
            <motion.button
              key={mn.key}
              type="button"
              whileTap={locked ? undefined : { scale: 0.94 }}
              disabled={locked}
              aria-pressed={on}
              onClick={() => toggleMenu(mn.key)}
              className={`${chipBase} px-4 py-2 text-[15px] ${on ? chipOn : chipOff} ${locked ? (on ? "opacity-70" : "opacity-40") : ""}`}
            >
              {mn.label}
              <small className="ml-1 opacity-80">{base ? "· 팀 기본" : !mn.grantable ? "· 최고 관리자·개발팀 전용" : granted ? "· 부여" : ""}</small>
            </motion.button>
          );
        })}
      </div>

      {/* 부여한 메뉴마다 허용할 동작 */}
      {menus
        .filter(k => MENU_ACTIONS[k].length > 0)
        .map(k => (
          <div key={k} className="mt-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
            <div className="text-xs font-bold text-zinc-500">
              {menuLabel(k)} · 허용할 동작 <span className="font-normal">(보기를 끄면 이 메뉴를 쓸 수 없어요)</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {MENU_ACTIONS[k].map(a => {
                const on = (actions[k] ?? []).includes(a);
                return (
                  <motion.button
                    key={a}
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    aria-pressed={on}
                    onClick={() => toggleAction(k, a)}
                    className={chipBase + " px-4 py-2 text-[15px] " + (on ? chipOn : chipOff)}
                  >
                    {menuActionLabel(k, a)}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      {(roleMenus(role).includes("catalog") || roleMenus(role).includes("members")) && (
        <p className="mt-2 text-xs text-zinc-500">이 팀은 소모품·회원 관리의 모든 동작(보기·등록·수정·삭제)이 기본으로 허용돼요.</p>
      )}

      <AnimatePresence initial={false}>
        {needTrades && (
          <motion.div key="trades" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-sm font-bold">공정</span>
              <span className={`text-xs ${full ? "font-semibold text-blue-600" : "text-zinc-500"}`}>{picked.length}/{MAX_TRADES}개 선택 (자재 요청을 하는 회원만)</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 pb-1">
              {trades.map(t => {
                const on = picked.includes(t);
                const locked = !on && full;
                return (
                  <motion.button
                    key={t}
                    type="button"
                    whileTap={locked ? undefined : { scale: 0.94 }}
                    onClick={() => toggleTrade(t)}
                    aria-pressed={on}
                    disabled={locked}
                    className={`${chipBase} px-4 py-2 text-[15px] ${on ? chipOn : chipOff} ${locked ? "opacity-35" : ""}`}
                  >
                    {t}
                  </motion.button>
                );
              })}
            </div>
            {picked.length > 0 && (
              <>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-sm font-bold">카테고리</span>
                  <span className="text-xs text-zinc-500">공정마다 최대 {MAX_CATS}개 · 안 고르면 공정 전체</span>
                </div>
                {picked.map(t => {
                  const cats = Object.keys(categoryTrades).filter(c => categoryTrades[c] === t);
                  if (!cats.length) return null;
                  return (
                    <div key={t} className="mt-2">
                      <div className="text-xs font-bold text-blue-600 dark:text-blue-300">{t} <small className={`font-normal ${catsOfTrade(pickedCats, t) >= MAX_CATS ? "font-semibold text-blue-600" : "text-zinc-500"}`}>{catsOfTrade(pickedCats, t)}/{MAX_CATS}개</small></div>
                      <div className="mt-1.5 flex flex-wrap gap-2 pb-1">
                        {cats.map(c => {
                          const on = pickedCats.includes(c);
                          const locked = !on && catsOfTrade(pickedCats, t) >= MAX_CATS;
                          return (
                            <motion.button key={c} type="button" whileTap={locked ? undefined : { scale: 0.94 }} onClick={() => toggleCat(c)} aria-pressed={on} disabled={locked} className={`${chipBase} px-3 py-1.5 text-sm ${on ? chipOn : chipOff} ${locked ? "opacity-35" : ""}`}>
                              {c}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {(scope !== "coop" || (editId && loginId)) && (<>
      <label htmlFor="mid" className="mt-4 block text-sm font-bold">
        아이디 <span className="font-normal text-zinc-500">{editId ? "(영문 소문자·숫자·_- 3~20자)" : "(비우면 자동 생성)"}</span>
      </label>
      <input id="mid" value={loginId} onChange={e => setLoginId(e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder={editId ? "" : "자동 생성"} className={inputCls} />
      </>)}

      <AnimatePresence>
        {err && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden text-sm text-red-500" role="alert">
            <span className="block pt-3">{err}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-5 flex gap-2">
        {editId && <button type="button" onClick={resetForm} className="rounded-xl bg-zinc-100 px-5 py-3 font-bold dark:bg-zinc-800">취소</button>}
        <motion.button whileTap={{ scale: 0.98 }} disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-50">
          {busy ? "처리 중…" : editId ? "저장" : "회원 생성 · 아이디/임시 비밀번호 발급"}
        </motion.button>
      </div>
    </motion.form>
  );

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">{scope === "coop" ? "거래처 관리" : "회원 관리"}</h1>
        <span className="text-sm text-zinc-500">총 {scoped.length}명</span>
      </header>

      {/* 회원 생성: 위아래로 열고 닫기 */}
      <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <button type="button" onClick={() => setCreateOpen(o => !o)} aria-expanded={createOpen} className="flex w-full items-center gap-2 text-left">
          <h2 className="mr-auto text-base font-bold">{noun} 생성</h2>
          <span className="text-zinc-400" aria-hidden>{createOpen ? "▴" : "▾"}</span>
        </button>
        <AnimatePresence initial={false}>
          {createOpen && !editId && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              {formEl}
            </motion.div>
          )}
        </AnimatePresence>
      </section>


      {/* 팀 관리: 구분(사내/거래처)·부서(사무실/현장/거래처)는 고정, 팀명만 추가·삭제 */}
      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <button type="button" onClick={() => setTeamsOpen(o => !o)} aria-expanded={teamsOpen} className="flex w-full items-center gap-2 text-left">
          <h2 className="mr-auto text-base font-bold">팀 관리</h2>
          <span className="text-sm text-zinc-500">팀 {teams.length}개</span>
          <span className="text-zinc-400" aria-hidden>{teamsOpen ? "▴" : "▾"}</span>
        </button>
        <AnimatePresence initial={false}>
          {teamsOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <p className="mt-2 text-sm text-zinc-500">
                {scope === "coop" ? "거래처 팀 이름은 자유롭게 정할 수 있어요. " : "구분(사내)과 부서(사무실·현장)는 고정이에요. "}{canManageTeams ? "팀명만 추가하거나 삭제할 수 있어요." : "팀명을 추가·삭제할 권한이 없어요."}
                기본 동작이 걸린 팀(<b>기본</b> 표시)과 소속 회원이 있는 팀은 지울 수 없어요.
              </p>
              <div className="mt-3 space-y-3">
                {sidesShown.map(sd => (
                  <div key={sd.key} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                    <div className="text-xs font-bold text-blue-600 dark:text-blue-300">{sd.label}</div>
                    <div className="mt-2 space-y-3">
                      {groupsIn(sd.key).map(g => (
                        <div key={g.key}>
                          <div className="text-xs font-bold text-zinc-500">{g.label}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {teamsIn(teams, g.key).map(t => (
                              <span key={t.key} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-zinc-50 py-1 pl-3 pr-2 text-sm dark:border-white/10 dark:bg-zinc-800/60">
                                {t.label}
                                <small className="text-zinc-500">{counts.get(t.key) ?? 0}명</small>
                                {t.locked ? (
                                  <small className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" title="기본 동작이 걸려 있어 지울 수 없어요">기본</small>
                                ) : (
                                  canManageTeams && (
                                    <button type="button" aria-label={`${t.label} 팀 삭제`} onClick={() => { setTeamDelErr(""); setConfirmTeamDel(t); }} className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/15">
                                      ✕
                                    </button>
                                  )
                                )}
                              </span>
                            ))}
                            {teamsIn(teams, g.key).length === 0 && <span className="text-xs text-zinc-400">팀이 없어요</span>}
                          </div>
                          {canManageTeams && (
                            <form onSubmit={e => addTeam(g.key, e)} className="mt-2 flex gap-2">
                              <input
                                value={newTeam[g.key] ?? ""}
                                onChange={e => setNewTeam(p => ({ ...p, [g.key]: e.target.value }))}
                                maxLength={20}
                                placeholder={`${g.label}에 추가할 팀 이름`}
                                aria-label={`${g.label}에 추가할 팀 이름`}
                                className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15"
                              />
                              <motion.button whileTap={{ scale: 0.96 }} disabled={busy || !(newTeam[g.key] ?? "").trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">+ 팀 추가</motion.button>
                            </form>
                          )}
                          {teamErr?.group === g.key && <p className="mt-1.5 text-sm text-red-500" role="alert">{teamErr.text}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <button type="button" onClick={() => setListOpen(o => !o)} aria-expanded={listOpen} className="mt-8 flex w-full items-center gap-2 text-left">
        <h2 className="mr-auto text-base font-bold">{noun} 목록</h2>
        <span className="text-sm text-zinc-500">{scoped.length}명</span>
        <span className="text-zinc-400" aria-hidden>{listOpen ? "▴" : "▾"}</span>
      </button>
      <AnimatePresence initial={false}>
      {listOpen && (
      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={scope === "coop" ? "거래처 이름으로 검색" : "회원 이름으로 검색"}
        aria-label="이름 검색"
        className="mt-3 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
      />
      {scope === "inhouse" && (
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" aria-label={`${sideLabel(scope)} 부서`}>
          <button type="button" onClick={() => pickGroup("all")} className={`${chipBase} text-[13px] ${group === "all" ? chipOn : chipOff}`}>{sideLabel(scope)} 전체<small className="ml-1 opacity-70">{sideCount(scope)}</small></button>
          {groupsIn(scope).map(g => (
            <button key={g.key} type="button" onClick={() => pickGroup(g.key)} className={`${chipBase} text-[13px] ${group === g.key ? chipOn : chipOff}`}>
              {g.label}<small className="ml-1 opacity-70">{groupCount(g.key)}</small>
            </button>
          ))}
        </div>
      )}
      {group !== "all" && (
        <div className={`no-scrollbar ${scope === "coop" ? "mt-3" : "mt-2"} flex gap-1.5 overflow-x-auto`} aria-label={`${groupLabel(group)} 팀`}>
          <button type="button" onClick={() => setFilter("all")} className={`${chipBase} text-[13px] ${filter === "all" ? chipOn : chipOff}`}>{groupLabel(group)} 전체<small className="ml-1 opacity-70">{groupCount(group)}</small></button>
          {teamsIn(teams, group).map(t => (
            <button key={t.key} type="button" onClick={() => setFilter(t.key)} className={`${chipBase} text-[13px] ${filter === t.key ? chipOn : chipOff}`}>
              {t.label}<small className="ml-1 opacity-70">{counts.get(t.key) ?? 0}</small>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-3">
        {builtinId && scope === "inhouse" && (!kw || "내장최고관리자".includes(kw) || builtinId.includes(kw)) && (group === "all" || group === "office") && (filter === "all" || filter === "super") && (
          <div className="rounded-2xl border border-dashed border-black/20 bg-white p-4 dark:border-white/20 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-base">내장 최고 관리자</b>
              <span className={tagCls}>사내 · 사무실</span>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">최고 관리자</span>
              <span className="ml-auto text-sm text-zinc-500">아이디 <code className="font-bold text-zinc-800 dark:text-zinc-100">{builtinId}</code></span>
            </div>
            <p className="mt-2 text-xs text-zinc-500">비상용 계정이에요. 아이디·비밀번호는 서버의 <code>.env.local</code> 에서만 바꿀 수 있어요.</p>
          </div>
        )}
        {shown.length === 0 && (kw || side !== "all" || group !== "all" || filter !== "all") && <p className="py-6 text-center text-sm text-zinc-500">해당하는 회원이 아직 없어요.</p>}
        {scope === "coop" && shown.length > 0 && (
          <div className="no-scrollbar overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
            <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-black/10 text-xs text-zinc-500 dark:border-white/10">
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">팀</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">이름</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">취급품목</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">연락처</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">주소</th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-bold">쓸 수 있는 메뉴</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map(m => {
                  const isMe = m.id === selfId;
                  return (
                    <tr key={m.id} className="border-b border-black/5 align-top last:border-0 dark:border-white/5">
                      <td className="whitespace-nowrap px-3 py-3"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{teamLabel(teams, m.role)}</span></td>
                      <td className="px-3 py-3 font-bold">{m.name}{m.loginId && <span className="mt-0.5 block text-[11px] font-normal text-zinc-500">아이디 {m.loginId}</span>}{m.mustChangePassword && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">임시 비밀번호</span>}</td>
                      <td className="px-3 py-3 text-zinc-700 dark:text-zinc-300">{m.handles || <span className="text-zinc-400">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-700 dark:text-zinc-300">{m.phone || <span className="text-zinc-400">—</span>}</td>
                      <td className="min-w-[10rem] px-3 py-3 text-zinc-700 dark:text-zinc-300">{m.address || <span className="text-zinc-400">—</span>}</td>
                      <td className="min-w-[9rem] px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {effectiveMenus(memberRoles(m), m.menus, m.actions).length === 0 && <span className="text-zinc-400">—</span>}
                          {effectiveMenus(memberRoles(m), m.menus, m.actions).map(k => (
                            <span key={k} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{menuLabel(k)}{MENU_ACTIONS[k].length ? " · " + ((m.actions?.[k] ?? ["view"]).map(a => menuActionLabel(k, a)).join("·") || "볼 수 없음") : ""}</span>
                          ))}
                          {m.menus.length > 0 && !m.loginId && <span className="w-full text-[10px] text-amber-600 dark:text-amber-300">아이디 생성 후 사용 가능</span>}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" onClick={() => startEdit(m)} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>
                          <button type="button" disabled={isMe} onClick={() => setConfirmReset(m)} title={m.loginId ? "임시 비밀번호 재발급" : "아이디와 임시 비밀번호 만들기"} className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 disabled:opacity-35 dark:bg-blue-500/15 dark:text-blue-300">{m.loginId ? "비번 재발급" : "아이디 생성"}</button>
                          <button type="button" disabled={isMe} onClick={() => setConfirmDel(m)} className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 disabled:opacity-35 dark:bg-red-500/15 dark:text-red-300">삭제</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <AnimatePresence initial={false}>
          {(scope === "coop" ? [] : shown).map(m => {
            const sub = submissions[m.id] ?? {};
            const isMe = m.id === selfId;
            const g = groupOf(m);
            return (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 360, damping: 32 }}
                className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-base">{m.name}</b>
                  {g && <span className={tagCls}>{sideLabel(sideOf(g))} · {groupLabel(g)}</span>}
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{teamsLabel(teams, m)}{canSurvey(memberRoles(m), m.menus) && m.trades.length > 0 && " - " + m.trades.map(t => t + "팀").join("/")}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${effectivePay(teams, m) === "office" ? "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`} title="급여 기준">{effectivePay(teams, m) === "office" ? "사무직 기준" : "일수제"}{m.payType === "" && <small className="ml-0.5 opacity-70">(자동)</small>}</span>
                  {isMe && <span className={tagCls}>나</span>}
                  {m.mustChangePassword && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">임시 비밀번호 (변경 전)</span>}
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" onClick={() => startEdit(m)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">수정</button>
                    <button type="button" disabled={isMe} onClick={() => setConfirmDel(m)} title={isMe ? "내 계정은 지울 수 없어요" : undefined} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-35 dark:bg-red-500/15 dark:text-red-300">삭제</button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {effectiveMenus(memberRoles(m), m.menus, m.actions).length === 0 && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800">쓸 수 있는 메뉴 없음</span>}
                  {effectiveMenus(memberRoles(m), m.menus, m.actions).map(k => (
                    <span key={k} className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-white/10 dark:text-zinc-300">
                      {menuLabel(k)}{m.menus.includes(k) ? " (부여" + (MENU_ACTIONS[k].length ? " · " + ((m.actions?.[k] ?? ["view"]).map(a => menuActionLabel(k, a)).join("·") || "볼 수 없음") : "") + ")" : ""}
                    </span>
                  ))}
                </div>

                {canSurvey(memberRoles(m), m.menus) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.trades.map(t => (
                      <span
                        key={t}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sub[t] ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
                      >
                        {t}
                      </span>
                    ))}
                    {(m.categories ?? []).length > 0 && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">카테고리 · {m.categories.join(", ")}</span>}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm dark:bg-zinc-800/60">
                  <span className="text-zinc-500">아이디</span>
                  <code className="font-bold">{m.loginId ?? "—"}</code>
                  {m.idChanged && <span className="text-xs text-zinc-500">· 본인 변경 1회 사용함</span>}
                  <button
                    type="button"
                    disabled={isMe}
                    onClick={() => setConfirmReset(m)}
                    title={isMe ? "내 비밀번호는 우측 상단 ‘비밀번호 변경’에서 바꿔요" : undefined}
                    className="ml-auto rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600 disabled:opacity-35 dark:bg-blue-500/15 dark:text-blue-300"
                  >
                    임시 비밀번호 재발급
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      </motion.div>
      )}
      </AnimatePresence>

      {/* 회원 수정: 팝업 */}
      <Modal open={editId !== null} onClose={() => !busy && resetForm()} wide>
        {editId !== null && formEl}
      </Modal>

      {/* 발급된 아이디/임시 비밀번호 — 비밀번호는 이때만 볼 수 있다 */}
      <Modal open={issued !== null} onClose={() => undefined}>
        {issued && (
          <>
            <h2 className="text-lg font-bold">{issued.kind === "new" ? "아이디/임시 비밀번호가 발급됐어요" : "임시 비밀번호를 새로 만들었어요"}</h2>
            <p className="mt-1 text-sm text-zinc-500">{issued.name}님께 아래 내용을 전달해 주세요.</p>
            <dl className="mt-4 space-y-2 rounded-xl bg-zinc-50 p-4 text-sm dark:bg-zinc-800/60">
              <div className="flex gap-3"><dt className="w-20 shrink-0 text-zinc-500">주소</dt><dd className="break-all font-semibold">{origin}/</dd></div>
              <div className="flex gap-3"><dt className="w-20 shrink-0 text-zinc-500">아이디</dt><dd><code className="text-base font-bold">{issued.creds.loginId}</code></dd></div>
              <div className="flex gap-3"><dt className="w-20 shrink-0 text-zinc-500">임시 비밀번호</dt><dd><code className="text-base font-bold">{issued.creds.password}</code></dd></div>
            </dl>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              임시 비밀번호는 지금만 볼 수 있어요. 창을 닫으면 다시 볼 수 없고, 필요하면 “임시 비밀번호 재발급”을 눌러야 해요. 회원은 처음 로그인할 때 새 비밀번호를 정하게 돼요.
            </p>
            <div className="mt-4 flex gap-2">
              <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={copyIssued} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">전체 복사</motion.button>
              <button type="button" onClick={() => setIssued(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">닫기</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmReset !== null} onClose={() => !busy && setConfirmReset(null)}>
        {confirmReset && (
          <>
            <h2 className="text-lg font-bold">{confirmReset.name}님의 {confirmReset.loginId ? "임시 비밀번호를 재발급" : "아이디와 임시 비밀번호를 생성"}할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">이전 비밀번호는 쓸 수 없게 되고, 이미 로그인해 둔 기기는 로그아웃돼요. 다음 로그인 때 새 비밀번호를 정하게 돼요.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmReset(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy} onClick={doReset} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : confirmReset.loginId ? "재발급" : "생성"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmDel !== null} onClose={() => !busy && setConfirmDel(null)}>
        {confirmDel && (
          <>
            <h2 className="text-lg font-bold">{confirmDel.name}님을 삭제할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">이 회원은 더 이상 로그인할 수 없게 돼요. 이미 보낸 자재 요청은 그대로 남아요.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmDel(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy} onClick={doDelete} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "삭제"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmTeamDel !== null} onClose={() => !busy && setConfirmTeamDel(null)}>
        {confirmTeamDel && (
          <>
            <h2 className="text-lg font-bold">“{confirmTeamDel.label}” 팀을 삭제할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {sideLabel(sideOf(confirmTeamDel.group))} · {groupLabel(confirmTeamDel.group)}의 팀이에요. 소속 회원이 없을 때만 삭제돼요.
            </p>
            {teamDelErr && <p className="mt-3 text-sm text-red-500" role="alert">{teamDelErr}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmTeamDel(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy} onClick={doDeleteTeam} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "삭제"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl dark:bg-zinc-100 dark:text-zinc-900"
            role="status"
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
