/*
 * A tela curta de quem tem acesso às duas bases: escolher qual dashboard abrir.
 *
 * Só o pastor com as duas passa por aqui, logo depois do login. Quem tem uma só
 * vai direto ao dashboard dela; o administrador escolhe na tela de bases, onde
 * já está. Dentro do dashboard, a troca é pelo alternador do canto superior
 * direito — esta tela não volta.
 *
 * As bases oferecidas são as que o servidor disse que a sessão abre. Isso só
 * decide os botões: o que cada um mostra é recortado de novo no servidor.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, LogOut } from "lucide-react";
import logoCentral from "@/assets/logo-central.png";
import { useApp } from "@/lib/appState";
import { DECLARACOES, type Base } from "@/lib/bases";

export function EscolhaDeBase() {
  const { bases, abrirBase, abrindo, setStep, signOut, user } = useApp();
  const [erro, setErro] = useState("");

  const abrir = async (b: Base) => {
    setErro("");
    try {
      const r = await abrirBase(b);
      // Nulo: outro clique mais novo passou na frente, e é ele que decide.
      if (r) setStep("dashboard");
    } catch {
      setErro("Não consegui abrir este dashboard. Tente de novo.");
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
        <div className="flex flex-col items-center text-center mb-7">
          <div className="h-16 w-16 rounded-xl bg-panel-2 border border-line-strong grid place-content-center mb-4 shadow-panel overflow-hidden">
            <img src={logoCentral} alt="Central" className="h-14 w-14 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Qual dashboard você quer abrir?
          </h1>
          <p className="text-sm text-ink-2 mt-1">
            Dá para trocar depois, no canto superior direito.
          </p>
        </div>

        <div className="space-y-3">
          {bases.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => void abrir(b)}
              disabled={abrindo !== null}
              className="group flex w-full items-center justify-between rounded-xl border border-line-strong bg-panel-2 px-5 py-4 text-left transition hover:border-acc disabled:cursor-wait disabled:opacity-60"
            >
              <span className="text-lg font-semibold tracking-tight text-ink">
                {DECLARACOES[b].nome}
              </span>
              {abrindo === b ? (
                <Loader2 className="h-5 w-5 animate-spin text-acc" />
              ) : (
                <ArrowRight className="h-5 w-5 text-ink-3 transition group-hover:text-acc" />
              )}
            </button>
          ))}
        </div>

        {erro && <p className="mt-4 text-sm text-neg">{erro}</p>}

        <div className="mt-7 flex items-center justify-between border-t border-line-soft pt-4 text-sm">
          <span className="truncate text-ink-3">{user}</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 text-ink-3 transition hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </motion.div>
    </div>
  );
}
