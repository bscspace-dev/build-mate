"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { PublicMember } from "@/lib/types";
import {
  effectivePay, isStaffAdmin, fieldRoleLabel, FIELD_ROLES, isFieldRole, memberHasGroup, OFFICE_STATUS, officeStatusLabel, memberRoles, PAY_TYPES, payTypeLabel, teamsLabel, menuActionLabel, canSurvey, effectiveMenus, groupLabel, groupsIn, MENU_ACTIONS, MENUS, menuLabel, menuParent, roleMenus, SIDES, sideLabel, sideOf, teamGroup, teamLabel, teamsIn,
  type ActionKey, type GrantedActions, type GroupKey, type MenuKey, type RoleKey, type SideKey, type Team,
} from "@/lib/roles";
import { Modal } from "@/components/Sheet";
import { formatPhone, netPay, payOn } from "@/lib/member-utils";
import { shrink } from "@/components/admin/AddProduct";

const MAX_TRADES = 3;
const MAX_CATS = 3;
const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";
const inputCls = "mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const tagCls = "rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

const FIELD_TAG: Record<string, string> = {
  pm: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
  worker: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  worker_sub: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
};
const POSITIONS = ["사원", "주임", "대리", "과장", "차장", "부장", "이사", "대표"]; // 직급 선택지
const BANKS = ["국민", "신한", "우리", "하나", "농협", "기업", "카카오뱅크", "토스뱅크", "케이뱅크", "우체국", "새마을금고", "SC제일", "부산", "대구", "광주", "전북", "제주", "기타"]; // 급여 계좌 은행 선택지
const LICENSES = ["1종 대형", "1종 보통", "1종 소형", "대형견인차", "구난차", "2종 보통", "2종 소형", "2종 원동기"]; // 자동차 운전면허 선택지
/** 근속 기간 문장: 입사일부터 (퇴사했다면 퇴사일까지) — "2년 3개월", "5개월", "입사 12일째" */
function tenure(hire: string, end?: string): string {
  if (!hire) return "";
  const a = new Date(hire + "T00:00:00");
  const b = end ? new Date(end + "T00:00:00") : new Date();
  if (Number.isNaN(a.getTime()) || b < a) return "";
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  if (months < 1) return `${Math.max(1, Math.floor((b.getTime() - a.getTime()) / 86400000) + 1)}일째`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}년${m ? ` ${m}개월` : ""}` : `${m}개월`;
}
type PostcodeData = { roadAddress: string; jibunAddress: string; userSelectedType: string; buildingName: string };
type DaumWindow = { daum?: { Postcode: new (o: { oncomplete: (d: PostcodeData) => void; width: string; height: string }) => { embed: (el: HTMLElement) => void } } };
/** 다음(카카오) 우편번호 서비스 — 도로명 주소 검색 (API 키 불필요). 처음 쓸 때만 스크립트를 불러온다. */
function loadPostcode(): Promise<void> {
  if ((window as unknown as DaumWindow).daum?.Postcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("주소 검색을 불러오지 못했어요."));
    document.head.appendChild(el);
  });
}
const fmtLeft = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1)); // 연차 일수 (0.5 단위)
/** 입사일부터 며칠째인지 (입사한 날 = 1일째). 퇴사했다면 퇴사일까지 근무한 일수 */
function workDays(hire: string, end?: string): number | null {
  if (!hire) return null;
  const a = new Date(hire + "T00:00:00");
  const t = end ? new Date(end + "T00:00:00") : new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) + "T00:00:00");
  if (Number.isNaN(a.getTime()) || t < a) return null;
  return Math.round((t.getTime() - a.getTime()) / 86400000) + 1;
}
const TPL_KEY = "bm-menu-templates";
type MenuTpl = { id: string; name: string; menus: MenuKey[]; actions: GrantedActions };
type Mode = "none" | "partial" | "all";
type SortKey = "name" | "team" | "position" | "loginId" | "phone" | "hire" | "created";
type Creds = { loginId: string; password: string };
type ApiResult = { ok: boolean; member?: PublicMember; credentials?: Creds | null; annual?: { total: number | null; used: number }; error?: string };
type Issued = { name: string; kind: "new" | "reset"; creds: Creds };

export default function MembersAdmin({
  scope, mode = "create", defaultDaily = 0, defaultMonthly = 0, nextPayFrom = "", currentPayFrom = "", leaveYear, leaveBalances, initialMembers, initialTeams, canManageTeams, trades, categoryTrades, submissions, selfId, builtinId,
}: {
  defaultDaily?: number; // 기본 일당(원): 일수제 회원을 새로 등록할 때 급여 칸에 미리 들어간다
  currentPayFrom?: string; // 이번 급여 기간의 시작일 (금액을 이번 기간부터 바로 적용할 때)
  nextPayFrom?: string; // 금액을 바꾸면 적용이 시작되는 날(다음 급여 기간 시작일)
  defaultMonthly?: number; // 기본 월급(원): 4대보험 사무직 기준 회원을 새로 등록할 때 급여 칸에 미리 들어간다
  mode?: "create" | "manage"; // create = 회원생성(만들기·권한 부여·생성일 확인), manage = 회원관리(급여·회원 정보)
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
  const manage = mode === "manage" && scope !== "coop";
  const [members, setMembers] = useState(initialMembers);
  const [balances, setBalances] = useState(leaveBalances ?? {});
  const [annualRemain, setAnnualRemain] = useState(""); // 연차 잔여 (4대보험 사무직 기준 회원만, 비우면 미설정)
  const [teams, setTeams] = useState(initialTeams);
  const [name, setName] = useState("");
  const defaultRole: RoleKey = scope === "coop" ? (teamsIn(initialTeams, "outsource")[0]?.key ?? "partner") : ""; // 사내 회원은 팀을 직접 골라야 한다 (미리 골라 두면 그 팀의 기본 메뉴가 켜져 보인다)
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
  const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD (한국 날짜)
  const defaultHire = () => (scope === "coop" ? "" : todayKst()); // 새 회원의 입사일 기본값: 오늘
  const [addressDetail, setAddressDetail] = useState(""); // 세부 주소 (동·호수)
  const [camOpen, setCamOpen] = useState(false); // 카메라 촬영 창
  const [camFor, setCamFor] = useState<"photo" | "bankbook">("photo"); // 무엇을 촬영하는지: 프로필 사진 / 통장 사본
  const [camErr, setCamErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [addrOpen, setAddrOpen] = useState(false); // 도로명 주소 찾기 창
  const [addrErr, setAddrErr] = useState("");
  const addrBox = useRef<HTMLDivElement>(null);
  const [hireDate, setHireDate] = useState(defaultHire); // 입사일 (YYYY-MM-DD)
  const [bank, setBank] = useState(""); // 급여 계좌
  const [accountNo, setAccountNo] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [safetyDate, setSafetyDate] = useState(""); // 안전교육 이수일 (현장)
  const [license, setLicense] = useState(""); // 면허·자격 정보 (현장)
  const [dailyDefault, setDailyDefault] = useState(defaultDaily); // 저장된 기본 일당
  const [dailyEdit, setDailyEdit] = useState(defaultDaily ? String(defaultDaily) : ""); // 기본 일당 입력
  const [monthlyDefault, setMonthlyDefault] = useState(defaultMonthly); // 저장된 기본 월급
  const [monthlyEdit, setMonthlyEdit] = useState(defaultMonthly ? String(defaultMonthly) : ""); // 기본 월급 입력
  const [payWhen, setPayWhen] = useState<"next" | "now">("next"); // 금액을 바꿀 때 적용 시점: 다음 급여 기간부터 / 이번 급여 기간부터
  const [payAmount, setPayAmount] = useState(""); // 급여(원): 일당 또는 월급 (숫자만)
  const [resignDate, setResignDate] = useState(""); // 퇴사일 (있으면 퇴사자)
  const [issue, setIssue] = useState<"" | "safety" | "bank">(""); // 회원관리 점검: 안전교육 미이수 / 계좌 미등록
  const [dualTab, setDualTab] = useState(false); // 사무실겸현장 탭 (사무실·현장 팀을 모두 가진 회원)
  const [tabResigned, setTabResigned] = useState(false); // 목록의 퇴사 탭
  const defaultPosition = scope === "coop" ? "" : "사원"; // 새 회원의 직급 기본값
  const [position, setPosition] = useState(defaultPosition); // 직급 (사원·대리 등)
  const [fieldSel, setFieldSel] = useState<RoleKey[]>([]); // 현장 역할(PM·사수·부사수) 여러 개
  const [officeStatus, setOfficeStatus] = useState<"" | "probation" | "regular">(""); // 사무실 구분: 수습 / 정규
  const [loginId, setLoginId] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null); // 새로 고른 프로필 사진
  const [photoPreview, setPhotoPreview] = useState(""); // 화면에 보일 사진 주소 (새로 고른 것 또는 저장된 것)
  const [photoRemove, setPhotoRemove] = useState(false); // 저장된 사진을 지울지
  const [bbFile, setBbFile] = useState<File | null>(null); // 새로 고른 급여 통장 사본
  const [bbPreview, setBbPreview] = useState(""); // 통장 사본 미리보기 주소
  const [bbRemove, setBbRemove] = useState(false);
  const [password, setPassword] = useState(""); // 등록할 때만: 비우면 임시 비밀번호 발급
  const [editId, setEditId] = useState<string | null>(null);
  const [side, setSide] = useState<SideKey | "all">(scope); // 이 화면의 구분(사내 또는 거래처)으로 고정
  const [group, setGroup] = useState<GroupKey | "all">(scope === "coop" ? "outsource" : "all"); // 사무실 / 현장 / 외주
  const [filter, setFilter] = useState<RoleKey | "all">("all"); // 팀명
  const [q, setQ] = useState(""); // 이름 검색
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 메뉴 권한 일괄 수정: 목록에서 여러 회원을 고르고, 메뉴마다 '변경 안 함 / 회수 / 보기만 / 모든 권한'을 정해 한 번에 적용한다
  type BulkLevel = "keep" | "none" | "view" | "all";
  const [selIds, setSelIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSel, setBulkSel] = useState<Partial<Record<MenuKey, BulkLevel>>>({});
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<PublicMember | null>(null);
  const [confirmReset, setConfirmReset] = useState<PublicMember | null>(null);
  const [viewMember, setViewMember] = useState<PublicMember | null>(null); // 회원정보: 자세히 보기 (읽기 전용)
  const [confirmPurge, setConfirmPurge] = useState<PublicMember | null>(null); // 퇴사 회원 완전 삭제
  const [issued, setIssued] = useState<Issued | null>(null);
  // 팀 관리
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false); // 회원 생성 팝업 (항상 닫힌 채로 시작)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({}); // 팀 관리의 부서(사무실/현장) 펼침
  const [ftab, setFtab] = useState<"basic" | "menu" | "pay" | "trade">("basic"); // 양식의 구역 탭
  const [listOpen, setListOpen] = useState(true);
  const [newTeam, setNewTeam] = useState<Partial<Record<GroupKey, string>>>({});
  const [teamErr, setTeamErr] = useState<{ group: GroupKey; text: string } | null>(null);
  const [confirmTeamDel, setConfirmTeamDel] = useState<Team | null>(null);
  const [tradeTeam, setTradeTeam] = useState<Team | null>(null); // 공정을 정하는 현장 팀
  const [tradeSel, setTradeSel] = useState<string[]>([]);
  const [tradeErr, setTradeErr] = useState("");
  const [teamDelErr, setTeamDelErr] = useState("");

  // 메뉴 권한 템플릿: 부여 메뉴 + 허용 동작을 묶어 이름 붙여 두고 한 번에 적용한다 (이 브라우저에 저장)
  const [tpls, setTpls] = useState<MenuTpl[]>([]);
  const [tplName, setTplName] = useState("");
  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(TPL_KEY) ?? "[]");
      if (Array.isArray(raw)) setTpls(raw.filter((t): t is MenuTpl => t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.menus)));
    } catch { /* 저장값이 깨졌으면 무시 */ }
  }, []);
  // 프로필 사진 고르기 (파일 선택 · 카메라 촬영 공통)
  function pickPhoto(f: File) {
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
    setPhotoRemove(false);
  }
  // 급여 통장 사본 고르기 (파일 선택 · 카메라 촬영 공통)
  function pickBankbook(f: File) {
    if (bbPreview.startsWith("blob:")) URL.revokeObjectURL(bbPreview);
    setBbFile(f);
    setBbPreview(URL.createObjectURL(f));
    setBbRemove(false);
  }
  // 카메라: 창이 열리면 카메라를 켜고, 닫히면 끈다
  useEffect(() => {
    if (!camOpen) return;
    let stream: MediaStream | null = null;
    let dead = false;
    setCamErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr("이 브라우저에서는 카메라를 바로 쓸 수 없어요. (보안 연결 https 또는 localhost 에서만 돼요)");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: camFor === "bankbook" ? "environment" : "user", width: { ideal: camFor === "bankbook" ? 1920 : 1280 }, height: { ideal: camFor === "bankbook" ? 1440 : 960 } }, audio: false })
      .then(st => {
        if (dead) { st.getTracks().forEach(t => t.stop()); return; }
        stream = st;
        const v = videoRef.current;
        if (v) { v.srcObject = st; void v.play().catch(() => undefined); }
      })
      .catch(() => setCamErr("카메라를 켜지 못했어요. 브라우저의 카메라 권한을 허용했는지 확인해 주세요."));
    return () => { dead = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [camOpen, camFor]);
  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, (camFor === "bankbook" ? 1600 : 1280) / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => {
      if (!b) return;
      if (camFor === "bankbook") pickBankbook(new File([b], "camera.jpg", { type: "image/jpeg" }));
      else pickPhoto(new File([b], "camera.jpg", { type: "image/jpeg" }));
      setCamOpen(false);
    }, "image/jpeg", 0.9);
  }

  useEffect(() => {
    if (!addrOpen) return;
    let dead = false;
    setAddrErr("");
    loadPostcode()
      .then(() => {
        requestAnimationFrame(() => {
          const box = addrBox.current;
          const Post = (window as unknown as DaumWindow).daum?.Postcode;
          if (dead || !box || !Post) return;
          box.innerHTML = "";
          new Post({
            width: "100%",
            height: "100%",
            oncomplete: d => {
              const road = d.userSelectedType !== "J"; // R 도로명 / J 지번
              const base = road ? d.roadAddress : d.jibunAddress;
              setAddress(base + (road && d.buildingName ? ` (${d.buildingName})` : ""));
              setAddrOpen(false);
              window.setTimeout(() => document.getElementById("maddr2")?.focus(), 50); // 이어서 세부 주소를 적는다
            },
          }).embed(box);
        });
      })
      .catch(e => setAddrErr(e instanceof Error ? e.message : "주소 검색을 불러오지 못했어요."));
    return () => { dead = true; };
  }, [addrOpen]);
  function saveTpls(next: MenuTpl[]) {
    setTpls(next);
    try { window.localStorage.setItem(TPL_KEY, JSON.stringify(next)); } catch { /* 저장 불가 환경 */ }
  }
  function saveTpl() {
    const n = tplName.trim();
    if (!n) return say("템플릿 이름을 적어 주세요.");
    if (menus.length === 0) return say("부여한 메뉴가 없어요. 메뉴를 먼저 골라 주세요.");
    const t: MenuTpl = { id: String(Date.now()), name: n, menus, actions };
    saveTpls([...tpls.filter(x => x.name !== n), t]); // 같은 이름이면 덮어쓴다
    setTplName("");
    say(`‘${n}’ 템플릿을 저장했어요.`);
  }
  function applyTpl(t: MenuTpl) {
    const base = roleMenus([role, ...(extraRole ? [extraRole] : [])]);
    const ok = t.menus.filter(k => MENUS.some(mn => mn.key === k && mn.grantable) && !base.includes(k)); // 팀 기본·전용 메뉴는 제외
    setMenus(ok);
    setPartialOpen({});
    setActions(Object.fromEntries(ok.filter(k => MENU_ACTIONS[k].length > 0).map(k => [k, (t.actions[k] ?? ["view"]).filter(a => MENU_ACTIONS[k].includes(a))])) as GrantedActions);
    say(`‘${t.name}’ 템플릿을 적용했어요.`);
  }

  useEffect(() => setOrigin(window.location.origin), []);
  const toastId = toast?.id;
  useEffect(() => {
    if (toastId == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastId ? null : cur)), 3500);
    return () => window.clearTimeout(t);
  }, [toastId]);

  const say = (text: string) => setToast({ id: Date.now(), text });
  const editingSelf = editId !== null && editId === selfId;
  const full = picked.length >= MAX_TRADES;

  const inScope = (m: PublicMember) => {
    const g = teamGroup(teams, m.role);
    return g !== null && sideOf(g) === scope;
  };
  const scoped = members.filter(inScope);
  const activeScoped = scoped.filter(m => !m.resignDate); // 재직자
  const resignedCount = scoped.length - activeScoped.length;
  const noun = scope === "coop" ? "거래처" : "회원";
  const sidesShown = SIDES.filter(sd => sd.key === scope);
  const counts = useMemo(() => {
    const m = new Map<RoleKey, number>();
    members.forEach(x => m.set(x.role, (m.get(x.role) ?? 0) + 1));
    return m;
  }, [members]);
  const teamOrder = (r: RoleKey) => { const i = teams.findIndex(t => t.key === r); return i < 0 ? 999 : i; };
  // 현장 팀(사수·부사수·PM)은 '현장작업자' 하나로 보여 주고, 역할은 따로 고른다
  const uiTeams = useMemo(() => teams.filter(t => t.key !== "pm" && t.key !== "worker_sub").map(t => (t.key === "worker" ? { ...t, label: "현장팀" } : t)), [teams]);
  const teamCount = (key: string) => (key === "worker" ? FIELD_ROLES.reduce((n, r) => n + (counts.get(r.key) ?? 0), 0) : counts.get(key) ?? 0);
  const fieldCur = [role, extraRole].find(r => r && isFieldRole(r)) ?? ""; // 팀 칸에 현장 역할 팀('현장팀')이 들어 있으면 그 키
  const hasField = [role, extraRole].some(r => r && (isFieldRole(r) || teamGroup(teams, r) === "field")); // 현장 팀을 하나라도 골랐는가 (직접 만든 구조조팀 등 포함)
  // 현장 역할(PM·사수·부사수): 직접 만든 현장 팀을 골라도 따로 고를 수 있다
  const fieldNow: RoleKey[] = !hasField ? [] : fieldCur ? (fieldSel.includes(fieldCur) ? fieldSel : [fieldCur]) : fieldSel;
  const hasOffice = [role, extraRole].some(r => r && teamGroup(teams, r) === "office");
  const needTrades = canSurvey([role, ...(extraRole ? [extraRole] : []), ...fieldNow], menus); // 설문에 참여하는 회원만 공정을 갖는다
  // 역할 하나를 켜거나 끈다 (하나는 남아야 한다). 팀 칸에는 선택한 것 중 첫째(PM → 사수 → 부사수 순)가 들어간다
  function toggleFieldRole(k: RoleKey) {
    // 사수와 부사수는 함께 고를 수 없다 (하나를 고르면 다른 하나는 빠진다). PM 은 둘 중 하나와 함께 가능
    const other = k === "worker" ? "worker_sub" : k === "worker_sub" ? "worker" : "";
    const next = fieldNow.includes(k) ? fieldNow.filter(x => x !== k) : [...fieldNow.filter(x => x !== other), k];
    if (next.length === 0 && fieldCur) return; // '현장팀'을 골랐다면 역할 하나는 남아야 한다 (직접 만든 팀이면 비워도 된다)
    const ordered = FIELD_ROLES.map(r => r.key as RoleKey).filter(x => next.includes(x));
    setFieldSel(ordered);
    if (fieldCur && ordered[0] !== fieldCur) toggleTeam(ordered[0]);
  }
  const groupOf = (m: PublicMember): GroupKey | null => teamGroup(teams, m.role);
  // 분류: 사무실만 / 현장만 / 둘 다 가진 '사무실겸현장' — 한 사람은 한 곳에만 센다 (1명이 2명으로 세어지지 않게)
  const deptOf = (m: PublicMember): "office" | "field" | "both" | "other" => {
    const o = memberHasGroup(teams, m, "office");
    const f = memberHasGroup(teams, m, "field");
    return o && f ? "both" : o ? "office" : f ? "field" : "other";
  };
  const inGroup = (m: PublicMember, g: GroupKey) => (g === "office" || g === "field" ? deptOf(m) === g : memberHasGroup(teams, m, g));
  const groupCount = (g: GroupKey) => activeScoped.filter(m => inGroup(m, g)).length;
  const dualCount = activeScoped.filter(m => deptOf(m) === "both").length;
  const kw = q.trim().replace(/\s+/g, "").toLowerCase();
  const shown = scoped.filter(m => {
    if (!!m.resignDate !== tabResigned) return false; // 재직자 탭 / 퇴사 탭
    if (issue === "safety" && !(memberHasGroup(teams, m, "field") && !m.safetyDate)) return false;
    if (issue === "bank" && m.accountNo) return false;
    const g = groupOf(m);
    return (
      (!kw || m.name.replace(/\s+/g, "").toLowerCase().includes(kw)) &&
      (side === "all" || (g !== null && sideOf(g) === side)) &&
      (dualTab ? deptOf(m) === "both" : group === "all" || inGroup(m, group)) &&
      (filter === "all" || (filter === "worker" ? isFieldRole(m.role) : m.role === filter))
    );
  });
  const tradeOf = (m: PublicMember) => m.trades[0] ?? ""; // 현장 탭: 같은 공정(구조·도장 등) 팀끼리 묶는다
  const fieldKeyOf = (m: PublicMember) => memberRoles(m).find(isFieldRole) ?? "";
  const fieldRank = (r: string) => FIELD_ROLES.findIndex(x => x.key === r);
  // \uc5f4 \uc81c\ubaa9\uc744 \ub20c\ub7ec \uc815\ub82c: \ud55c \ubc88 = \uc624\ub984\ucc28\uc21c, \ub450 \ubc88 = \ub0b4\ub9bc\ucc28\uc21c, \uc138 \ubc88 = \ud574\uc81c. \uc815\ub82c \uc911\uc5d0\ub294 \uacf5\uc815\ubcc4 \ubb36\uc74c\uc744 \ud480\uace0 \ud55c \uc904\ub85c \ub298\uc5b4\ub193\ub294\ub2e4.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const clickSort = (key: SortKey) => setSort(s => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const sortVal = (m: PublicMember, key: SortKey): string => {
    switch (key) {
      case "name": return m.name;
      case "team": return teamsLabel(teams, m);
      case "position": return m.position ?? "";
      case "loginId": return m.loginId ?? "";
      case "phone": return (m.phone ?? "").replace(/\D/g, "");
      case "hire": return m.hireDate ?? "";
      case "created": return m.createdAt ?? "";
    }
  };
  const listed = sort
    ? [...shown].sort((a, b) => {
        const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
        if (!x !== !y) return !x ? 1 : -1; // \ube48 \uac12\uc740 \ubc29\ud5a5\uacfc \uc0c1\uad00\uc5c6\uc774 \ub9e8 \uc544\ub798
        return sort.dir * x.localeCompare(y, "ko", { numeric: true }) || a.name.localeCompare(b.name, "ko");
      })
    : group === "field" ? [...shown].sort((a, b) => (tradeOf(a) || "\uffff").localeCompare(tradeOf(b) || "\uffff", "ko") || fieldRank(fieldKeyOf(a)) - fieldRank(fieldKeyOf(b))) : shown;
  const SortTh = ({ k, children }: { k: SortKey; children: string }) => (
    <th className="whitespace-nowrap px-3 py-2.5 font-bold" aria-sort={sort?.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => clickSort(k)} className={`inline-flex items-center gap-1 font-bold hover:text-zinc-900 dark:hover:text-zinc-100 ${sort?.key === k ? "text-blue-700 dark:text-blue-300" : ""}`} title="\ub20c\ub7ec\uc11c \uc624\ub984\ucc28\uc21c / \ub0b4\ub9bc\ucc28\uc21c \uc815\ub82c">
        {children}<span aria-hidden className="text-[10px]">{sort?.key === k ? (sort.dir === 1 ? "\u25b2" : "\u25bc") : "\u2195"}</span>
      </button>
    </th>
  );
  const pickSide = (s: SideKey | "all") => {
    setDualTab(false);
    setTabResigned(false);
    setSide(s);
    setGroup("all");
    setFilter("all");
  };
  const pickGroup = (g: GroupKey | "all") => {
    setDualTab(false);
    setTabResigned(false);
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
    if (!role) return applyTeams(key, ""); // 아직 팀을 고르지 않았으면 첫 선택
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
  // 메뉴별 권한 모드: 없음 / 일부 권한(동작을 골라서) / 모든 권한
  const allBase = roleMenus([role, ...(extraRole ? [extraRole] : []), ...fieldNow]);
  // 현장정보는 사내 팀의 기본 메뉴(보기만)이지만, 관리 팀이 아니면 전체 권한을 더 부여할 수 있다
  const sitesUpgradable = allBase.includes("sites") && !isStaffAdmin([role, ...(extraRole ? [extraRole] : []), ...fieldNow]);
  const isLocked = (k: MenuKey) => allBase.includes(k) && !(k === "sites" && sitesUpgradable);
  const [partialOpen, setPartialOpen] = useState<Record<string, boolean>>({});
  function modeOf(k: MenuKey): Mode {
    if (!menus.includes(k)) return "none";
    if (k === "sites" && sitesUpgradable) return "all"; // 팀 기본(보기만) / 전체 권한 부여 두 가지
    if (MENU_ACTIONS[k].length === 0 || k === "members" || k === "staff" || k === "suppliers" || k === "catalog") return "all"; // 회원등록·회원정보·거래처관리·장비운용은 부여 / 부여 안 함 두 가지뿐
    return partialOpen[k] || (actions[k] ?? []).length < MENU_ACTIONS[k].length ? "partial" : "all";
  }
  function setMode(k: MenuKey, m: Mode) {
    if (m === "none") { setMenus(p => p.filter(x => x !== k)); setActions(p => { const { [k]: _r, ...rest } = p; void _r; return rest; }); setPartialOpen(p => ({ ...p, [k]: false })); return; }
    setMenus(p => (p.includes(k) ? p : [...p, k]));
    if (MENU_ACTIONS[k].length === 0) return;
    setPartialOpen(p => ({ ...p, [k]: m === "partial" }));
    setActions(p => ({ ...p, [k]: m === "all" ? [...MENU_ACTIONS[k]] : ["view", "register"].filter(a => MENU_ACTIONS[k].includes(a as ActionKey)) as ActionKey[] })); // 일부 권한은 보기·등록으로 정해져 있다
  }
  function resetForm() {
    setName("");
    setHandles("");
    setPhone("");
    setAddress("");
    setAddressDetail("");
    setPosition(defaultPosition);
    setHireDate(defaultHire());
    setResignDate("");
    setPayAmount("");
    setPayWhen("next");
    setBank("");
    setAccountNo("");
    setAccountHolder("");
    setSafetyDate("");
    setLicense("");
    setFieldSel([]);
    setOfficeStatus("");
    setRole(defaultRole);
    setAnnualRemain("");
    setExtraRole("");
    setPayType("");
    setMenus([]);
    setActions({});
    setPicked([]);
    setPickedCats([]);
    setLoginId("");
    setPassword("");
    if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview("");
    setPhotoRemove(false);
    if (bbPreview.startsWith("blob:")) URL.revokeObjectURL(bbPreview);
    setBbFile(null);
    setBbPreview("");
    setBbRemove(false);
    setEditId(null);
    setCreateOpen(false);
    setFtab("basic");
    setErr("");
  }
  // 새 회원은 항상 빈 양식으로 시작한다
  function startCreate() {
    resetForm();
    setCreateOpen(true);
  }

  async function bulkApply() {
    const ops = (Object.entries(bulkSel) as [MenuKey, BulkLevel][]).filter(([, v]) => v !== "keep");
    if (ops.length === 0) return say("바꿀 메뉴를 하나 이상 골라 주세요.");
    const targets = members.filter(m => selIds.includes(m.id));
    if (targets.length === 0) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const m of targets) { // 한 명씩 차례로 (기존 수정 규칙·검사를 그대로 거친다)
      const menus = new Set<MenuKey>(m.menus);
      const actions: GrantedActions = { ...m.actions };
      for (const [k, v] of ops) {
        if (v === "none") { menus.delete(k); delete actions[k]; continue; }
        menus.add(k);
        if (MENU_ACTIONS[k].length > 0) actions[k] = v === "view" ? ["view"] : [...MENU_ACTIONS[k]];
      }
      const r = await call({ action: "update", id: m.id, menus: [...menus], actions });
      if (r.ok && r.member) {
        ok++;
        const saved = r.member;
        setMembers(prev => prev.map(x => (x.id === saved.id ? saved : x)));
      } else failed.push(m.name);
    }
    setBusy(false);
    setBulkOpen(false);
    setSelIds(failed.length ? targets.filter(m => failed.includes(m.name)).map(m => m.id) : []);
    say(failed.length ? `${ok}명에게 적용했어요. 실패: ${failed.join(", ")}` : `${ok}명의 메뉴 권한을 바꿨어요.`);
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
    if (nextTab) { setFtab(nextTab); return; } // 마지막 탭 전에 Enter 를 눌러도 다음으로만 넘어간다
    if (!name.trim()) { setFtab("basic"); return setErr("이름을 적어 주세요."); }
    if (scope !== "coop" && !/^[가-힣]{2,20}$/.test(name.trim())) { setFtab("basic"); return setErr("이름은 한글로만 적어 주세요 (2~20자)."); }
    if (loginId && !/^(?=.*[a-z])(?=.*[0-9])[a-z0-9]{3,20}$/.test(loginId)) { setFtab("basic"); return setErr("아이디는 영문 소문자와 숫자를 섞어서 3~20자로 적어 주세요."); }
    if (!role) { setFtab("basic"); return setErr("팀을 골라 주세요."); }
    if (scope !== "coop" && phone.replace(/[^0-9]/g, "").length < 9) { setFtab("basic"); return setErr("연락처를 적어 주세요 (예: 010-1234-5678)."); }
    setBusy(true);
    setErr("");
    try {
      const tradesToSend = needTrades ? picked : [];
      const catsToSend = needTrades ? pickedCats.filter(c => picked.includes(categoryTrades[c])) : [];
      const officePay = scope !== "coop" && effectivePay(teams, { role, payType }) === "office";
      const annualRemainToSend = officePay ? (annualRemain.trim() === "" ? null : Number(annualRemain)) : undefined; // 사무직 기준이 아니면 보내지 않는다
      const r = await call(
        editId
          ? { action: "update", id: editId, name, role, extraRole, payType, annualRemain: annualRemainToSend, menus, actions, trades: tradesToSend, categories: catsToSend, handles, phone, address, addressDetail, position, hireDate, resignDate, payAmount: payAmountNow === "" ? 0 : Number(payAmountNow), payEffective: payWhen, bank, accountNo, accountHolder: accountHolder.trim() || name.trim(), safetyDate: hasField ? safetyDate : "", license: hasField ? license : "", fieldRoles: fieldNow, officeStatus: hasOffice ? officeStatus || "regular" : "", loginId: loginId || undefined }
          : { action: "add", name, role, extraRole, payType, annualRemain: annualRemainToSend, menus, actions, trades: tradesToSend, categories: catsToSend, handles, phone, address, addressDetail, position, hireDate, resignDate, payAmount: payAmountNow === "" ? 0 : Number(payAmountNow), bank, accountNo, accountHolder: accountHolder.trim() || name.trim(), safetyDate: hasField ? safetyDate : "", license: hasField ? license : "", fieldRoles: fieldNow, officeStatus: hasOffice ? officeStatus || "regular" : "", loginId: loginId || undefined, password: password || undefined, account: scope !== "coop" },
      );
      if (r.ok && r.member) {
        let m = r.member;
        try {
          // 프로필 사진: 새로 골랐으면 올리고, 지우기를 눌렀으면 지운다 (회원을 저장한 다음에 처리)
          if (photoFile) {
            const blob = await shrink(photoFile);
            const fd = new FormData();
            fd.set("id", m.id);
            fd.set("photo", new File([blob], blob.type === "image/webp" ? "member.webp" : "member.jpg", { type: blob.type }));
            const pr = await fetch("/api/admin/members/photo", { method: "POST", body: fd });
            const pj = (await pr.json().catch(() => ({}))) as { member?: PublicMember; error?: string };
            if (pr.ok && pj.member) m = pj.member;
            else say(pj.error ?? "사진은 올리지 못했어요. 수정에서 다시 올려 주세요.");
          } else if (photoRemove && m.photo) {
            const fd = new FormData();
            fd.set("id", m.id);
            fd.set("remove", "1");
            const pr = await fetch("/api/admin/members/photo", { method: "POST", body: fd });
            const pj = (await pr.json().catch(() => ({}))) as { member?: PublicMember };
            if (pr.ok && pj.member) m = pj.member;
          }
        } catch {
          say("사진은 올리지 못했어요. 수정에서 다시 올려 주세요.");
        }
        try {
          // 급여 통장 사본: 새로 골랐으면 올리고, 지우기를 눌렀으면 지운다
          if (bbFile || (bbRemove && m.bankbook)) {
            const fd = new FormData();
            fd.set("id", m.id);
            fd.set("kind", "bankbook");
            if (bbFile) {
              const blob = await shrink(bbFile, 1600); // 글자가 읽히도록 프로필 사진보다 크게
              fd.set("photo", new File([blob], blob.type === "image/webp" ? "bankbook.webp" : "bankbook.jpg", { type: blob.type }));
            } else fd.set("remove", "1");
            const pr = await fetch("/api/admin/members/photo", { method: "POST", body: fd });
            const pj = (await pr.json().catch(() => ({}))) as { member?: PublicMember; error?: string };
            if (pr.ok && pj.member) m = pj.member;
            else say(pj.error ?? "통장 사본은 올리지 못했어요. 수정에서 다시 올려 주세요.");
          }
        } catch {
          say("통장 사본은 올리지 못했어요. 수정에서 다시 올려 주세요.");
        }
        const saved = m;
        setMembers(prev => (editId ? prev.map(x => (x.id === saved.id ? saved : x)) : [...prev, saved]));
        if (r.annual) setBalances(prev => ({ ...prev, [m.id]: r.annual! })); // 저장한 연차 잔여를 바로 반영
        if (!editId && r.credentials && !password) setIssued({ name: m.name, kind: "new", creds: r.credentials });
        else say(editId ? "수정했어요" : "등록했어요");
        resetForm();
      } else if (r.error) setErr(r.error);
    } catch {
      setErr("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }

  function startEdit(m: PublicMember) {
    setPayWhen("next");
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
    setPhone(formatPhone(m.phone ?? ""));
    setAddress(m.address ?? "");
    setAddressDetail(m.addressDetail ?? "");
    setPosition(m.position ?? "");
    setPhotoPreview(m.photo ?? "");
    setBbPreview(m.bankbook ?? "");
    setHireDate(m.hireDate ?? "");
    setResignDate(m.resignDate ?? "");
    setPayAmount(m.payAmount ? String(m.payAmount) : "");
    setBank(m.bank ?? "");
    setAccountNo(m.accountNo ?? "");
    setAccountHolder(m.accountHolder ?? "");
    setSafetyDate(m.safetyDate ?? "");
    setLicense(m.license ?? "");
    setFieldSel(memberRoles(m).filter(isFieldRole));
    setOfficeStatus(m.officeStatus ?? "");
    setLoginId(m.loginId ?? "");
    setFtab("basic");
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

  async function saveDailyDefault(over?: { daily?: string; monthly?: string }) {
    const dailyStr = over?.daily ?? dailyEdit;
    const monthlyStr = over?.monthly ?? monthlyEdit;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/pay-defaults", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ daily: dailyStr === "" ? 0 : Number(dailyStr), monthly: monthlyStr === "" ? 0 : Number(monthlyStr) }) });
      const j = (await r.json().catch(() => ({}))) as { daily?: number; monthly?: number; error?: string };
      if (r.ok && typeof j.daily === "number" && typeof j.monthly === "number") {
        setDailyDefault(j.daily);
        setDailyEdit(j.daily ? String(j.daily) : "");
        setMonthlyDefault(j.monthly);
        setMonthlyEdit(j.monthly ? String(j.monthly) : "");
        say("기본 급여를 저장했어요");
      } else say(j.error ?? "저장하지 못했어요.");
    } catch {
      say("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }
  async function doPurge() {
    if (!confirmPurge) return;
    const m = confirmPurge;
    setBusy(true);
    try {
      const r = await call({ action: "delete", id: m.id });
      if (r.ok) {
        setMembers(prev => prev.filter(x => x.id !== m.id));
        say(`${m.name}님을 완전히 삭제했어요`);
        setConfirmPurge(null);
      } else say(r.error ?? "삭제하지 못했어요.");
    } catch {
      say("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }
  async function reinstate(m: PublicMember) {
    setBusy(true);
    try {
      const r = await call({ action: "update", id: m.id, resignDate: "" });
      if (r.ok && r.member) {
        setMembers(prev => prev.map(x => (x.id === m.id ? r.member! : x)));
        say(`${m.name}님을 복직 처리했어요 (입사일을 오늘로 새로 정했어요)`);
      } else say(r.error ?? "복직 처리하지 못했어요.");
    } catch {
      say("서버에 연결할 수 없어요.");
    }
    setBusy(false);
  }
  async function doDelete() {
    if (!confirmDel) return;
    setBusy(true);
    try {
      const r = await call({ action: scope === "coop" ? "delete" : "resign", id: confirmDel.id });
      if (r.ok) {
        setMembers(prev => (scope === "coop" ? prev.filter(x => x.id !== confirmDel.id) : prev.map(x => (x.id === confirmDel.id && r.member ? r.member : x))));
        if (editId === confirmDel.id) resetForm();
        say(`${confirmDel.name}님을 ${scope === "coop" ? "삭제" : "퇴사 처리"}했어요`);
        setConfirmDel(null);
      } else say(r.error ?? (scope === "coop" ? "삭제하지 못했어요." : "퇴사 처리하지 못했어요."));
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

  // 공정 표시: 등록된 공정을 모두 골랐으면 따로따로 보이지 않고 "전체"로 표시한다
  const tradesText = (list: string[]) => (list.length === 0 ? "" : trades.length > 0 && trades.every(t => list.includes(t)) ? "전체" : list.join("·"));
  async function saveTeamTrades() {
    if (!tradeTeam) return;
    setBusy(true);
    setTradeErr("");
    try {
      const r = await callTeams({ action: "trades", key: tradeTeam.key, trades: tradeSel });
      if (r.ok && r.team) {
        setTeams(prev => prev.map(x => (x.key === r.team!.key ? r.team! : x)));
        say(`“${tradeTeam.label}” 팀의 공정을 저장했어요`);
        setTradeTeam(null);
      } else setTradeErr(r.error ?? "저장하지 못했어요.");
    } catch {
      setTradeErr("서버에 연결할 수 없어요.");
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
        setTeams(prev => prev.filter(x => x.key !== t.key && !(isFieldRole(t.key) && isFieldRole(x.key))));
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

  // 새 회원의 급여를 직접 적지 않았으면 기본값(일수제는 일당, 사무직은 월급)이 들어간다
  const payDefaultNow = !editId && scope !== "coop" ? (effectivePay(teams, { role, payType }) === "office" ? monthlyDefault : dailyDefault) : 0; // 새 회원: 급여 기준에 맞는 기본값
  const payAmountNow = payAmount !== "" ? payAmount : payDefaultNow > 0 ? String(payDefaultNow) : "";
  const tabList = ([["basic", "기본 정보", true, false], ["menu", "메뉴 권한", !manage, menus.length > 0], ["pay", "급여·연차", scope !== "coop", payType !== "" || annualRemain !== "" || payAmount !== "" || accountNo !== "" || !!bbPreview], ["trade", "공정", false, false]] as const).filter(t => t[2]);
  const tab = ftab === "trade" && !needTrades ? "basic" : ftab === "pay" && scope === "coop" ? "basic" : ftab;
  const tabIdx = tabList.findIndex(t => t[0] === tab);
  const nextTab = !editId && tabIdx >= 0 && tabIdx < tabList.length - 1 ? tabList[tabIdx + 1][0] : null; // 새로 등록할 때는 마지막 탭에서만 등록 버튼이 나온다
  const formEl = (
    <form
      onSubmit={submit}
      className="flex h-[min(40rem,calc(90vh-2.5rem))] flex-col"
    >
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">{editId ? (manage ? "회원정보" : "회원수정") : `${noun} 등록`}</h2>
        <button type="button" onClick={() => !busy && resetForm()} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        {editId ? "이름·팀·메뉴·아이디를 바꿀 수 있어요." : scope === "coop" ? "이름과 팀만 있으면 등록돼요. 아이디는 필요할 때 목록에서 ‘아이디 생성’으로 만들어요." : "이름과 팀만 고르면 돼요. 만들면 아이디와 임시 비밀번호가 발급돼요."}
      </p>

      {/* 구역 탭: 처음에는 이름·팀(기본 정보)만 보이고, 나머지는 필요할 때 열어요 */}
      <div className="mt-3 flex gap-1 border-b border-black/10 dark:border-white/10" role="tablist" aria-label="입력 구역">
        {tabList.map(([k, label, , filled]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setFtab(k)} className={`-mb-px flex-1 border-b-2 px-2 py-2 text-sm font-extrabold ${tab === k ? "border-blue-600 text-blue-700 dark:text-blue-300" : "border-transparent text-zinc-500"}`}>{label}{filled && <span className="ml-1 text-emerald-600" aria-hidden>•</span>}{k === "trade" && picked.length < 1 && <span className="ml-1 text-red-500" aria-hidden>!</span>}</button>
        ))}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
      <div className={tab === "basic" ? "grid gap-x-4 sm:grid-cols-2" : "hidden"} role="tabpanel">
      {scope !== "coop" && (
        <div className="mt-4 flex items-center gap-3 sm:col-span-2">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-2xl text-zinc-400 dark:bg-zinc-800">
            {photoPreview && !photoRemove ? <img src={photoPreview} alt="프로필 사진" className="h-full w-full object-cover" /> : <span aria-hidden>👤</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold dark:bg-zinc-800">
              {photoPreview && !photoRemove ? "사진 바꾸기" : "사진 등록"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
                setPhotoFile(f);
                setPhotoPreview(URL.createObjectURL(f));
                setPhotoRemove(false);
              }} />
            </label>
            {!editId && <button type="button" onClick={() => { setCamFor("photo"); setCamOpen(true); }} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold dark:bg-zinc-800">카메라 촬영</button>}
            {(photoPreview && !photoRemove) && (
              <button type="button" onClick={() => { if (photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview); setPhotoFile(null); setPhotoPreview(""); setPhotoRemove(true); }} className="rounded-lg px-3 py-1.5 text-sm font-bold text-red-600">삭제</button>
            )}
            <span className="basis-full text-xs text-zinc-500">선택 · 얼굴이 보이는 사진{editId ? "" : " (파일을 고르거나 바로 촬영해요)"}</span>
          </div>
        </div>
      )}
      <div className="mt-4">
<label htmlFor="mname" className="block text-sm font-bold">이름 <span className="font-normal text-zinc-500">(필수)</span></label>
      <input id="mname" value={name} onChange={e => setName(scope === "coop" ? e.target.value : e.target.value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/g, ""))} maxLength={scope === "coop" ? 40 : 20} placeholder={scope === "coop" ? "예: 가나다 철물 (같은 이름이 있으면 구분)" : "예: 홍길동 (한글만)"} autoComplete="off" className={inputCls} />
</div>
<div className="mt-4">
<label htmlFor="mphone" className="block text-sm font-bold">연락처 <span className="font-normal text-zinc-500">{scope === "coop" ? "(선택)" : "(필수)"}</span></label>
          <input id="mphone" type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} maxLength={13} placeholder="예: 010-1234-5678" autoComplete="off" className={inputCls} />
</div>
<div className="mt-4 sm:col-span-2">
<label htmlFor="maddr" className="block text-sm font-bold">주소 <span className="font-normal text-zinc-500">(선택)</span></label>
<div className="mt-2 flex gap-2">
<input id="maddr" value={address} onChange={e => setAddress(e.target.value)} maxLength={200} placeholder="주소 찾기로 도로명 주소를 골라요" autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
<button type="button" onClick={() => setAddrOpen(true)} className="shrink-0 rounded-xl bg-zinc-100 px-4 text-sm font-bold dark:bg-zinc-800">주소 찾기</button>
</div>
<input id="maddr2" aria-label="세부 주소" value={addressDetail} onChange={e => setAddressDetail(e.target.value)} maxLength={100} placeholder="세부 주소 (동·호수 등)" autoComplete="off" className={inputCls} />
</div>
      {(scope !== "coop" || (editId && loginId)) && (<>
      <div className="mt-4">
<label htmlFor="mid" className="block text-sm font-bold">
        아이디 <span className="font-normal text-zinc-500">{editId ? "(영문 소문자+숫자 조합 3~20자)" : "(영문+숫자 조합 · 비우면 자동 생성)"}</span>
      </label>
      <input id="mid" value={loginId} onChange={e => setLoginId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} maxLength={20} autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder={editId ? "" : "자동 생성"} className={inputCls} />
</div>
      {!editId && scope !== "coop" && (
        <>
          <div className="mt-4">
<label htmlFor="mpw" className="block text-sm font-bold">비밀번호 <span className="font-normal text-zinc-500">(비우면 임시 비밀번호 발급)</span></label>
          <input id="mpw" type="password" value={password} onChange={e => setPassword(e.target.value)} maxLength={64} autoComplete="new-password" placeholder="6자 이상 · 비우면 자동 발급" className={inputCls} />
          {password && <p className="mt-1 text-xs text-zinc-500">직접 정한 비밀번호는 바로 쓸 수 있고, 첫 로그인 때 바꾸라고 하지 않아요.</p>}
</div>
        </>
      )}
      {editId && !manage && scope !== "coop" && (() => {
        const em = members.find(x => x.id === editId);
        return em ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 sm:col-span-2 dark:bg-zinc-800/60">
            <span className="mr-auto text-xs text-zinc-500">비밀번호를 잊었다면 임시 비밀번호를 다시 발급해요.</span>
            <button type="button" disabled={editingSelf} onClick={() => setConfirmReset(em)} title={editingSelf ? "내 비밀번호는 우측 상단 ‘비밀번호 변경’에서 바꿔요" : undefined} className="shrink-0 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600 disabled:opacity-35 dark:bg-blue-500/15 dark:text-blue-300">비번 재발급</button>
          </div>
        ) : null;
      })()}
      </>)}

      {scope !== "coop" && (
        <>
                    <div className="contents">
            <div className="mt-4">
              <label htmlFor="mhire" className="block text-sm font-bold">입사일 <span className="font-normal text-zinc-500">(선택)</span></label>
              <input id="mhire" type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className={inputCls} />
            </div>
            <div className="mt-4">
<label htmlFor="mpos" className="block text-sm font-bold">직급 <span className="font-normal text-zinc-500">(선택)</span></label>
          <select id="mpos" value={position} onChange={e => setPosition(e.target.value)} className={inputCls}>
            <option value="">선택 안 함</option>
            {[...POSITIONS, ...(position && !POSITIONS.includes(position) ? [position] : [])].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
</div>
{manage && <div className="mt-4">
              <label htmlFor="mresign" className="block text-sm font-bold">퇴사일 <span className="font-normal text-zinc-500">(퇴사한 경우)</span></label>
              <input id="mresign" type="date" value={resignDate} min={hireDate || undefined} onChange={e => setResignDate(e.target.value)} disabled={editingSelf} className={inputCls} />
            </div>}
          </div>
          {editId && (() => {
            const h = members.find(x => x.id === editId)?.history ?? [];
            return h.length > 0 ? (
              <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-xs sm:col-span-2 dark:bg-zinc-800/60">
                <div className="font-bold text-zinc-500">재직 이력 <span className="font-normal">(퇴사 후 복직한 기록)</span></div>
                <ul className="mt-1 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  {h.map((x, i) => <li key={i}>{x.hire || "입사일 미기록"} ~ {x.resign} <span className="text-zinc-400">퇴사 후 복직</span></li>)}
                </ul>
              </div>
            ) : null;
          })()}
          {manage && resignDate && <p className="mt-1 text-xs sm:col-span-2 text-amber-600 dark:text-amber-300">퇴사일이 있으면 로그인할 수 없고 퇴사 탭에 모여요. 지우면 복직돼요.</p>}
        </>
      )}

      {(
        <>
          {scope === "coop" && <>
          <div className="mt-4 sm:col-span-2">
<label htmlFor="mhandles" className="block text-sm font-bold">취급품목 <span className="font-normal text-zinc-500">(선택)</span></label>
          <input id="mhandles" value={handles} onChange={e => setHandles(e.target.value)} maxLength={100} placeholder="예: 합판, 각재, 방부목" autoComplete="off" className={inputCls} />
</div>
          </>}
                            </>
      )}

      <div className="mt-4 text-sm font-bold sm:col-span-2">팀 <span className="font-normal text-zinc-500">(필수){scope === "coop" ? "" : " · 사무실·현장 팀을 하나씩 함께 고를 수 있어요"}</span></div>
      <div className="mt-2 divide-y divide-black/10 rounded-xl border sm:col-span-2 border-black/10 dark:divide-white/10 dark:border-white/10" role="group" aria-label="팀">
        {sidesShown.flatMap(sd => groupsIn(sd.key)).map(g => {
          const isOn = (t: Team) => (t.key === "worker" ? !!fieldCur : role === t.key || extraRole === t.key); // 사무실·현장 팀을 하나씩 함께 고를 수 있다
          const list = teamsIn(uiTeams, g.key).filter(t => !editingSelf || isOn(t)); // 내 팀은 스스로 바꿀 수 없으니 내 팀만 보인다
          if (editingSelf && list.length === 0) return null;
          const seg = "inline-flex overflow-hidden rounded-lg border border-black/10 text-sm dark:border-white/10";
          const segBtn = (on: boolean) => `px-3 py-1 font-bold ${on ? "bg-blue-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`;
          return (
            <div key={g.key} className="px-3 py-2.5">
              <div className="flex min-h-7 items-center gap-2">
                <span className="text-xs font-bold text-zinc-500">{g.label}</span>
                {g.key === "office" && hasOffice && (
                  <div className={`${seg} ml-auto`} role="radiogroup" aria-label="사무실 구분">
                    {OFFICE_STATUS.map(o => (
                      <button key={o.v} type="button" role="radio" aria-checked={officeStatus === o.v} onClick={() => setOfficeStatus(officeStatus === o.v ? "" : o.v)} className={segBtn(officeStatus === o.v)}>{o.label}</button>
                    ))}
                  </div>
                )}
                {g.key === "field" && hasField && (
                  <div className={`${seg} ml-auto`} role="group" aria-label="현장 역할 (여러 개 선택)">
                    {FIELD_ROLES.map(r => (
                      <button key={r.key} type="button" role="checkbox" aria-checked={fieldNow.includes(r.key)} disabled={editingSelf} onClick={() => toggleFieldRole(r.key)} className={`${segBtn(fieldNow.includes(r.key))} ${editingSelf ? "opacity-50" : ""}`}>{r.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {list.length === 0 && <span className="text-xs text-zinc-400">팀이 없어요</span>}
                {list.map(t => {
                  const on = isOn(t);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={editingSelf}
                      onClick={() => { if (t.key !== "worker") { toggleTeam(t.key); return; } if (fieldCur) { toggleTeam(fieldCur); setFieldSel([]); } else { toggleTeam("worker"); setFieldSel(["worker"]); } }}
                      className={`${chipBase} px-3.5 py-1.5 text-[15px] ${on ? chipOn : chipOff}`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {editingSelf && <p className="mt-2 text-xs text-zinc-500 sm:col-span-2">내 팀은 직접 바꿀 수 없어요.</p>}
      {hasField && scope !== "coop" && (
        <>
          <div className="mt-4">
<label htmlFor="msafety" className="block text-sm font-bold">안전교육 이수일 <span className="font-normal text-zinc-500">(현장, 선택)</span></label>
          <input id="msafety" type="date" value={safetyDate} onChange={e => setSafetyDate(e.target.value)} className={inputCls} />
</div>
          <div className="mt-4">
<label htmlFor="mlicense" className="block text-sm font-bold">운전면허 <span className="font-normal text-zinc-500">(현장, 선택)</span></label>
          <select id="mlicense" value={license} onChange={e => setLicense(e.target.value)} className={inputCls}>
            <option value="">없음</option>
            {[...LICENSES, ...(license && !LICENSES.includes(license) ? [license] : [])].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
</div>
        </>
      )}

      </div>
      <div className={tab === "menu" ? "" : "hidden"} role="tabpanel">
      <div className="mt-4 text-sm font-bold">
        메뉴 부여 <span className="font-normal text-zinc-500">(선택) · 팀 기본 메뉴는 항상 쓸 수 있어요</span>
      </div>
      {/* 템플릿: 자주 쓰는 메뉴 조합을 저장해 두고 한 번에 적용 */}
      <div className="mt-2 rounded-xl border border-black/10 p-3 dark:border-white/10">
        <div className="text-xs font-bold text-zinc-500">권한 템플릿 <span className="font-normal">· 눌러서 적용 (현재 부여 설정은 바뀌어요)</span></div>
        {tpls.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {tpls.map(t => (
              <span key={t.id} className="inline-flex items-center overflow-hidden rounded-full border border-black/10 dark:border-white/10">
                <button type="button" onClick={() => applyTpl(t)} title={t.menus.map(menuLabel).join(", ")} className="px-3 py-1.5 text-sm font-semibold hover:bg-blue-50 dark:hover:bg-blue-500/15">
                  {t.name}<small className="ml-1 text-zinc-500">{t.menus.length}</small>
                </button>
                <button type="button" aria-label={`${t.name} 템플릿 삭제`} onClick={() => saveTpls(tpls.filter(x => x.id !== t.id))} className="px-2 py-1.5 text-zinc-400 hover:text-red-600">✕</button>
              </span>
            ))}
          </div>
        ) : <p className="mt-1 text-xs text-zinc-400">저장된 템플릿이 없어요.</p>}
        <div className="mt-2 flex gap-2">
          <input value={tplName} onChange={e => setTplName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveTpl(); } }} maxLength={20} placeholder="현재 부여 설정을 템플릿으로 저장 (이름)" aria-label="템플릿 이름" className="min-w-0 flex-1 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/15" />
          <button type="button" onClick={saveTpl} className="rounded-xl bg-zinc-100 px-3 py-2 text-sm font-bold dark:bg-zinc-800">저장</button>
        </div>
      </div>
      {scope === "coop" && <p className="mt-1 text-xs text-zinc-500">거래처도 메뉴를 부여할 수 있어요. 로그인해서 쓰려면 목록에서 ‘아이디 생성’으로 아이디를 만들어야 해요.</p>}
      {/* 대분류(운영관리·현장관리·인사관리·기타) 아래에 소분류 메뉴를 고른다 */}
      <div className="mt-2 space-y-2.5">
        {(["운영관리", "현장관리", "인사관리", null] as const).map(g => {
          const list = MENUS.filter(mn => (menuParent(mn.key) ?? null) === g);
          if (list.length === 0) return null;
          const pickable = list.filter(mn => mn.grantable && !isLocked(mn.key)); // 팀 기본·전용 메뉴는 고를 수 없다
          const onCount = list.filter(mn => allBase.includes(mn.key) || menus.includes(mn.key)).length;
          const allOn = pickable.length > 0 && pickable.every(mn => modeOf(mn.key) === "all");
          return (
            <div key={g ?? "etc"} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-blue-600 dark:text-blue-300">{g ?? "기타"}</span>
                <small className="text-zinc-500">{onCount}/{list.length}</small>
                {pickable.length > 0 && (
                  <button type="button" onClick={() => pickable.forEach(mn => setMode(mn.key, allOn ? "none" : "all"))} className="ml-auto rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">{allOn ? "전체 해제" : "전체 모든 권한"}</button>
                )}
              </div>
              <div className="mt-1 divide-y divide-black/5 dark:divide-white/10">
                {list.map(mn => {
                  const base = isLocked(mn.key);
                  if (base || !mn.grantable) {
                    return (
                      <div key={mn.key} className="flex items-center gap-2 py-2 text-[15px] opacity-60">
                        <span className="mr-auto">{mn.label}</span>
                        <small>{base ? "팀 기본 · 모든 권한" : "전용"}</small>
                      </div>
                    );
                  }
                  const k = mn.key;
                  const mode = modeOf(k);
                  const opts: [Mode, string][] = k === "sites" && sitesUpgradable ? [["none", "보기만 (팀 기본)"], ["all", "전체 권한 부여"]] : MENU_ACTIONS[k].length > 1 && k !== "members" && k !== "suppliers" && k !== "catalog" ? [["none", "부여 안 함"], ["partial", "일부 권한"], ["all", "모든 권한"]] : [["none", "부여 안 함"], ["all", k === "staff" || k === "members" || k === "payroll" || k === "suppliers" || k === "catalog" ? "부여" : "사용"]];
                  return (
                    <div key={k} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-auto text-[15px] font-semibold">{mn.label}</span>
                        <div className="inline-flex overflow-hidden rounded-lg border border-black/10 text-sm dark:border-white/10" role="radiogroup" aria-label={`${mn.label} 권한`}>
                          {opts.map(([m, label]) => (
                            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(k, m)} className={`px-3 py-1.5 font-bold ${mode === m ? (m === "none" ? "bg-zinc-600 text-white" : "bg-blue-600 text-white") : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {(roleMenus(role).includes("catalog") || roleMenus(role).includes("members")) && (
        <p className="mt-2 text-xs text-zinc-500">이 팀은 소모품·회원 관리의 모든 동작(보기·등록·수정·삭제)이 기본으로 허용돼요.</p>
      )}

      </div>
      <div className={tab === "pay" ? "" : "hidden"} role="tabpanel">
      {scope !== "coop" && (() => {
        const eff = effectivePay(teams, { role, payType });
        const def = effectivePay(teams, { role, payType: "" }); // 팀 기본: 사무실 → 4대보험 사무직 기준, 현장 → 일수제(일당)
        return (
          <>
            <div className="mt-4">
              <div className="text-sm font-bold">급여 기준 <span className="font-normal text-zinc-500">· 일수로 계산할지, 4대보험 사무직 기준인지</span></div>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="급여 기준">
                {PAY_TYPES.map(p => (
                  <motion.button key={p.v} type="button" role="radio" aria-checked={eff === p.v} onClick={() => setPayType(p.v === def ? "" : p.v)} className={`${chipBase} px-4 py-2 text-[15px] ${eff === p.v ? chipOn : chipOff}`}>
                    {p.label}{p.v === def && <small className="ml-1 opacity-80">· 기본</small>}
                  </motion.button>
                ))}
              </div>
              <label htmlFor="mpay" className="mt-4 block text-sm font-bold">{eff === "office" ? "월급" : "일당"} <span className="font-normal text-zinc-500">· {eff === "office" ? "4대보험 사무직 기준 월 급여" : "하루 일한 값"} (선택)</span></label>
              <div className="mt-1.5 flex items-center gap-2">
                <input id="mpay" inputMode="numeric" value={payAmountNow === "" ? "" : Number(payAmountNow).toLocaleString("ko-KR")} onChange={e => setPayAmount(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 10))} placeholder="미설정" autoComplete="off" className="w-48 rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
                <span className="text-sm font-bold">원</span>
                {!manage && payAmountNow !== "" && Number(payAmountNow) !== (eff === "office" ? monthlyDefault : dailyDefault) && <button type="button" disabled={busy} onClick={() => saveDailyDefault(eff === "office" ? { monthly: payAmountNow } : { daily: payAmountNow })} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">기본값으로 저장</button>}
              </div>
              {editId && (() => {
                const em = members.find(x => x.id === editId);
                if (!em) return null;
                const changed = em.payAmount > 0 && Number(payAmountNow || 0) !== em.payAmount;
                const hist = [...(em.payHistory ?? [])].filter(e => e.from !== "" || (em.payHistory ?? []).length > 1).reverse();
                const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
                return (
                  <>
                    {changed && (
                      <div className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
                        <div className="font-bold">언제부터 적용할까요?</div>
                        <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="적용 시점">
                          <button type="button" role="radio" aria-checked={payWhen === "next"} onClick={() => setPayWhen("next")} className={`rounded-full border px-3 py-1 font-bold ${payWhen === "next" ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>다음 급여 기간부터{nextPayFrom && ` (${nextPayFrom}~)`}</button>
                          <button type="button" role="radio" aria-checked={payWhen === "now"} onClick={() => setPayWhen("now")} className={`rounded-full border px-3 py-1 font-bold ${payWhen === "now" ? "border-blue-600 bg-blue-600 text-white" : "border-black/15 bg-white dark:border-white/15 dark:bg-zinc-900"}`}>이번 급여 기간부터{currentPayFrom && ` (${currentPayFrom}~)`}</button>
                        </div>
                        <p className="mt-1">{payWhen === "now" ? "이번 급여 기간 전체에 새 금액이 적용돼요 (이미 계산된 이번 기간 급여도 바뀌어요)." : `그 전까지는 지금 금액(${em.payAmount.toLocaleString("ko-KR")}원)이 그대로예요.`}</p>
                      </div>
                    )}
                    {(em.payHistory ?? []).length > 1 && (
                      <details className="mt-1.5 text-xs">
                        <summary className="cursor-pointer font-bold text-zinc-500">금액 변경 이력 {(em.payHistory ?? []).length - 1}건</summary>
                        <ul className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-300">
                          {hist.map((e, i) => (
                            <li key={i}>{e.from ? `${e.from}부터` : "처음부터"} <b>{e.amount.toLocaleString("ko-KR")}원</b>{e.from > todayStr && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">예정</span>}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                );
              })()}
              {eff === "office" && Number(payAmountNow) > 0 && (() => {
                const t = netPay(Number(payAmountNow));
                const won = (n: number) => n.toLocaleString("ko-KR") + "원";
                return (
                  <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-500/10">
                    <div className="text-xs font-bold text-zinc-500">세후 계산 <span className="font-normal">· 4대보험 근로자 부담분을 뺀 금액 (소득세 제외)</span></div>
                    <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
                      <dt className="text-zinc-600 dark:text-zinc-300">세전 월급</dt><dd className="text-right font-semibold">{won(Number(payAmountNow))}</dd>
                      <dt className="text-zinc-500">국민연금 (4.75%)</dt><dd className="text-right text-zinc-600 dark:text-zinc-300">− {won(t.pension)}</dd>
                      <dt className="text-zinc-500">건강보험 (3.595%)</dt><dd className="text-right text-zinc-600 dark:text-zinc-300">− {won(t.health)}</dd>
                      <dt className="text-zinc-500">장기요양 (건강보험료의 13.14%)</dt><dd className="text-right text-zinc-600 dark:text-zinc-300">− {won(t.care)}</dd>
                      <dt className="text-zinc-500">고용보험 (0.9%)</dt><dd className="text-right text-zinc-600 dark:text-zinc-300">− {won(t.employ)}</dd>
                    </dl>
                    <div className="mt-2 flex items-baseline justify-between border-t border-emerald-200 pt-2 dark:border-emerald-500/30">
                      <span className="font-bold">실질 세후 금액 <small className="font-normal text-zinc-500">(공제 {won(t.total)})</small></span>
                      <span className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{won(t.net)}</span>
                    </div>
                  </div>
                );
              })()}
              <div className="mt-4 text-sm font-bold">급여 계좌 <span className="font-normal text-zinc-500">· 급여를 보낼 계좌 (선택)</span></div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
                  {bbPreview && !bbRemove ? <a href={bbPreview} target="_blank" rel="noreferrer" title="눌러서 크게 보기"><img src={bbPreview} alt="통장 사본" className="h-16 w-24 object-cover" /></a> : <span>통장 사본</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold dark:bg-zinc-800">
                    {bbPreview && !bbRemove ? "사본 바꾸기" : "통장 사본 등록"}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      if (bbPreview.startsWith("blob:")) URL.revokeObjectURL(bbPreview);
                      setBbFile(f);
                      setBbPreview(URL.createObjectURL(f));
                      setBbRemove(false);
                    }} />
                  </label>
                  {!editId && <button type="button" onClick={() => { setCamFor("bankbook"); setCamOpen(true); }} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-bold dark:bg-zinc-800">카메라 촬영</button>}
                  {bbPreview && !bbRemove && <button type="button" onClick={() => { if (bbPreview.startsWith("blob:")) URL.revokeObjectURL(bbPreview); setBbFile(null); setBbPreview(""); setBbRemove(true); }} className="rounded-lg px-3 py-1.5 text-sm font-bold text-red-600">삭제</button>}
                  <span className="basis-full text-xs text-zinc-500">선택 · 계좌번호가 보이는 통장 첫 장{editId ? "" : " (파일을 고르거나 바로 촬영)"}</span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[8rem_1fr] gap-2">
                <select aria-label="은행" value={bank} onChange={e => setBank(e.target.value)} className="rounded-xl border border-black/15 bg-transparent px-3 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15">
                  <option value="">은행 선택</option>
                  {[...BANKS, ...(bank && !BANKS.includes(bank) ? [bank] : [])].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
                <input aria-label="계좌번호" inputMode="numeric" value={accountNo} onChange={e => setAccountNo(e.target.value.replace(/[^0-9-]/g, "").slice(0, 30))} placeholder="계좌번호 (숫자만)" autoComplete="off" className="min-w-0 rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15" />
              </div>
              <input aria-label="예금주" value={accountHolder || name} onChange={e => setAccountHolder(e.target.value)} maxLength={20} placeholder="예금주" autoComplete="off" className={inputCls} />
              {eff === "office" && (
                <div className="mt-4 rounded-xl bg-violet-50 p-3 dark:bg-violet-500/10">
                  <label htmlFor="mannual" className="block text-sm font-bold">연차 잔여 <span className="font-normal text-zinc-500">· {leaveYear ?? new Date().getFullYear()}년 · 휴가를 쓸 때마다 자동으로 차감돼요</span></label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input id="mannual" inputMode="decimal" value={annualRemain} onChange={e => setAnnualRemain(e.target.value.replace(/[^\d.]/g, ""))} placeholder="미설정" autoComplete="off" className="w-28 rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-right text-lg font-extrabold outline-none focus:border-violet-500 dark:border-white/15 dark:bg-zinc-900" />
                    <span className="text-sm font-bold">일</span>
                    {editId && balances[editId] && (balances[editId].total !== null || balances[editId].used > 0) && <span className="text-xs text-zinc-500">총 {balances[editId].total ?? "—"}일 · 사용 {balances[editId].used}일</span>}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">남은 연차 일수(0.5 단위). 휴가를 승인할 때마다 줄고, 비우면 제한 없이 신청돼요.</p>
                </div>
              )}
              <p className="mt-1.5 text-xs text-zinc-500">지금 적용: <b>{payTypeLabel(eff)}</b>{payType === "" ? " · 팀 기본 (사무실은 4대보험 사무직 기준, 현장은 일당)" : " · 직접 지정"}</p>
            </div>
          </>
        );
      })()}

      </div>
      </div>

      <AnimatePresence>
        {err && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden text-sm text-red-500" role="alert">
            <span className="block pt-3">{err}</span>
          </motion.p>
        )}
      </AnimatePresence>

      <div className="mt-2 flex shrink-0 gap-2 border-t border-black/10 pt-3 dark:border-white/10">
        <button type="button" onClick={resetForm} className="rounded-xl bg-zinc-100 px-5 py-3 font-bold dark:bg-zinc-800">취소</button>
        {nextTab ? (
          <button type="button" onClick={() => setFtab(nextTab)} className="flex-1 rounded-xl bg-zinc-900 py-3 text-base font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">다음 · {tabList.find(t => t[0] === nextTab)?.[1]}</button>
        ) : (
          <motion.button disabled={busy} className="flex-1 rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-50">
            {busy ? "처리 중…" : editId ? "저장" : scope === "coop" || password ? "등록" : "등록 · 아이디/임시 비밀번호 발급"}
          </motion.button>
        )}
      </div>
    </form>
  );

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-3 py-5">
        <h1 className="mr-auto text-xl font-extrabold">{scope === "coop" ? "거래처 관리" : manage ? "회원정보 확인" : "회원등록 및 수정"}</h1>
        <span className="text-sm text-zinc-500">총 {activeScoped.length}명{resignedCount > 0 && ` · 퇴사 ${resignedCount}명`}</span>
        {!manage && <button type="button" onClick={startCreate} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">+ {noun} 등록</button>}
      </header>

      {manage && (() => {
        const field = activeScoped.filter(m => memberHasGroup(teams, m, "field"));
        const noSafety = field.filter(m => !m.safetyDate).length;
        const noBank = activeScoped.filter(m => !m.accountNo).length;
        const card = (on: boolean, warn = false) => `rounded-2xl border p-3 text-left transition-colors ${on ? "border-blue-600 bg-blue-600 text-white" : warn ? "border-amber-300 bg-amber-50 text-zinc-900 hover:border-amber-400 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-zinc-100" : "border-black/10 bg-white hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900"}`;
        const go = (fn: () => void) => () => { setIssue(""); setDualTab(false); fn(); };
        return (
          <section className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="회원 현황">
            <button type="button" onClick={go(() => pickGroup("all"))} className={card(!tabResigned && !issue && !dualTab && group === "all")}><div className="text-xs opacity-80">재직</div><div className="text-2xl font-extrabold">{activeScoped.length}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
            <button type="button" onClick={go(() => pickGroup("office"))} className={card(!tabResigned && !issue && !dualTab && group === "office")}><div className="text-xs opacity-80">사무실</div><div className="text-2xl font-extrabold">{groupCount("office")}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
            <button type="button" onClick={go(() => pickGroup("field"))} className={card(!tabResigned && !issue && group === "field")}><div className="text-xs opacity-80">현장</div><div className="text-2xl font-extrabold">{groupCount("field")}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
            <button type="button" onClick={() => { setIssue(""); setTabResigned(false); setGroup("all"); setFilter("all"); setDualTab(true); }} className={card(dualTab && !issue)}><div className="text-xs opacity-80">사무실겸현장</div><div className="text-2xl font-extrabold">{dualCount}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
            <button type="button" onClick={go(() => { setTabResigned(true); setGroup("all"); setFilter("all"); })} className={card(tabResigned && !issue)}><div className="text-xs opacity-80">퇴사</div><div className="text-2xl font-extrabold">{resignedCount}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
            <button type="button" onClick={() => { setTabResigned(false); setDualTab(false); setGroup("all"); setFilter("all"); setIssue(issue === "safety" ? "" : "safety"); }} className={card(issue === "safety", noSafety > 0)}><div className="text-xs opacity-80">안전교육 미이수</div><div className="text-2xl font-extrabold">{noSafety}<small className="ml-0.5 text-sm font-bold">명</small></div></button>
          </section>
        );
      })()}



      {/* 팀 관리: 구분(사내/거래처)·부서(사무실/현장/거래처)는 고정, 팀명만 추가·삭제 */}
      {!manage && scope !== "coop" && (
        <section className="mt-4 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="text-base font-bold">기본 급여 <span className="text-sm font-normal text-zinc-500">· 초봉 기준</span></h2>
          <p className="text-xs text-zinc-500">새 회원 등록 때 급여 칸에 미리 들어가요.</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-bold">초봉 일당
              <input aria-label="초봉 일당" inputMode="numeric" value={dailyEdit === "" ? "" : Number(dailyEdit).toLocaleString("ko-KR")} onChange={e => setDailyEdit(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=[0-9])/, "").slice(0, 9))} placeholder="미설정" autoComplete="off" className="w-32 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-base font-normal outline-none focus:border-blue-500 dark:border-white/15" />
              <span>원</span>
            </label>
            <label className="flex items-center gap-2 text-sm font-bold">사무직 초봉 월급 <small className="font-normal text-zinc-500">(세전)</small>
              <input aria-label="사무직 초봉 월급 (세전)" inputMode="numeric" value={monthlyEdit === "" ? "" : Number(monthlyEdit).toLocaleString("ko-KR")} onChange={e => setMonthlyEdit(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=[0-9])/, "").slice(0, 9))} placeholder="미설정" autoComplete="off" className="w-32 rounded-xl border border-black/15 bg-transparent px-3 py-2 text-base font-normal outline-none focus:border-blue-500 dark:border-white/15" />
              <span>원</span>
            </label>
            <button type="button" disabled={busy || ((dailyEdit === "" ? 0 : Number(dailyEdit)) === dailyDefault && (monthlyEdit === "" ? 0 : Number(monthlyEdit)) === monthlyDefault)} onClick={() => saveDailyDefault()} className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">저장</button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">사무직 월급은 세전 금액이에요.{Number(monthlyEdit) > 0 && <> 세후 <b className="text-emerald-700 dark:text-emerald-300">{netPay(Number(monthlyEdit)).net.toLocaleString("ko-KR")}원</b></>}</p>
        </section>
      )}

      {!manage && (
      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <button type="button" onClick={() => setTeamsOpen(o => !o)} aria-expanded={teamsOpen} className="flex w-full items-center gap-2 text-left">
          <h2 className="mr-auto text-base font-bold">팀 등록하기</h2>
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
                          <button type="button" onClick={() => setOpenGroups(p => ({ ...p, [g.key]: !p[g.key] }))} aria-expanded={!!openGroups[g.key]} className="flex w-full items-center gap-2 text-left text-sm font-bold text-zinc-600 dark:text-zinc-300">
                            <span className="mr-auto">{g.label}</span>
                            <span className="text-xs font-normal text-zinc-500">팀 {teamsIn(uiTeams, g.key).length}개</span>
                            <span className="text-zinc-400" aria-hidden>{openGroups[g.key] ? "▴" : "▾"}</span>
                          </button>
                          {openGroups[g.key] && <>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {teamsIn(uiTeams, g.key).map(t => (
                              <span key={t.key} className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-zinc-50 py-1 pl-3 pr-2 text-sm dark:border-white/10 dark:bg-zinc-800/60">
                                {t.label}
                                <small className="text-zinc-500">{teamCount(t.key)}명</small>
                                {g.key === "field" && !isFieldRole(t.key) && (
                                  canManageTeams ? (
                                    <button type="button" onClick={() => { setTradeErr(""); setTradeSel(t.trades ?? []); setTradeTeam(t); }} title="이 팀이 관여하는 공정 정하기" className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300">공정 {tradesText(t.trades ?? []) || "설정"}</button>
                                  ) : (t.trades ?? []).length > 0 && <small className="text-zinc-500">공정 {tradesText(t.trades ?? [])}</small>
                                )}
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
                            {teamsIn(uiTeams, g.key).length === 0 && <span className="text-xs text-zinc-400">팀이 없어요</span>}
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
                              <motion.button disabled={busy || !(newTeam[g.key] ?? "").trim()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">+ 팀 추가</motion.button>
                            </form>
                          )}
                          {teamErr?.group === g.key && <p className="mt-1.5 text-sm text-red-500" role="alert">{teamErr.text}</p>}
                          </>}
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
      )}

      <button type="button" onClick={() => setListOpen(o => !o)} aria-expanded={listOpen} className="mt-8 flex w-full items-center gap-2 text-left">
        <h2 className="mr-auto text-base font-bold">{manage || scope === "coop" ? `${noun} 목록` : "생성된 회원 목록"}</h2>
        <span className="text-sm text-zinc-500">{tabResigned ? resignedCount : activeScoped.length}명</span>
        <span className="text-zinc-400" aria-hidden>{listOpen ? "▴" : "▾"}</span>
      </button>
      <AnimatePresence initial={false}>
      {listOpen && (
      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mt-3 flex gap-2">
      <input
        type="search"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={scope === "coop" ? "거래처 이름으로 검색" : "회원 이름으로 검색"}
        aria-label="이름 검색"
        className="min-w-0 flex-1 rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900"
      />
      {group !== "all" && !tabResigned && !dualTab && (
        <select aria-label={`${groupLabel(group)} 팀`} value={filter} onChange={e => setFilter(e.target.value)} className="w-40 shrink-0 rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-white/15 dark:bg-zinc-900">
          <option value="all">{groupLabel(group)} 전체 ({groupCount(group)})</option>
          {teamsIn(uiTeams, group).map(t => <option key={t.key} value={t.key}>{t.label} ({teamCount(t.key)})</option>)}
        </select>
      )}
      </div>
      {scope === "inhouse" && !manage && (
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" aria-label={`${sideLabel(scope)} 부서`}>
          <button type="button" onClick={() => pickGroup("all")} className={`${chipBase} text-[13px] ${group === "all" && !tabResigned && !dualTab ? chipOn : chipOff}`}>{sideLabel(scope)} 전체<small className="ml-1 opacity-70">{activeScoped.length}</small></button>
          {groupsIn(scope).map(g => (
            <button key={g.key} type="button" onClick={() => pickGroup(g.key)} className={`${chipBase} text-[13px] ${group === g.key && !tabResigned && !dualTab ? chipOn : chipOff}`}>
              {g.label}<small className="ml-1 opacity-70">{groupCount(g.key)}</small>
            </button>
          ))}
          <button type="button" onClick={() => { setTabResigned(false); setDualTab(true); setGroup("all"); setFilter("all"); }} className={`${chipBase} text-[13px] ${dualTab ? chipOn : chipOff}`}>사무실겸현장<small className="ml-1 opacity-70">{dualCount}</small></button>
          <button type="button" onClick={() => { setDualTab(false); setTabResigned(true); setGroup("all"); setFilter("all"); }} className={`${chipBase} text-[13px] ${tabResigned ? chipOn : chipOff}`}>퇴사<small className="ml-1 opacity-70">{resignedCount}</small></button>
        </div>
      )}

      <div className="mt-3 grid gap-3">
        {!manage && builtinId && scope === "inhouse" && (!kw || "내장최고관리자".includes(kw) || builtinId.includes(kw)) && (group === "all" || group === "office") && (filter === "all" || filter === "super") && (
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
        {manage && listed.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {listed.map(m => {
              const eff = effectivePay(teams, m);
              const isField = memberHasGroup(teams, m, "field");
              const tn = tenure(m.hireDate, m.resignDate || undefined);
              const wd = workDays(m.hireDate, m.resignDate || undefined);
              return (
                <article key={m.id} className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
                  <div className="flex items-start gap-3">
                    {m.photo ? <img src={m.photo} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full bg-zinc-100 object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xl text-zinc-400 dark:bg-zinc-800" aria-hidden>👤</span>}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <b className="text-lg">{m.name}</b>
                        {m.position && <span className="text-sm text-zinc-600 dark:text-zinc-300">{m.position}</span>}
                        {m.id === selfId && <span className={tagCls}>나</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-blue-700 dark:text-blue-300">{teamsLabel(teams, m)}{m.officeStatus && <span className="ml-1 text-xs text-zinc-500">({officeStatusLabel(m.officeStatus)})</span>}</div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {tabResigned && !manage && <button type="button" disabled={busy} onClick={() => reinstate(m)} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600 disabled:opacity-35 dark:bg-blue-500/15 dark:text-blue-300">복직</button>}
                      {m.phone && <a href={`tel:${m.phone.replace(/[^0-9+]/g, "")}`} className="rounded-lg bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title={`${m.name}님께 전화 (${m.phone})`}>전화하기</a>}
                      <button type="button" onClick={() => setViewMember(m)} className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-bold dark:bg-zinc-800">자세히 보기</button>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
                    <dt className="text-xs font-bold leading-5 text-zinc-500">{tabResigned ? "재직기간" : "입사일"}</dt>
                    <dd>{m.hireDate || <span className="text-zinc-400">—</span>}{tabResigned && m.resignDate && <> ~ {m.resignDate}</>}{tn && <span className="ml-1.5 text-xs text-zinc-500">({tn}{tabResigned ? " 근무" : ""}{wd != null && ` · ${wd.toLocaleString("ko-KR")}일${tabResigned ? "" : "째"}`})</span>}</dd>
                    <dt className="text-xs font-bold leading-5 text-zinc-500">아이디</dt>
                    <dd><code className="text-[13px] font-semibold">{m.loginId ?? "—"}</code></dd>
                    <dt className="text-xs font-bold leading-5 text-zinc-500">연락처</dt>
                    <dd>{m.phone || <span className="text-zinc-400">—</span>}</dd>
                    <dt className="text-xs font-bold leading-5 text-zinc-500">{eff === "office" ? "월급" : "일당"}</dt>
                    <dd>
                      {(() => {
                        const cur = payOn(m, new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
                        if (cur <= 0) return <span className="text-zinc-400">미설정</span>;
                        if (eff !== "office") return <b>{cur.toLocaleString("ko-KR")}원</b>;
                        return <><span className="text-zinc-500">세전</span> <b>{cur.toLocaleString("ko-KR")}원</b> <span className="mx-1 text-zinc-400">→</span><span className="text-zinc-500">세후</span> <b className="text-emerald-700 dark:text-emerald-300">{netPay(cur).net.toLocaleString("ko-KR")}원</b></>;
                      })()}
                    </dd>
                    {isField && (
                      <>
                        <dt className="text-xs font-bold leading-5 text-zinc-500">현장</dt>
                        <dd className="flex flex-wrap gap-x-3">
                          <span>안전교육 {m.safetyDate ? <b>{m.safetyDate}</b> : <span className="text-amber-600 dark:text-amber-300">미이수</span>}</span>
                          <span>면허 {m.license ? <b>{m.license}</b> : <span className="text-zinc-400">없음</span>}</span>
                        </dd>
                      </>
                    )}
                    {(m.history ?? []).length > 0 && (
                      <>
                        <dt className="text-xs font-bold leading-5 text-zinc-500">이력</dt>
                        <dd className="text-xs text-zinc-500">퇴사·복직 {m.history.length}회 (최근 {m.history[m.history.length - 1].hire || "—"} ~ {m.history[m.history.length - 1].resign})</dd>
                      </>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
        {!manage && scope !== "coop" && !tabResigned && selIds.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm dark:bg-blue-500/10">
            <b className="text-blue-700 dark:text-blue-300">{selIds.length}명 선택</b>
            <button type="button" onClick={() => { setBulkSel({}); setBulkOpen(true); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">메뉴 권한 일괄 수정</button>
            <button type="button" onClick={() => setSelIds([])} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-800">선택 해제</button>
          </div>
        )}
        {!manage && scope !== "coop" && listed.length > 0 && (
          <div className="no-scrollbar overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
            <table className={`w-full ${manage ? "min-w-[56rem]" : "min-w-[56rem]"} border-collapse text-left text-sm`}>
              <thead>
                <tr className="border-b border-black/10 bg-zinc-50 text-xs text-zinc-500 dark:border-white/10 dark:bg-zinc-800/60">
                  {!tabResigned && (
                    <th className="w-9 px-3 py-2.5">
                      <input type="checkbox" aria-label="이 목록 전체 선택" checked={listed.filter(m => m.id !== selfId).length > 0 && listed.filter(m => m.id !== selfId).every(m => selIds.includes(m.id))} onChange={e => setSelIds(e.target.checked ? listed.filter(m => m.id !== selfId).map(m => m.id) : [])} className="h-4 w-4 accent-blue-600" />
                    </th>
                  )}
                  <th className="w-10 whitespace-nowrap px-2 py-2.5 text-center font-bold">#</th>
                  <SortTh k="name">이름</SortTh>
                  <SortTh k="team">팀</SortTh>
                  {manage ? (
                    <>
                      <SortTh k="position">직급</SortTh>
                      <SortTh k="loginId">아이디</SortTh>
                      <SortTh k="hire">입사일</SortTh>
                      <th className="whitespace-nowrap px-3 py-2.5 font-bold">급여</th>
                      <th className="whitespace-nowrap px-3 py-2.5 font-bold">연차 잔여</th>
                      <SortTh k="phone">연락처</SortTh>
                      <th className="whitespace-nowrap px-3 py-2.5 font-bold">주소</th>
                    </>
                  ) : (
                    <>
                      <SortTh k="position">직급</SortTh>
                      <SortTh k="loginId">아이디</SortTh>
                      <SortTh k="phone">연락처</SortTh>
                      <SortTh k="hire">입사일</SortTh>
                      <SortTh k="created">생성일</SortTh>
                    </>
                  )}
                  {tabResigned && <th className="whitespace-nowrap px-3 py-2.5 font-bold">퇴사일</th>}
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {listed.map((m, i, arr) => {
                  const isMe = m.id === selfId;
                  const teamHead = !sort && group === "field" && (i === 0 || tradeOf(arr[i - 1]) !== tradeOf(m)); // 공정이 바뀔 때 제목 줄을 넣는다
                  const bal = balances[m.id];
                  return (
                    <Fragment key={m.id}>
                      {teamHead && (
                        <tr className="border-b border-black/10 bg-blue-50/60 dark:border-white/10 dark:bg-blue-500/10">
                          <td colSpan={(manage ? 10 : 8) + (tabResigned ? 1 : 0) + (tabResigned ? 0 : 1) + 1} className="px-3 py-1.5 text-xs font-extrabold text-blue-700 dark:text-blue-300">{tradeOf(m) ? tradeOf(m) + "팀" : "공정 미지정"} <span className="font-normal text-zinc-500">{arr.filter(x => tradeOf(x) === tradeOf(m)).length}명</span></td>
                        </tr>
                      )}
                      <tr className="border-b border-black/5 align-top last:border-0 hover:bg-zinc-50/70 dark:border-white/5 dark:hover:bg-zinc-800/40">
                        {!tabResigned && (
                          <td className="px-3 py-2.5">
                            <input type="checkbox" aria-label={`${m.name} 선택`} disabled={isMe} title={isMe ? "내 권한은 여기서 바꿀 수 없어요" : undefined} checked={selIds.includes(m.id)} onChange={e => setSelIds(p => (e.target.checked ? [...p, m.id] : p.filter(x => x !== m.id)))} className="h-4 w-4 accent-blue-600 disabled:opacity-30" />
                          </td>
                        )}
                        <td className="px-2 py-2.5 text-center text-xs text-zinc-400">{i + 1}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-bold">
                          {m.photo ? <img src={m.photo} alt="" loading="lazy" className="mr-2 inline-block h-7 w-7 rounded-full bg-zinc-100 object-cover align-middle" /> : <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 align-middle text-xs text-zinc-400 dark:bg-zinc-800" aria-hidden>👤</span>}
                          {m.name}
                          {isMe && <span className={`${tagCls} ml-1.5 align-middle`}>나</span>}
                          {!manage && m.mustChangePassword && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">임시 비번</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-blue-700 dark:text-blue-300">
                          {[...memberRoles(m).filter(r => !isFieldRole(r)), ...(memberRoles(m).some(isFieldRole) && !memberRoles(m).some(r => !isFieldRole(r) && teamGroup(teams, r) === "field") ? ["__field"] : [])].map((r, ri) => (
                            <span key={r}>
                              {ri > 0 && " · "}
                              {r === "__field" ? (
                                <>현장팀{FIELD_ROLES.filter(x => memberRoles(m).includes(x.key)).map(x => <span key={x.key} className={`ml-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${FIELD_TAG[x.key]}`}>{x.label}</span>)}</>
                              ) : (
                                <>{teamLabel(teams, r)}{teamGroup(teams, r) === "field" && FIELD_ROLES.filter(x => memberRoles(m).includes(x.key)).map(x => <span key={x.key} className={`ml-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${FIELD_TAG[x.key]}`}>{x.label}</span>)}{teamGroup(teams, r) === "office" && m.officeStatus && <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-bold ${m.officeStatus === "probation" ? "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"}`}>{officeStatusLabel(m.officeStatus)}</span>}</>
                              )}
                            </span>
                          ))}
                        </td>
                        {manage ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5">{m.position || <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5"><code className="text-[13px] font-semibold">{m.loginId ?? "—"}</code></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{m.hireDate || <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{effectivePay(teams, m) === "office" ? "4대보험 사무직" : "일수제"}{m.payAmount > 0 && <span className="ml-1 font-semibold text-zinc-800 dark:text-zinc-100">· {effectivePay(teams, m) === "office" ? "월 " : "일당 "}{m.payAmount.toLocaleString("ko-KR")}원{effectivePay(teams, m) === "office" && <small className="ml-1 font-normal text-emerald-700 dark:text-emerald-300">(세후 {netPay(m.payAmount).net.toLocaleString("ko-KR")}원)</small>}</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{effectivePay(teams, m) === "office" && bal?.total != null ? `${bal.total - bal.used} / ${bal.total}일` : <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-300">{m.phone || <span className="text-zinc-400">—</span>}</td>
                            <td className="min-w-[10rem] px-3 py-2.5 text-zinc-700 dark:text-zinc-300">{m.address || <span className="text-zinc-400">—</span>}</td>
                          </>
                        ) : (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5">{m.position || <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5"><code className="text-[13px] font-semibold">{m.loginId ?? "—"}</code></td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-300">{m.phone || <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{m.hireDate || <span className="text-zinc-400">—</span>}</td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-300">{m.createdAt ? m.createdAt.slice(0, 10) : "—"}</td>
                          </>
                        )}
                        {tabResigned && <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-amber-700 dark:text-amber-300">{m.resignDate}</td>}
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <button type="button" onClick={() => (tabResigned ? setViewMember(m) : startEdit(m))} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-bold dark:bg-zinc-800">{tabResigned ? "자세히 보기" : "수정"}</button>
                            {tabResigned && <button type="button" disabled={busy} onClick={() => reinstate(m)} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600 disabled:opacity-35 dark:bg-blue-500/15 dark:text-blue-300">복직</button>}
                            {tabResigned && !manage && <button type="button" disabled={busy} onClick={() => setConfirmPurge(m)} title="돌아오지 않는 경우: 기록을 완전히 지워요" className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-35 dark:bg-red-500/15 dark:text-red-300">삭제</button>}
                            {!manage && !tabResigned && <button type="button" disabled={isMe} onClick={() => setConfirmDel(m)} title={isMe ? "내 계정은 퇴사시킬 수 없어요" : undefined} className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 disabled:opacity-35 dark:bg-red-500/15 dark:text-red-300">퇴사</button>}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </motion.div>
      )}
      </AnimatePresence>

      {/* 메뉴 권한 일괄 수정: 고른 회원 모두에게 같은 권한을 적용 */}
      <Modal open={bulkOpen} onClose={() => !busy && setBulkOpen(false)} wide>
        <h2 className="text-lg font-bold">메뉴 권한 일괄 수정</h2>
        <p className="mt-1 text-sm text-zinc-500">{members.filter(m => selIds.includes(m.id)).map(m => m.name).join(", ")} <b>{selIds.length}명</b>에게 적용해요. 고르지 않은 메뉴는 그대로 둬요.</p>
        <div className="mt-3 space-y-2.5">
          {(["운영관리", "현장관리", "인사관리", null] as const).map(g => {
            const list = MENUS.filter(mn => mn.grantable && (menuParent(mn.key) ?? null) === g);
            if (list.length === 0) return null;
            return (
              <div key={g ?? "etc"} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
                <div className="text-sm font-extrabold text-blue-600 dark:text-blue-300">{g ?? "기타"}</div>
                <div className="mt-1 divide-y divide-black/5 dark:divide-white/10">
                  {list.map(mn => {
                    const k = mn.key;
                    const cur = bulkSel[k] ?? "keep";
                    const multi = MENU_ACTIONS[k].length > 1 && k !== "members" && k !== "suppliers" && k !== "catalog";
                    const opts: [BulkLevel, string][] = multi ? [["keep", "변경 안 함"], ["none", k === "inventory" ? "부여 안 함" : "회수"], ["view", k === "inventory" ? "일부" : "보기만"], ["all", "모든 권한"]] : [["keep", "변경 안 함"], ["none", "회수"], ["all", "부여"]];
                    return (
                      <div key={k} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="mr-auto text-[15px] font-semibold">{mn.label}</span>
                        <div className="inline-flex overflow-hidden rounded-lg border border-black/10 text-sm dark:border-white/10" role="radiogroup" aria-label={`${mn.label} 일괄 권한`}>
                          {opts.map(([v, label]) => (
                            <button key={v} type="button" role="radio" aria-checked={cur === v} onClick={() => setBulkSel(p => ({ ...p, [k]: v }))} className={`px-3 py-1.5 font-bold ${cur === v ? (v === "keep" || v === "none" ? "bg-zinc-600 text-white" : "bg-blue-600 text-white") : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}>{label}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" disabled={busy} onClick={() => setBulkOpen(false)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
          <button type="button" disabled={busy} onClick={() => void bulkApply()} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "적용 중…" : `${selIds.length}명에게 적용`}</button>
        </div>
      </Modal>

      {/* 회원 생성·수정: 팝업 */}
      <Modal open={editId !== null || createOpen} onClose={() => !busy && resetForm()} wide xl>
        {(editId !== null || createOpen) && formEl}
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
              <motion.button type="button" onClick={copyIssued} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">전체 복사</motion.button>
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
              <motion.button type="button" disabled={busy} onClick={doReset} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : confirmReset.loginId ? "재발급" : "생성"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={camOpen} onClose={() => setCamOpen(false)} wide>
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">카메라 촬영 <span className="text-sm font-normal text-zinc-500">· {camFor === "bankbook" ? "통장 사본" : "프로필 사진"}</span></h2>
          <button type="button" onClick={() => setCamOpen(false)} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
        </div>
        {camErr ? (
          <div className="mt-3">
            <p className="text-sm text-red-500" role="alert">{camErr}</p>
            <label className="mt-3 inline-block cursor-pointer rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-bold dark:bg-zinc-800">
              휴대폰 카메라 앱으로 촬영
              <input type="file" accept="image/*" capture={camFor === "bankbook" ? "environment" : "user"} className="sr-only" onChange={e => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) { if (camFor === "bankbook") pickBankbook(f); else pickPhoto(f); setCamOpen(false); }
              }} />
            </label>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="mt-3 w-full rounded-xl bg-black" style={camFor === "bankbook" ? undefined : { transform: "scaleX(-1)" }} />
            <p className="mt-1 text-xs text-zinc-500">{camFor === "bankbook" ? "통장 첫 장이 화면에 꽉 차고 글자가 또렷하게 보이게 맞춰 촬영을 눌러요." : "얼굴이 가운데 오게 맞추고 촬영을 눌러요."}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setCamOpen(false)} className="rounded-xl bg-zinc-100 px-5 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" onClick={snap} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white">촬영</button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={addrOpen} onClose={() => setAddrOpen(false)} wide>
        <div className="flex items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">도로명 주소 찾기</h2>
          <button type="button" onClick={() => setAddrOpen(false)} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
        </div>
        <p className="mt-1 text-xs text-zinc-500">도로명·건물명·지번으로 검색해 고르세요.</p>
        {addrErr ? <p className="mt-3 text-sm text-red-500" role="alert">{addrErr}</p> : <div ref={addrBox} className="mt-3 h-[28rem] max-h-[60vh] overflow-hidden rounded-xl border border-black/10 dark:border-white/10" />}
      </Modal>

      <Modal open={viewMember !== null} onClose={() => setViewMember(null)} wide xl>
        {viewMember && (() => {
          const m = viewMember;
          const eff = effectivePay(teams, m);
          const isField = memberHasGroup(teams, m, "field");
          const tn = tenure(m.hireDate, m.resignDate || undefined);
              const wd = workDays(m.hireDate, m.resignDate || undefined);
          const none = <span className="text-zinc-400">—</span>;
          const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
            <div className="flex gap-3 border-b border-black/5 py-2 last:border-0 dark:border-white/10">
              <dt className="w-24 shrink-0 text-xs font-bold leading-6 text-zinc-500">{k}</dt>
              <dd className="min-w-0 flex-1 break-words text-sm leading-6">{children}</dd>
            </div>
          );
          return (
            <>
              <div className="flex items-center gap-2">
                <h2 className="mr-auto text-lg font-bold">회원정보 확인</h2>
                <button type="button" onClick={() => setViewMember(null)} aria-label="닫기" className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
              </div>
              <div className="mt-3 flex items-center gap-4">
                {m.photo ? <img src={m.photo} alt="" className="h-20 w-20 shrink-0 rounded-full bg-zinc-100 object-cover" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-3xl text-zinc-400 dark:bg-zinc-800" aria-hidden>👤</span>}
                <div>
                  <div className="flex flex-wrap items-baseline gap-x-2"><b className="text-xl">{m.name}</b>{m.position && <span className="text-zinc-600 dark:text-zinc-300">{m.position}</span>}{m.resignDate && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">퇴사</span>}</div>
                  <div className="mt-0.5 text-sm text-blue-700 dark:text-blue-300">{teamsLabel(teams, m)}{m.officeStatus && <span className="ml-1 text-xs text-zinc-500">({officeStatusLabel(m.officeStatus)})</span>}</div>
                </div>
              </div>
              <div className="mt-3 max-h-[55vh] overflow-y-auto overscroll-contain pr-1">
                <dl className="grid gap-x-8 md:grid-cols-2">
                  <div>
                    <Row k="아이디">{m.loginId ? <code className="font-semibold">{m.loginId}</code> : none}</Row>
                    <Row k="연락처">{m.phone ? <>{m.phone}<a href={`tel:${m.phone.replace(/[^0-9+]/g, "")}`} className="ml-2 rounded-lg bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">전화하기</a></> : none}</Row>
                    <Row k="주소">{m.address ? <>{m.address}{m.addressDetail && <> {m.addressDetail}</>}</> : none}</Row>
                    <Row k="입사일">{m.hireDate || none}{tn && <span className="ml-1.5 text-xs text-zinc-500">({tn}{m.resignDate ? " 근무" : ""}{wd != null && ` · ${wd.toLocaleString("ko-KR")}일${m.resignDate ? "" : "째"}`})</span>}</Row>
                    {m.resignDate && <Row k="퇴사일"><span className="font-semibold text-amber-700 dark:text-amber-300">{m.resignDate}</span></Row>}
                    <Row k="등록일">{m.createdAt ? m.createdAt.slice(0, 10) : none}</Row>
                    {(m.history ?? []).length > 0 && (
                      <Row k="재직 이력">
                        <ul className="space-y-0.5 text-xs">{m.history.map((x, i) => <li key={i}>{x.hire || "입사일 미기록"} ~ {x.resign} <span className="text-zinc-400">퇴사 후 복직</span></li>)}</ul>
                      </Row>
                    )}
                    {isField && (
                      <>
                        <Row k="안전교육">{m.safetyDate ? <b>{m.safetyDate}</b> : <span className="text-amber-600 dark:text-amber-300">미이수</span>}</Row>
                        <Row k="운전면허">{m.license || none}</Row>
                      </>
                    )}
                  </div>
                  <div>
                    {(() => {
                      const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
                      const cur = payOn(m, todayStr); // 지금 적용되는 금액
                      const pend = (m.payHistory ?? []).filter(e => e.from > todayStr).slice(-1)[0]; // 예정된 변경
                      const bal = balances[m.id];
                      return (
                        <>
                          <Row k="급여 기준">{eff === "office" ? "4대보험 사무직" : "일수제"}{m.payType === "" && <small className="ml-1 text-zinc-400">(팀 기본)</small>}</Row>
                          <Row k={eff === "office" ? "월급 · 세전" : "일당"}>
                            {cur > 0 ? <b>{cur.toLocaleString("ko-KR")}원</b> : <span className="text-zinc-400">미설정</span>}
                            {pend && <small className="ml-1.5 text-amber-700 dark:text-amber-300">{pend.from}부터 {pend.amount.toLocaleString("ko-KR")}원 예정</small>}
                          </Row>
                          {eff === "office" && cur > 0 && (() => {
                            const t = netPay(cur);
                            return <Row k="월급 · 세후"><b className="text-emerald-700 dark:text-emerald-300">{t.net.toLocaleString("ko-KR")}원</b><small className="ml-1 text-zinc-500">(4대보험 {t.total.toLocaleString("ko-KR")}원 공제)</small></Row>;
                          })()}
                          {eff === "office" && (
                            <Row k="남은 연차">{bal && bal.total !== null ? <><b>{fmtLeft(bal.total - bal.used)}</b> / {fmtLeft(bal.total)}일 <small className="text-zinc-500">(사용 {fmtLeft(bal.used)}일)</small></> : <span className="text-zinc-400">총 일수 미설정</span>}</Row>
                          )}
                          <Row k="급여 계좌">{m.accountNo ? <>{m.bank} <b>{m.accountNo}</b> <span className="text-xs text-zinc-500">({m.accountHolder || m.name})</span></> : <span className="text-amber-600 dark:text-amber-300">미등록</span>}</Row>
                          <Row k="통장 사본">{m.bankbook ? <a href={m.bankbook} target="_blank" rel="noreferrer" title="눌러서 크게 보기"><img src={m.bankbook} alt="통장 사본" className="h-24 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800" /></a> : none}</Row>
                        </>
                      );
                    })()}
                  </div>
                </dl>
                {/* 회원등록에서 정한 메뉴 권한: 팀 기본 메뉴 + 부여한 메뉴(허용 동작) */}
                {(() => {
                  const base = roleMenus(memberRoles(m));
                  const fullOf = (k: MenuKey) => (k === "sites" ? isStaffAdmin(memberRoles(m)) : base.includes(k)) || (m.menus.includes(k) && (MENU_ACTIONS[k].length === 0 || MENU_ACTIONS[k].every(a => (m.actions?.[k] ?? ["view"]).includes(a))));
                  const everything = MENUS.filter(mn => mn.grantable && mn.key !== "survey").every(mn => fullOf(mn.key)); // 업무 메뉴(자재 요청 참여 제외)를 모두, 모든 동작으로 가졌다
                  return (
                    <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/10">
                      <div className="text-xs font-bold text-zinc-500">메뉴 권한</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {everything && <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">전체 권한</span>}
                        {!everything && base.length === 0 && m.menus.length === 0 && <span className="text-sm text-zinc-400">없음</span>}
                        {!everything && base.map(k => (
                          <span key={"b" + k} className="rounded-full border border-black/10 px-2.5 py-0.5 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-300">{menuLabel(k)} <span className="text-zinc-400">팀 기본</span></span>
                        ))}
                        {!everything && m.menus.filter(k => !base.includes(k)).map(k => {
                          const all = MENU_ACTIONS[k].length === 0 || MENU_ACTIONS[k].every(a => (m.actions?.[k] ?? ["view"]).includes(a));
                          const acts = (m.actions?.[k] ?? ["view"]).map(a => menuActionLabel(k, a)).join("·");
                          return (
                            <span key={"g" + k} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {menuLabel(k)}{MENU_ACTIONS[k].length > 0 && <> · {all ? "모든 권한" : acts || "볼 수 없음"}</>}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
                <span className="mr-auto text-xs text-zinc-500">{viewMember.resignDate ? "퇴사한 회원은 수정할 수 없어요. 고치려면 먼저 복직시켜 주세요." : "정보 수정은 회원등록에서 해요."}</span>
                <button type="button" onClick={() => setViewMember(null)} className="rounded-xl bg-zinc-100 px-5 py-2.5 font-bold dark:bg-zinc-800">닫기</button>
              </div>
            </>
          );
        })()}
      </Modal>

      <Modal open={confirmPurge !== null} onClose={() => !busy && setConfirmPurge(null)}>
        {confirmPurge && (
          <>
            <h2 className="text-lg font-bold">{confirmPurge.name}님을 완전히 삭제할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">회원 정보가 영구히 지워지고 되돌릴 수 없어요. 다시 올 수 있다면 “복직”을 쓰세요.</p>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmPurge(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button type="button" disabled={busy} onClick={doPurge} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "완전 삭제"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmDel !== null} onClose={() => !busy && setConfirmDel(null)}>
        {confirmDel && (
          <>
            <h2 className="text-lg font-bold">{confirmDel.name}님을 {scope === "coop" ? "삭제" : "퇴사 처리"}할까요?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">{scope === "coop" ? "이 거래처 정보가 목록에서 지워져요." : "퇴사일이 오늘 날짜로 기록되고 퇴사 탭으로 옮겨져요. 더 이상 로그인할 수 없고, 기록은 그대로 남아요. 퇴사 탭에서 복직시킬 수 있어요."}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirmDel(null)} className="flex-1 rounded-xl bg-zinc-100 py-3 font-bold dark:bg-zinc-800">취소</button>
              <motion.button type="button" disabled={busy} onClick={doDelete} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : scope === "coop" ? "삭제" : "퇴사"}</motion.button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={tradeTeam !== null} onClose={() => !busy && setTradeTeam(null)}>
        {tradeTeam && (
          <>
            <h2 className="text-lg font-bold">“{tradeTeam.label}” 관여 공정</h2>
            <p className="mt-1 text-sm text-zinc-500">이 팀이 맡는 공정을 골라요. 이 팀 회원은 자재 요청에서 고른 공정의 하위 카테고리를 모두 볼 수 있어요. 공정을 하나도 정하지 않으면 모든 공정을 쓸 수 있어요.</p>
            <div className="mt-3 flex max-h-[50vh] flex-wrap gap-2 overflow-y-auto">
              {trades.length > 0 && (() => {
                const allOn = trades.every(t => tradeSel.includes(t));
                return <button type="button" aria-pressed={allOn} onClick={() => setTradeSel(allOn ? [] : [...trades])} className={`${chipBase} px-3.5 py-1.5 text-[15px] ${allOn ? chipOn : chipOff}`}>전체</button>;
              })()}
              {trades.map(t => {
                const on = tradeSel.includes(t);
                return <button key={t} type="button" aria-pressed={on} onClick={() => setTradeSel(p => (on ? p.filter(x => x !== t) : [...p, t]))} className={`${chipBase} px-3.5 py-1.5 text-[15px] ${on ? chipOn : chipOff}`}>{t}</button>;
              })}
              {trades.length === 0 && <span className="text-sm text-zinc-400">등록된 공정이 없어요.</span>}
            </div>
            {tradeErr && <p className="mt-3 text-sm text-red-500" role="alert">{tradeErr}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setTradeTeam(null)} className="rounded-xl bg-zinc-100 px-5 py-3 font-bold dark:bg-zinc-800">취소</button>
              <button type="button" disabled={busy} onClick={saveTeamTrades} className="flex-1 rounded-xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
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
              <motion.button type="button" disabled={busy} onClick={doDeleteTeam} className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-50">{busy ? "처리 중…" : "삭제"}</motion.button>
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
