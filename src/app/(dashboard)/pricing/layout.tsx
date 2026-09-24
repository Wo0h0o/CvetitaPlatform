"use client";

import { useEffect, useState } from "react";
import { Lock, Loader2 } from "lucide-react";

type State = "loading" | "setpw" | "locked" | "ok";

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("loading");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function check() {
    try {
      const r = await fetch("/api/pricing/unlock").then((x) => x.json());
      setState(!r.hasPassword ? "setpw" : r.unlocked ? "ok" : "locked");
    } catch {
      setState("locked");
    }
  }
  useEffect(() => {
    check();
  }, []);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      const body = state === "setpw" ? { setPassword: pw } : { password: pw };
      const res = await fetch("/api/pricing/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        setPw("");
        await check();
      } else {
        setErr(state === "setpw" ? "Паролата трябва да е поне 4 знака." : "Грешна парола.");
      }
    } catch {
      setErr("Грешка. Опитай пак.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading")
    return (
      <div className="flex items-center gap-2 text-text-3 py-16 justify-center">
        <Loader2 className="animate-spin" size={18} /> Зареждане…
      </div>
    );

  if (state === "ok") return <>{children}</>;

  const setMode = state === "setpw";
  return (
    <div className="max-w-[380px] mx-auto mt-12 bg-surface border border-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1 text-text">
        <Lock size={18} className="text-accent" />
        <h1 className="text-[16px] font-semibold">{setMode ? "Задай парола за модула" : "Заключен модул"}</h1>
      </div>
      <p className="text-[12px] text-text-3 mb-4">
        {setMode ? "Този модул е защитен. Задай парола, с която ще се отключва." : "Въведи паролата, за да достъпиш офертите и цените."}
      </p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        autoFocus
        placeholder={setMode ? "нова парола (мин. 4 знака)" : "парола"}
        className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-[13px] text-text focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      {err && <p className="text-[12px] text-red-500 mt-2">{err}</p>}
      <button
        onClick={submit}
        disabled={busy || !pw}
        className="mt-3 w-full flex items-center justify-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg bg-accent text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} {setMode ? "Запази и отключи" : "Отключи"}
      </button>
    </div>
  );
}
