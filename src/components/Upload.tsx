import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  Users,
  DollarSign,
  Scale,
  Database,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/appState";
import { normalizeFinancial, normalizeMembership, normalizeSaldo, parseFile } from "@/lib/parsers";
import { enviarBases } from "@/lib/enviarBase";
import { estadoServer } from "@/lib/dados.functions";
import { UnidadesPorPastor } from "@/components/UnidadesPorPastor";

interface DropProps {
  label: string;
  hint: string;
  icon: React.ReactNode;
  file: File | null;
  onFile: (f: File) => void;
}

function DropZone({ label, hint, icon, file, onFile }: DropProps) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all min-h-[220px] ${
        drag
          ? "border-acc bg-acc/10"
          : file
            ? "border-pos/60 bg-pos/10"
            : "border-line-strong bg-panel hover:border-acc hover:shadow-panel-lg"
      }`}
    >
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <div
        className={`h-12 w-12 rounded-xl grid place-content-center ${
          file ? "bg-pos/15 text-pos" : "bg-panel-2 text-ink-2 group-hover:bg-line-soft"
        }`}
      >
        {file ? <CheckCircle2 className="h-6 w-6" /> : icon}
      </div>
      <div>
        <p className="font-semibold text-ink">{label}</p>
        <p className="text-sm text-ink-2 mt-1">{hint}</p>
      </div>
      {file ? (
        <div className="flex items-center gap-2 text-sm text-pos mt-2">
          <FileSpreadsheet className="h-4 w-4" />
          <span className="truncate max-w-[200px]">{file.name}</span>
        </div>
      ) : (
        <p className="text-xs text-ink-3 mt-2">Arraste ou clique para selecionar (.csv, .xlsx)</p>
      )}
    </label>
  );
}

interface EstadoBase {
  enviadaEm: string;
  enviadaPor: string | null;
  linhas: number;
}

export function Upload() {
  const { setStep, carregarDoServidor, user } = useApp();
  const [financeiroFile, setFinanceiro] = useState<File | null>(null);
  const [membresiaFile, setMembresia] = useState<File | null>(null);
  const [saldoFile, setSaldo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [err, setErr] = useState("");
  /*
   * A base que já está no servidor, se houver. É o que dispensa o administrador
   * de reenviar tudo só para chegar ao dashboard: antes, sem upload não havia
   * dados, e agora eles estão gravados.
   */
  const [baseAtual, setBaseAtual] = useState<EstadoBase | null>(null);
  const [indoParaODashboard, setIndo] = useState(false);

  /*
   * O saldo não entra aqui: é base opcional. Exigi-la impediria de abrir o
   * dashboard inteiro por causa de um card, e quem não a tiver vê esse card
   * dizendo que falta a base — em vez de um zero que passaria por número real.
   */
  const ready = financeiroFile && membresiaFile;

  /*
   * Puxa o código do dashboard enquanto o usuário escolhe os arquivos. Ele é
   * carregado sob demanda para não pesar a tela de senha; começar aqui faz o
   * download acontecer em paralelo com a escolha, e não depois do clique.
   */
  useEffect(() => {
    void import("@/components/Dashboard");
  }, []);

  useEffect(() => {
    void estadoServer()
      .then((e) => setBaseAtual(e.carga))
      .catch(() => setBaseAtual(null));
  }, []);

  const irParaODashboard = useCallback(async () => {
    setIndo(true);
    setErr("");
    try {
      await carregarDoServidor();
      setStep("dashboard");
    } catch {
      setErr("Não consegui carregar a base que está no servidor.");
      setIndo(false);
    }
  }, [carregarDoServidor, setStep]);

  const handleGenerate = useCallback(async () => {
    if (!financeiroFile || !membresiaFile) return;
    setLoading(true);
    setErr("");
    try {
      const [fr, mr, sr] = await Promise.all([
        parseFile(financeiroFile),
        parseFile(membresiaFile),
        saldoFile ? parseFile(saldoFile) : Promise.resolve([]),
      ]);
      const fin = normalizeFinancial(fr);
      const mem = normalizeMembership(mr);
      const sal = normalizeSaldo(sr);
      if (!fin.rows.length) throw new Error("Base financeira vazia ou inválida");
      if (saldoFile && !sal.length) {
        throw new Error(
          'Base de saldo sem linhas válidas — confira as colunas "Período" e "Saldo Acumulado"',
        );
      }
      /*
       * Grava no servidor e só então lê de volta, em vez de aproveitar o que
       * acabou de ser interpretado aqui. O ida e volta custa alguns segundos
       * numa rede local e paga por si: se algo tivesse se perdido na gravação,
       * o administrador descobriria agora, e não no dia seguinte pela boca de
       * um pastor.
       */
      await enviarBases(
        {
          arquivos: [financeiroFile.name, membresiaFile.name, saldoFile?.name].filter(
            Boolean,
          ) as string[],
          financial: fin.rows,
          membership: mem,
          saldo: sal,
          metaAnualPorUnidade: fin.metaAnualPorUnidade,
          metaAnualTotalGeral: fin.metaAnualTotalGeral,
        },
        setProgresso,
      );
      await carregarDoServidor();
      setStep("dashboard");
    } catch (e) {
      setErr((e as Error).message ?? "Erro ao processar arquivos");
      setProgresso(0);
    } finally {
      setLoading(false);
    }
  }, [financeiroFile, membresiaFile, saldoFile, carregarDoServidor, setStep]);

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="text-sm text-ink-3">Olá, {user}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink mt-1">
            Carregar bases de dados
          </h1>
          <p className="text-ink-2 mt-2 max-w-2xl">
            Faça upload das bases para gerar o dashboard executivo. A de saldo é opcional — sem ela,
            o dashboard abre normalmente e só o card de saldo fica vazio.
          </p>
        </motion.div>

        {baseAtual && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line-soft bg-panel px-5 py-4 shadow-panel"
          >
            <div className="flex items-center gap-3.5">
              <div className="grid h-10 w-10 shrink-0 place-content-center rounded-lg bg-pos/15 text-pos">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-ink">Já existe uma base no servidor</p>
                <p className="text-sm text-ink-2">
                  Enviada em {new Date(baseAtual.enviadaEm).toLocaleDateString("pt-BR")}
                  {baseAtual.enviadaPor ? " por " + baseAtual.enviadaPor : ""} ·{" "}
                  {baseAtual.linhas.toLocaleString("pt-BR")} lançamentos
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              disabled={loading || indoParaODashboard}
              onClick={irParaODashboard}
              className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
            >
              {indoParaODashboard ? "Abrindo…" : "Ir para o dashboard"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </motion.div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <DropZone
            label="Arquivo 1 — Dados Financeiros"
            hint="Entradas, dízimos, ofertas e metas"
            icon={<DollarSign className="h-6 w-6" />}
            file={financeiroFile}
            onFile={setFinanceiro}
          />
          <DropZone
            label="Arquivo 2 — Dados de Membresia"
            hint="Membresia mensal por unidade"
            icon={<Users className="h-6 w-6" />}
            file={membresiaFile}
            onFile={setMembresia}
          />
          <DropZone
            label="Arquivo 3 — Saldo por Centro de Resultado"
            hint="Saldo acumulado por período (opcional)"
            icon={<Scale className="h-6 w-6" />}
            file={saldoFile}
            onFile={setSaldo}
          />
        </div>

        {err && (
          <div className="mt-6 rounded-lg border border-neg/40 bg-neg/10 p-4 text-sm text-neg">
            {err}
          </div>
        )}

        {loading && (
          <div className="mt-8">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="text-ink-2">Gravando no servidor…</span>
              <span className="tabular-nums text-ink-3">{Math.round(progresso * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
              <div
                className="h-full rounded-full bg-acc transition-[width] duration-200"
                style={{ width: Math.max(3, progresso * 100) + "%" }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            disabled={!ready || loading || indoParaODashboard}
            onClick={handleGenerate}
            className="h-12 px-8 bg-acc text-background font-semibold hover:brightness-110 shadow-panel transition-all disabled:opacity-40 disabled:shadow-none"
          >
            <UploadCloud className="h-5 w-5" />
            {loading ? "Enviando…" : baseAtual ? "Substituir base e abrir" : "Gerar Dashboard"}
          </Button>
        </div>

        <UnidadesPorPastor />
      </div>
    </div>
  );
}
