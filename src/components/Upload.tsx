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
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/appState";
import { normalizeFinancial, normalizeMembership, normalizeSaldo, parseFile } from "@/lib/parsers";
import { enviarBases } from "@/lib/enviarBase";
import { estadoServer } from "@/lib/dados.functions";
import { DECLARACOES, type Base } from "@/lib/bases";
import { UnidadesPorPastor } from "@/components/UnidadesPorPastor";

interface DropProps {
  label: string;
  hint: string;
  icon: React.ReactNode;
  file: File | null;
  onFile: (f: File) => void;
  /** A cor da base: o mesmo tom no bloco e em cada arquivo dele. */
  cor: string;
}

function DropZone({ label, hint, icon, file, onFile, cor }: DropProps) {
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
      className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all min-h-[200px] ${
        drag
          ? "border-acc bg-acc/10"
          : file
            ? "border-pos/60 bg-pos/10"
            : "border-line-strong bg-panel hover:shadow-panel-lg"
      }`}
      style={!drag && !file ? { borderColor: cor + "66" } : undefined}
    >
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Escolher o mesmo arquivo de novo, depois de uma recusa, tem de disparar outra vez.
          e.target.value = "";
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

/*
 * As cores dos blocos. Não são as cores de estado da tela (verde de sucesso,
 * amarelo de aviso, vermelho de erro): são só a identidade de cada base, para
 * o olho saber em qual bloco está antes de ler o título.
 */
const COR_DA_BASE: Record<Base, string> = { brasil: "#3DB07A", angola: "#9B87F5" };

/**
 * O envio de UMA base: os arquivos dela, o estado dela no servidor, e o botão
 * que substitui só ela. Enviar o Brasil não toca em Angola, e vice-versa — no
 * servidor, cada carga é de uma base e só desativa e poda as da mesma base.
 */
function BlocoDeEnvio({ base, onEnviada }: { base: Base; onEnviada: () => void }) {
  const { setStep, abrirBase, abrindo } = useApp();
  const d = DECLARACOES[base];
  const cor = COR_DA_BASE[base];
  const [financeiroFile, setFinanceiro] = useState<File | null>(null);
  const [membresiaFile, setMembresia] = useState<File | null>(null);
  const [saldoFile, setSaldo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [err, setErr] = useState("");
  /*
   * A base que já está no servidor, se houver. É o que dispensa o administrador
   * de reenviar tudo só para chegar ao dashboard: os dados estão gravados.
   */
  const [baseAtual, setBaseAtual] = useState<EstadoBase | null>(null);
  /*
   * O resultado do último envio, com o aviso de metas. Fica na tela até o
   * próximo envio: o administrador decide quando abrir o dashboard.
   */
  const [enviada, setEnviada] = useState<{ linhas: number; semMetaExata: string[] } | null>(null);
  const [erroAoAbrir, setErroAoAbrir] = useState("");

  useEffect(() => {
    void estadoServer({ data: { base } })
      .then((e) => setBaseAtual(e.carga))
      .catch(() => setBaseAtual(null));
  }, [base]);

  const abrirDashboard = useCallback(async () => {
    setErroAoAbrir("");
    try {
      const r = await abrirBase(base);
      if (r) setStep("dashboard");
    } catch {
      setErroAoAbrir(`Não consegui abrir o dashboard ${d.nomeComDe}.`);
    }
  }, [abrirBase, base, d.nomeComDe, setStep]);

  /*
   * Só o financeiro é obrigatório. Membresia e saldo são opcionais nas duas
   * bases: sem membresia, os três cards que dependem dela mostram "—" e dizem
   * que a base não foi carregada; sem saldo, o card de saldo diz o mesmo. Um
   * zero que passasse por número real seria pior que a ausência declarada.
   */
  const enviar = useCallback(async () => {
    if (!financeiroFile) return;
    setLoading(true);
    setErr("");
    setEnviada(null);
    try {
      const [fr, mr, sr] = await Promise.all([
        parseFile(financeiroFile),
        membresiaFile ? parseFile(membresiaFile) : Promise.resolve([]),
        saldoFile ? parseFile(saldoFile) : Promise.resolve([]),
      ]);
      /*
       * A base decide as colunas e a assinatura. O arquivo de um país no bloco
       * do outro é RECUSADO aqui, antes de qualquer linha sair do navegador — a
       * base que está no servidor fica intacta. A mensagem da recusa vem pronta
       * do parser e aparece abaixo do jeito que está.
       */
      const fin = normalizeFinancial(fr, base);
      const mem = normalizeMembership(mr);
      const sal = normalizeSaldo(sr);
      if (!fin.rows.length) throw new Error("Base financeira vazia ou inválida");
      if (membresiaFile && !mem.length) {
        throw new Error('Base de membresia sem linhas válidas — confira a coluna "Unidades"');
      }
      if (saldoFile && !sal.length) {
        throw new Error(
          'Base de saldo sem linhas válidas — confira as colunas "Período" e "Saldo Acumulado"',
        );
      }
      const resumo = await enviarBases(
        {
          base,
          arquivos: [financeiroFile.name, membresiaFile?.name, saldoFile?.name].filter(
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
      setBaseAtual(resumo);
      setEnviada({ linhas: resumo.linhas, semMetaExata: fin.unidadesSemMetaExata });
      setFinanceiro(null);
      setMembresia(null);
      setSaldo(null);
      onEnviada();
    } catch (e) {
      setErr((e as Error).message ?? "Erro ao processar arquivos");
    } finally {
      setLoading(false);
      setProgresso(0);
    }
  }, [financeiroFile, membresiaFile, saldoFile, base, onEnviada]);

  const opcionais = [d.arquivos.membresia && "membresia", d.arquivos.saldo && "saldo"].filter(
    Boolean,
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 overflow-hidden rounded-2xl border border-line-soft bg-panel/60 shadow-panel"
      style={{ borderTop: `4px solid ${cor}` }}
      aria-label={`Envio da base ${d.nomeComDe}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-content-center rounded-lg text-sm font-bold tracking-wide text-background"
            style={{ background: cor }}
            aria-hidden
          >
            {base === "brasil" ? "BR" : "AO"}
          </span>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-ink">{d.nome}</h2>
            {baseAtual ? (
              <p className="text-sm text-ink-2">
                <Database className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-pos" />
                No servidor: enviada em {new Date(baseAtual.enviadaEm).toLocaleDateString("pt-BR")}
                {baseAtual.enviadaPor ? " por " + baseAtual.enviadaPor : ""} ·{" "}
                {baseAtual.linhas.toLocaleString("pt-BR")} lançamentos
              </p>
            ) : (
              <p className="text-sm text-ink-3">Nenhuma base {d.nomeComDe} no servidor ainda.</p>
            )}
          </div>
        </div>
        {baseAtual && (
          <Button
            variant="outline"
            disabled={loading || abrindo !== null}
            onClick={() => void abrirDashboard()}
            className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
          >
            {abrindo === base ? "Abrindo…" : `Abrir o dashboard ${d.nomeComDe}`}
            {abrindo === base ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      <div className="p-6">
        <div
          className={`grid gap-5 ${
            opcionais.length === 2 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2"
          }`}
        >
          <DropZone
            label={`Financeiro — ${d.nome}`}
            hint="Planilha financeira (obrigatória)"
            icon={<DollarSign className="h-6 w-6" />}
            file={financeiroFile}
            onFile={setFinanceiro}
            cor={cor}
          />
          {d.arquivos.membresia && (
            <DropZone
              label={`Membresia — ${d.nome}`}
              hint="Membresia mensal por unidade (opcional)"
              icon={<Users className="h-6 w-6" />}
              file={membresiaFile}
              onFile={setMembresia}
              cor={cor}
            />
          )}
          {d.arquivos.saldo && (
            <DropZone
              label={`Saldo — ${d.nome}`}
              hint="Saldo acumulado por centro de resultado (opcional)"
              icon={<Scale className="h-6 w-6" />}
              file={saldoFile}
              onFile={setSaldo}
              cor={cor}
            />
          )}
          {/*
           * O espaço preparado: a base ainda não tem membresia nem saldo, e o
           * bloco diz isso em vez de esconder. Quando os arquivos existirem,
           * liga-se `arquivos` em src/lib/bases.ts e as caixas aparecem aqui.
           */}
          {opcionais.length === 0 && (
            <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-line-soft bg-panel-2/40 p-8 text-center text-sm text-ink-3">
              Membresia e saldo {d.nomeComDe} ainda não existem.
              <br />
              Quando existirem, entram neste bloco.
            </div>
          )}
        </div>

        {err && (
          <div className="mt-5 rounded-lg border border-neg/40 bg-neg/10 p-4 text-sm text-neg">
            {err}
          </div>
        )}

        {enviada && (
          <div className="mt-5 rounded-lg border border-pos/40 bg-pos/[.08] p-4 text-sm text-ink-2">
            <p className="font-semibold text-ink">
              Base {d.nomeComDe} atualizada: {enviada.linhas.toLocaleString("pt-BR")} lançamentos.
            </p>
            {/*
             * O aviso de meta, para sempre. Só aparece quando a planilha TEM meta
             * e alguma unidade ficou sem coluna de nome idêntico — sem meta
             * nenhuma, não há o que avisar (ver unidadesSemMetaExata).
             */}
            {enviada.semMetaExata.length > 0 && (
              <div className="mt-3 flex gap-2.5 rounded-md border border-[#E9B949]/40 bg-[#E9B949]/[.08] p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 translate-y-0.5 text-[#E9B949]" />
                <div>
                  <p className="text-ink">
                    {enviada.semMetaExata.length === 1
                      ? "Uma unidade está sem coluna de meta com o nome exato:"
                      : `${enviada.semMetaExata.length} unidades estão sem coluna de meta com o nome exato:`}
                  </p>
                  <p className="mt-1 font-mono text-xs text-ink-2">
                    {enviada.semMetaExata.join(" · ")}
                  </p>
                  <p className="mt-1.5 text-xs">
                    Confira se a planilha tem uma coluna “Meta Anual &lt;unidade&gt;” com exatamente
                    o nome de cada uma — sem ela, a meta da unidade pode sair zerada ou emprestada
                    de outra de nome parecido.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {erroAoAbrir && <p className="mt-3 text-sm text-neg">{erroAoAbrir}</p>}

        {loading && (
          <div className="mt-6">
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

        <div className="mt-6 flex justify-end">
          <Button
            disabled={!financeiroFile || loading}
            onClick={() => void enviar()}
            className="h-11 gap-2 px-6 font-semibold text-background shadow-panel transition-all hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            style={{ background: cor }}
          >
            <UploadCloud className="h-5 w-5" />
            {loading
              ? "Enviando…"
              : baseAtual
                ? `Substituir a base ${d.nomeComDe}`
                : `Enviar a base ${d.nomeComDe}`}
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

export function Upload() {
  const { user } = useApp();
  /*
   * Sobe a cada envio bem-sucedido, para a seção de permissões reler as
   * unidades: a base nova pode ter unidades que a anterior não tinha, ou ter
   * perdido alguma — e a lista de opções e as permissões órfãs mudam com ela.
   */
  const [versao, setVersao] = useState(0);
  const aposEnvio = useCallback(() => setVersao((v) => v + 1), []);

  /*
   * Puxa o código do dashboard enquanto o usuário escolhe os arquivos. Ele é
   * carregado sob demanda para não pesar a tela de senha; começar aqui faz o
   * download acontecer em paralelo com a escolha, e não depois do clique.
   */
  useEffect(() => {
    void import("@/components/Dashboard");
  }, []);

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <p className="text-sm text-ink-3">Olá, {user}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink mt-1">
            Carregar bases de dados
          </h1>
          <p className="text-ink-2 mt-2 max-w-2xl">
            Cada país tem a sua base, enviada no bloco dele. Elas nunca se misturam: enviar uma não
            toca na outra. Depois de enviar, abra o dashboard que quiser — e, lá dentro, troque de
            base no canto superior direito.
          </p>
        </motion.div>

        <BlocoDeEnvio base="brasil" onEnviada={aposEnvio} />
        <BlocoDeEnvio base="angola" onEnviada={aposEnvio} />

        <UnidadesPorPastor versao={versao} />
      </div>
    </div>
  );
}
