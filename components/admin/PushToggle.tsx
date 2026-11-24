"use client";

import { useEffect, useState } from "react";

// 🔔 이 기기에서 푸시 알림 켜기/끄기 (작업일보가 올라오면 알려 준다)
//  · 브라우저가 푸시를 지원하지 않거나(아이폰은 홈 화면에 앱으로 추가해야 함) 서버에 알림 키가 없으면 보이지 않는다.
const b64uToBytes = (s: string) => {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export default function PushToggle({ className }: { className: string }) {
  const [state, setState] = useState<"hidden" | "off" | "on" | "denied">("hidden");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    let dead = false;
    fetch("/api/push/key")
      .then(r => r.json() as Promise<{ enabled?: boolean; key?: string }>)
      .then(async j => {
        if (dead || !j.enabled || !j.key) return;
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (dead) return;
        setKey(j.key);
        setState(Notification.permission === "denied" ? "denied" : sub ? "on" : "off");
      })
      .catch(() => undefined);
    return () => { dead = true; };
  }, []);

  if (state === "hidden") return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (state === "on" && cur) {
        await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: cur.endpoint, off: true }) });
        await cur.unsubscribe();
        setState("off");
        setMsg("알림을 껐어요");
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { setState("denied"); setMsg("브라우저에서 알림이 차단돼 있어요. 주소창 옆 자물쇠에서 허용해 주세요."); return; }
        const sub = cur ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) }));
        const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "알림을 켜지 못했어요.");
        setState("on");
        setMsg("이 기기로 작업일보 알림을 받아요");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "알림을 켜지 못했어요.");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 4000);
    }
  }

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => void toggle()} disabled={busy} aria-pressed={state === "on"} title={state === "on" ? "이 기기의 작업일보 알림 끄기" : "이 기기에서 작업일보 알림 받기"} className={className + (state === "on" ? " !border-blue-500 !text-blue-700 dark:!text-blue-300" : "")}>
        {state === "on" ? "🔔 알림 켬" : state === "denied" ? "🔕 알림 차단됨" : "🔔 알림 받기"}
      </button>
      {msg && <span role="status" className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg">{msg}</span>}
    </span>
  );
}
