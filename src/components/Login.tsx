import { useState } from "react";
import { motion } from "framer-motion";
import { Lock, User } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import logoCentral from "@/assets/logo-central.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/appState";
import { loginServer } from "@/lib/gate.functions";

export function Login() {
  const { setStep, setUser } = useApp();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const login = useServerFn(loginServer);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await login({ data: { username: u, password: p } });
      if (res.ok) {
        setUser(res.user);
        setStep("upload");
      } else {
        setErr("Credenciais inválidas");
      }
    } catch {
      setErr("Erro ao autenticar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#10131A] via-[#141822] to-[#191E27] p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md bg-panel rounded-2xl shadow-panel-lg border border-line-soft p-8"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 rounded-xl bg-panel-2 border border-line-strong grid place-content-center mb-4 shadow-panel overflow-hidden">
            <img src={logoCentral} alt="Central" className="h-14 w-14 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Dashboard Financeiro Central
          </h1>
          <p className="text-sm text-ink-2 mt-1">Acesso restrito</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user">Usuário</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3" />
              <Input
                id="user"
                value={u}
                onChange={(e) => setU(e.target.value)}
                className="pl-9 h-11 bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
                placeholder="Seu nome"
                autoFocus
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pwd">Senha</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3" />
              <Input
                id="pwd"
                type="password"
                value={p}
                onChange={(e) => setP(e.target.value)}
                className="pl-9 h-11 bg-panel-2 border-line-strong text-ink placeholder:text-ink-3 focus-visible:border-acc"
                placeholder="••••••••"
              />
            </div>
          </div>
          {err && <p className="text-sm text-neg">{err}</p>}
          <Button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-acc text-background font-semibold hover:brightness-110 shadow-panel transition-all disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
