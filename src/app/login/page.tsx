"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(false);
    setLoading(true);

    const result = await signIn("credentials", {
      password,
      redirect: false,
    });

    if (result?.ok) {
      router.push("/");
    } else {
      setError(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <div className="w-5 h-5 rounded-full bg-white" />
          </div>
          <h1 className="text-[22px] font-semibold text-text">
            Цветита Хербал
          </h1>
          <p className="text-[14px] text-text-3 mt-1">Команден Център</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="bg-surface rounded-2xl shadow-md p-6">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-text-3 mb-2">
              Парола за достъп
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Въведи парола"
              className={`
                w-full bg-surface-2 border rounded-lg px-4 py-3 text-[14px] text-text
                outline-none transition-colors placeholder:text-text-3
                ${error ? "border-red" : "border-border focus:border-accent"}
              `}
              autoFocus
            />
            {error && (
              <p className="text-[12px] text-red mt-2">Грешна парола</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full mt-4 py-3 rounded-lg bg-accent text-white font-medium text-[14px] hover:bg-accent-hover transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Влез
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
