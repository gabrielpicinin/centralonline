/*
 * A segunda seção da tela do administrador: quem vê o quê.
 *
 * A lista de unidades não é escrita à mão em lugar nenhum — ela sai da tabela
 * que cada envio de base alimenta. Abrir ou fechar uma igreja se reflete aqui
 * sozinho, no envio seguinte.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  KeyRound,
  UserPlus,
  Check,
  Copy,
  Ban,
  RotateCcw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/dashboard/MultiSelect";
import {
  listarPastoresServer,
  criarPastorServer,
  regerarSenhaServer,
  salvarPermissoesServer,
  definirAtivoServer,
} from "@/lib/pastores.functions";

interface Pastor {
  id: number;
  usuario: string;
  nome: string;
  ativo: boolean;
  unidades: string[];
}

/** Mesma lista, mesma ordem? Só isso decide se a linha tem alteração pendente. */
const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function UnidadesPorPastor() {
  const [pastores, setPastores] = useState<Pastor[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  /*
   * Permissões apontando para unidades que a base atual não tem mais. Quem está
   * nesta lista abre o dashboard e não vê nada — e sem este aviso ninguém
   * descobriria o motivo.
   */
  const [orfas, setOrfas] = useState<{ perfilId: number; unidade: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  /*
   * O que o administrador mexeu e ainda não salvou. Fica separado do que veio
   * do servidor de propósito: é a diferença entre os dois que diz quais linhas
   * estão pendentes, e é ela que o botão de salvar envia.
   */
  const [rascunho, setRascunho] = useState<Record<number, string[]>>({});

  /* A senha aparece uma vez, logo depois de gerada. Não é guardada em texto. */
  const [senhaMostrada, setSenhaMostrada] = useState<{ nome: string; senha: string } | null>(null);
  const [copiada, setCopiada] = useState(false);

  const [abrindoCadastro, setAbrindoCadastro] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoUsuario, setNovoUsuario] = useState("");

  const listar = useServerFn(listarPastoresServer);
  const criar = useServerFn(criarPastorServer);
  const regerar = useServerFn(regerarSenhaServer);
  const salvar = useServerFn(salvarPermissoesServer);
  const definirAtivo = useServerFn(definirAtivoServer);

  const recarregar = useCallback(async () => {
    const r = await listar();
    setPastores(r.pastores);
    setUnidades(r.unidades);
    setOrfas(r.orfas);
    setRascunho({});
  }, [listar]);

  useEffect(() => {
    void recarregar()
      .catch(() => setErro("Não consegui carregar a lista de pastores."))
      .finally(() => setCarregando(false));
  }, [recarregar]);

  const pendentes = useMemo(
    () =>
      pastores
        .filter((p) => rascunho[p.id] && !iguais(rascunho[p.id], p.unidades))
        .map((p) => p.id),
    [pastores, rascunho],
  );

  /*
   * Avisa antes de fechar a aba com alteração não salva. É fácil marcar seis
   * pastores e sair sem apertar o botão — e a perda só apareceria depois, pelo
   * pastor dizendo que não vê nada.
   */
  useEffect(() => {
    if (!pendentes.length) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendentes.length]);

  const unidadesDe = (p: Pastor) => rascunho[p.id] ?? p.unidades;

  const orfasDe = (p: Pastor) => orfas.filter((o) => o.perfilId === p.id).map((o) => o.unidade);

  const marcar = (p: Pastor, novas: string[]) =>
    setRascunho((r) => ({ ...r, [p.id]: [...novas].sort() }));

  const salvarTudo = async () => {
    setSalvando(true);
    setErro("");
    try {
      const r = await salvar({
        data: {
          alteracoes: pendentes.map((id) => ({ perfilId: id, unidades: rascunho[id] })),
        },
      });
      setPastores(r.pastores);
      setOrfas(r.orfas);
      setRascunho({});
    } catch {
      setErro("Não consegui salvar. Nada foi alterado — tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  const cadastrar = async () => {
    setErro("");
    try {
      const r = await criar({ data: { nome: novoNome, usuario: novoUsuario } });
      if (!r.ok) {
        setErro("Já existe uma conta com esse e-mail.");
        return;
      }
      setSenhaMostrada({ nome: r.perfil.nome, senha: r.senha });
      setCopiada(false);
      setNovoNome("");
      setNovoUsuario("");
      setAbrindoCadastro(false);
      await recarregar();
    } catch {
      setErro("Não consegui cadastrar. Confira o nome e o e-mail.");
    }
  };

  const novaSenha = async (p: Pastor) => {
    if (!confirm(`Gerar uma senha nova para ${p.nome}? A senha atual deixa de valer na hora.`))
      return;
    setErro("");
    try {
      const r = await regerar({ data: { perfilId: p.id } });
      if (r.ok) {
        setSenhaMostrada({ nome: p.nome, senha: r.senha });
        setCopiada(false);
      }
    } catch {
      setErro("Não consegui gerar a senha.");
    }
  };

  const alternarAtivo = async (p: Pastor) => {
    const acao = p.ativo ? "desativar" : "reativar";
    if (!confirm(`Deseja ${acao} o acesso de ${p.nome}?`)) return;
    try {
      const r = await definirAtivo({ data: { perfilId: p.id, ativo: !p.ativo } });
      if (r.ok) {
        setPastores(r.pastores);
        setOrfas(r.orfas);
      }
    } catch {
      setErro(`Não consegui ${acao} a conta.`);
    }
  };

  return (
    <section className="mt-10">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Unidades por pastor</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAbrindoCadastro((v) => !v)}
          className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
        >
          <UserPlus className="h-4 w-4" />
          Adicionar pastor
        </Button>
      </div>
      <p className="mb-5 max-w-2xl text-sm text-ink-2">
        Marque as unidades que cada pastor poderá ver no dashboard. As mudanças passam a valer
        quando você salvar.
      </p>

      {orfas.length > 0 && (
        <div className="mb-5 flex gap-3 rounded-xl border border-[#E9B949]/40 bg-[#E9B949]/[.08] p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-[#E9B949]" />
          <div className="text-sm text-ink-2">
            <p className="font-semibold text-ink">
              {orfas.length === 1
                ? "Uma permissão aponta para uma unidade que a base atual não tem"
                : `${orfas.length} permissões apontam para unidades que a base atual não tem`}
            </p>
            <p className="mt-1">
              Quem estiver marcado nelas abre o dashboard e não vê nada. Costuma acontecer quando
              uma unidade muda de nome ou deixa de aparecer na planilha. Remarque as unidades certas
              nas linhas destacadas abaixo e salve.
            </p>
            <p className="mt-1.5 font-mono text-xs text-ink-3">
              {[...new Set(orfas.map((o) => o.unidade))].join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* A senha aparece aqui, uma vez. Fica em cima para não passar despercebida. */}
      {senhaMostrada && (
        <div className="mb-5 rounded-xl border border-pos/40 bg-pos/[.08] p-4">
          <p className="text-sm font-semibold text-ink">Senha de {senhaMostrada.nome}</p>
          <p className="mt-1 text-sm text-ink-2">
            Copie e passe para ele. Ela não aparece de novo — se perder, gere outra pela chave na
            linha dele.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-line-strong bg-panel-2 px-3 py-2 font-mono text-base text-ink">
              {senhaMostrada.senha}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(senhaMostrada.senha);
                setCopiada(true);
              }}
              className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
            >
              {copiada ? <Check className="h-4 w-4 text-pos" /> : <Copy className="h-4 w-4" />}
              {copiada ? "Copiada" : "Copiar"}
            </Button>
            <button
              type="button"
              onClick={() => setSenhaMostrada(null)}
              className="text-sm text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
            >
              Já anotei, pode fechar
            </button>
          </div>
        </div>
      )}

      {abrindoCadastro && (
        <div className="mb-5 rounded-xl border border-line-soft bg-panel p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="np">Nome</Label>
              <Input
                id="np"
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Pr. João Abrão"
                className="h-10 border-line-strong bg-panel-2 text-ink placeholder:text-ink-3 focus-visible:border-acc"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nu">E-mail (será o usuário dele)</Label>
              <Input
                id="nu"
                value={novoUsuario}
                onChange={(e) => setNovoUsuario(e.target.value)}
                placeholder="joao.abrao@central.online"
                className="h-10 border-line-strong bg-panel-2 text-ink placeholder:text-ink-3 focus-visible:border-acc"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button
              size="sm"
              onClick={cadastrar}
              disabled={novoNome.trim().length < 2 || !novoUsuario.includes("@")}
              className="bg-acc font-semibold text-background hover:brightness-110 disabled:opacity-40"
            >
              Cadastrar e gerar senha
            </Button>
            <button
              type="button"
              onClick={() => setAbrindoCadastro(false)}
              className="text-sm text-ink-3 hover:text-ink-2"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line-soft bg-panel">
        {carregando ? (
          <p className="p-6 text-center text-sm text-ink-3">Carregando…</p>
        ) : pastores.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-3">
            Nenhum pastor cadastrado ainda. Use “Adicionar pastor” acima.
          </p>
        ) : (
          pastores.map((p) => {
            const pendente = pendentes.includes(p.id);
            const semBase = orfasDe(p);
            return (
              <div
                key={p.id}
                className={`grid grid-cols-1 items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0 md:grid-cols-[1fr_280px_auto] ${
                  pendente ? "bg-acc/[.06]" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className={`truncate text-sm ${p.ativo ? "text-ink" : "text-ink-3"}`}>
                    {p.nome}
                    {!p.ativo && (
                      <span className="ml-2 rounded border border-line-strong px-1.5 py-0.5 text-[10.5px] uppercase tracking-wide text-ink-3">
                        desativado
                      </span>
                    )}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-3">{p.usuario}</p>
                  {semBase.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-[#E9B949]">
                      fora da base atual: {semBase.join(", ")}
                    </p>
                  )}
                </div>

                <MultiSelect
                  options={unidades}
                  selected={unidadesDe(p)}
                  onChange={(novas) => marcar(p, novas)}
                  allLabel="Todas as unidades"
                  noneLabel="Nenhuma unidade"
                  triggerClassName={
                    pendente ? "border-acc" : semBase.length ? "border-[#E9B949]/60" : ""
                  }
                  popoverWidthClass="w-80"
                />

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Gerar senha nova"
                    onClick={() => void novaSenha(p)}
                    className="grid h-9 w-9 place-content-center rounded-lg text-ink-3 transition hover:bg-panel-2 hover:text-ink"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title={p.ativo ? "Desativar acesso" : "Reativar acesso"}
                    onClick={() => void alternarAtivo(p)}
                    className="grid h-9 w-9 place-content-center rounded-lg text-ink-3 transition hover:bg-panel-2 hover:text-ink"
                  >
                    {p.ativo ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {erro && <p className="mt-3 text-sm text-neg">{erro}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button
          onClick={salvarTudo}
          disabled={!pendentes.length || salvando}
          className="gap-2 bg-acc font-semibold text-background hover:brightness-110 disabled:opacity-40"
        >
          {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
          {salvando ? "Salvando…" : "Salvar seleções"}
        </Button>
        {pendentes.length > 0 && (
          <span className="font-mono text-sm text-[#E9B949]">
            {pendentes.length === 1
              ? "1 pastor com alteração não salva"
              : `${pendentes.length} pastores com alteração não salva`}
          </span>
        )}
      </div>
    </section>
  );
}
