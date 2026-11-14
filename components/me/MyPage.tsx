"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { PublicMember } from "@/lib/types";

const chipBase = "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOff = "border-black/10 bg-white text-zinc-800 hover:border-blue-400 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200";
const chipOn = "border-blue-600 bg-blue-600 font-semibold text-white";
const inputCls = "mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3.5 py-3 text-base outline-none focus:border-blue-500 dark:border-white/15";
const card = "rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900";
const primary = "w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:opacity-40";

export default function MyPage({
  me: initial, roleLabel, showTrades, allTrades, menuLinks, isStaff,
}: {
  me: PublicMember;
  roleLabel: string;
  showTrades: boolean;
  allTrades: string[];
  menuLinks: { label: string; href: string }[]; // 지금 쓸 수 있는 메뉴 (바로 가기)
  isStaff: boolean;
}) {
  const router = useRouter();
  const [me, setMe] = useState(initial);
  const forced = me.mustChangePassword; // 임시 비밀번호 상태: 새 비밀번호를 정하기 전에는 다른 것을 할 수 없다

  const [name, setName] = useState(initial.name);
  const [trades, setTrades] = useState<string[]>(initial.trades);
  const [newId, setNewId] = useState("");
  const [idPw, setIdPw] = useState("");
  const [cur, setCur] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ where: string; text: string } | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const toastId = toast?.id;
  useEffect(() => {
    if (toastId == null) return;
    const t = window.setTimeout(() => setToast(cur => (cur?.id === toastId ? null : cur)), 3500);
    return () => window.clearTimeout(t);
  }, [toastId]);

  async function call(where: string, body: object) {
    setBusy(where);
    setErr(null);
    try {
      const r = await fetch("/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { member?: PublicMember; error?: string };
      if (r.status === 401) {
        router.replace("/");
        return null;
      }
      if (!r.ok) {
        setErr({ where, text: j.error ?? "요청에 실패했어요." });
        return null;
      }
      return j.member ?? me;
    } catch {
      setErr({ where, text: "서버에 연결할 수 없어요." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (showTrades && (trades.length < 1 || trades.length > 3)) return setErr({ where: "profile", text: "공정은 1~3개를 골라 주세요." });
    const m = await call("profile", { action: "profile", name, ...(showTrades ? { trades } : {}) });
    if (m) {
      setMe(m);
      setName(m.name);
      setToast({ id: Date.now(), text: "저장했어요" });
    }
  }

  async function saveLoginId(e: React.FormEvent) {
    e.preventDefault();
    const m = await call("id", { action: "loginId", loginId: newId, password: idPw });
    if (m) {
      setMe(m);
      setNewId("");
      setIdPw("");
      setToast({ id: Date.now(), text: "아이디를 바꿨어요" });
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw1 !== pw2) return setErr({ where: "pw", text: "새 비밀번호가 서로 달라요." });
    const wasForced = forced;
    const m = await call("pw", { action: "password", current: cur, next: pw1 });
    if (m) {
      setMe(m);
      setCur("");
      setPw1("");
      setPw2("");
      setToast({ id: Date.now(), text: "비밀번호를 바꿨어요" });
      if (wasForced) {
        router.replace("/"); // 이제 직급에 맞는 화면으로
        router.refresh();
      }
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  const canChangeId = isStaff || !me.idChanged;
  const errFor = (w: string) =>
    err?.where === w ? (
      <p className="pt-3 text-sm text-red-500" role="alert">{err.text}</p>
    ) : null;

  const passwordForm = (
    <form onSubmit={savePassword} className={card}>
      <h2 className="text-base font-bold">{forced ? "새 비밀번호 정하기" : "비밀번호 변경"}</h2>
      <label htmlFor="cur" className="mt-3 block text-sm font-bold">{forced ? "임시 비밀번호" : "현재 비밀번호"}</label>
      <input id="cur" type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" className={inputCls} />
      <label htmlFor="pw1" className="mt-3 block text-sm font-bold">새 비밀번호 <span className="font-normal text-zinc-500">(6자 이상)</span></label>
      <input id="pw1" type="password" value={pw1} onChange={e => setPw1(e.target.value)} autoComplete="new-password" className={inputCls} />
      <label htmlFor="pw2" className="mt-3 block text-sm font-bold">새 비밀번호 확인</label>
      <input id="pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" className={inputCls} />
      {errFor("pw")}
      <motion.button whileTap={{ scale: 0.98 }} disabled={!cur || !pw1 || !pw2 || busy === "pw"} className={`mt-4 ${primary}`}>
        {busy === "pw" ? "변경 중…" : forced ? "비밀번호 정하고 시작하기" : "비밀번호 변경"}
      </motion.button>
    </form>
  );

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-24">
      <header className="flex flex-wrap items-center gap-2 py-6">
        <h1 className="mr-auto text-xl font-extrabold">{forced ? "비밀번호를 정해 주세요" : "내 정보"}</h1>
        {!forced && <Link href="/" className={`${chipBase} ${chipOff}`}>← 메뉴</Link>}
        <button type="button" onClick={logout} className={`${chipBase} ${chipOff}`}>로그아웃</button>
      </header>

      {!forced && menuLinks.length > 0 && (
        <nav aria-label="내 메뉴" className="-mt-2 mb-4 flex flex-wrap gap-2">
          {menuLinks.map(l => (
            <Link key={l.href} href={l.href} className={`${chipBase} ${chipOff}`}>{l.label} →</Link>
          ))}
        </nav>
      )}

      {forced ? (
        <div className="space-y-4">
          <p className="rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            <b>{me.name}</b>님, 임시 비밀번호로 로그인했어요. 다른 사람이 아는 비밀번호이니 <b>나만 아는 새 비밀번호</b>로 바꾼 뒤 이용해 주세요.
          </p>
          {passwordForm}
        </div>
      ) : (
        <div className="space-y-4">
          <section className={card}>
            <div className="flex items-center gap-2">
              <b className="text-lg">{me.name}</b>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">{roleLabel}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">아이디 <code className="font-bold text-zinc-800 dark:text-zinc-100">{me.loginId}</code></p>
          </section>

          <form onSubmit={saveProfile} className={card}>
            <h2 className="text-base font-bold">기본 정보</h2>
            <label htmlFor="mname" className="mt-3 block text-sm font-bold">이름</label>
            <input id="mname" value={name} onChange={e => setName(e.target.value)} maxLength={40} className={inputCls} />
            {showTrades && (
              <>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-sm font-bold">내 공정</span>
                  <span className={`text-xs ${trades.length >= 3 ? "font-semibold text-blue-600" : "text-zinc-500"}`}>{trades.length}/3개 선택</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allTrades.map(t => {
                    const on = trades.includes(t);
                    const locked = !on && trades.length >= 3;
                    return (
                      <motion.button
                        key={t}
                        type="button"
                        whileTap={locked ? undefined : { scale: 0.94 }}
                        onClick={() => setTrades(p => (p.includes(t) ? p.filter(x => x !== t) : p.length >= 3 ? p : [...p, t]))}
                        aria-pressed={on}
                        disabled={locked}
                        className={`${chipBase} px-4 py-2 text-[15px] ${on ? chipOn : chipOff} ${locked ? "opacity-35" : ""}`}
                      >
                        {t}
                      </motion.button>
                    );
                  })}
                </div>
              </>
            )}
            {errFor("profile")}
            <motion.button whileTap={{ scale: 0.98 }} disabled={busy === "profile"} className={`mt-4 ${primary}`}>{busy === "profile" ? "저장 중…" : "저장"}</motion.button>
          </form>

          <section className={card}>
            <h2 className="text-base font-bold">아이디 변경</h2>
            {canChangeId ? (
              <form onSubmit={saveLoginId}>
                <p className="mt-1 text-sm text-zinc-500">
                  {isStaff ? "최고 관리자·개발팀은 횟수 제한 없이 바꿀 수 있어요." : "아이디는 처음 한 번만 직접 바꿀 수 있어요. 신중하게 정해 주세요."}
                </p>
                <label htmlFor="nid" className="mt-3 block text-sm font-bold">새 아이디 <span className="font-normal text-zinc-500">(영문 소문자·숫자·_- 3~20자)</span></label>
                <input id="nid" value={newId} onChange={e => setNewId(e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" className={inputCls} />
                <label htmlFor="idpw" className="mt-3 block text-sm font-bold">현재 비밀번호</label>
                <input id="idpw" type="password" value={idPw} onChange={e => setIdPw(e.target.value)} autoComplete="current-password" className={inputCls} />
                {errFor("id")}
                <motion.button whileTap={{ scale: 0.98 }} disabled={!newId.trim() || !idPw || busy === "id"} className={`mt-4 ${primary}`}>{busy === "id" ? "변경 중…" : "아이디 변경"}</motion.button>
              </form>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">아이디는 이미 한 번 바꿨어요. 더 바꾸려면 <b>최고 관리자나 개발팀</b>에 요청해 주세요.</p>
            )}
          </section>

          {passwordForm}
        </div>
      )}

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
    </main>
  );
}
