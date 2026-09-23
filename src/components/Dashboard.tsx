import { useEffect, useMemo, useState } from "react";
import { LogOut, Calendar, FilterX, SlidersHorizontal, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApp } from "@/lib/appState";
import { isDizimosOfertas, norm } from "@/lib/parsers";
import { MESES } from "@/lib/format";
import { LogoCentral } from "./LogoCentral";
import { MultiSelect } from "./dashboard/MultiSelect";
import { Section1Total } from "./dashboard/Section1Total";
import { Section2Despesas } from "./dashboard/Section2Despesas";
import { Section3Metas } from "./dashboard/Section3Metas";
import { EntradasDiarias } from "./dashboard/EntradasDiarias";
import { SectionDeck, type SecaoDef } from "./dashboard/SectionDeck";

export function Dashboard() {
  const {
    financial,
    membership,
    saldo,
    metaAnualPorUnidade,
    metaAnualTotalGeral,
    user,
    papel,
    setStep,
    signOut,
  } = useApp();

  const anos = useMemo(() => {
    const set = new Set<number>();
    for (const r of financial) if (r.ano) set.add(r.ano);
    return Array.from(set).sort((a, b) => b - a);
  }, [financial]);

  const unidades = useMemo(() => {
    const set = new Set<string>();
    for (const r of financial) if (r.unidade) set.add(r.unidade.trim());
    return Array.from(set).sort();
  }, [financial]);

  /*
   * Como chamar "nenhum filtro de unidade" nesta sessão.
   *
   * Para o administrador é "Total Geral", porque é literalmente isso. Para o
   * pastor seria mentira: ele não está vendo a rede, está vendo as igrejas
   * dele, e chamar aquilo de Total Geral faria um número de duas unidades
   * passar por número da Central inteira.
   *
   * O nome é decidido aqui, uma vez, e desce para as seções. Cada uma decidindo
   * por si é o tipo de coisa que fica divergindo com o tempo — e divergir aqui
   * significa duas telas discordando sobre o que o mesmo número representa.
   */
  const rotuloTodasUnidades = useMemo(() => {
    if (papel !== "pastor") return "Total Geral";
    if (unidades.length === 0) return "Nenhuma unidade";
    /*
     * Os nomes, sempre — não uma contagem. "Minhas 3 unidades" obrigaria o
     * pastor a abrir o filtro para lembrar de quais números está olhando; os
     * nomes respondem isso sem clique. Onde não couber, o texto é cortado com
     * reticências e o nome completo fica no title do elemento.
     */
    return unidades.join(", ");
  }, [papel, unidades.join("|")]);

  const defaultAno = anos[0] ?? new Date().getFullYear();

  /*
   * Filtros universais. Vivem só aqui: nenhuma seção tem controle próprio, e
   * todas recebem a base já recortada, então mexer no cabeçalho move o
   * dashboard inteiro de uma vez.
   */
  const [ano, setAno] = useState<number>(defaultAno);
  const [unidadesSel, setUnidadesSel] = useState<string[]>([]);
  const [mesesSel, setMesesSel] = useState<number[]>([]);
  const [nat3Sel, setNat3Sel] = useState<string[]>([]);
  const [projetoSel, setProjetoSel] = useState<string[]>([]);
  const [metaSel, setMetaSel] = useState<string[]>([]);

  // Base nova (outro upload): o ano volta para o mais recente dela.
  useEffect(() => {
    setAno(defaultAno);
  }, [defaultAno]);

  /*
   * Marcar todas as opções tem de valer o mesmo que não marcar nenhuma — é o que
   * o próprio botão já diz ("Todas"). Sem essa redução, um filtro com tudo
   * marcado ainda excluía as linhas de valor vazio (dízimos não têm Meta nem
   * Projeto), esvaziando as Seções 1 e 2; e, no caso da unidade, fazia a meta
   * ser somada por unidade em vez de vir do "Total Geral".
   */
  const semTudo = (sel: string[], total: number) => (total > 0 && sel.length >= total ? [] : sel);

  const uniSel = useMemo(() => semTudo(unidadesSel, unidades.length), [unidadesSel, unidades]);

  /*
   * Quando ler "Crédito 2" / "Débito 2" em vez de "Crédito" / "Débito".
   *
   * Só na visão CONSOLIDADA DO ADMINISTRADOR: o Financeiro olhando a rede
   * inteira — "Total Geral", ou todas as unidades marcadas, que o semTudo
   * acima já reduz ao mesmo estado. Recortou algumas unidades, volta para as
   * colunas de sempre.
   *
   * Pastor nunca, nem vendo todas as unidades dele. Decisão da Central: para
   * os pastores o dashboard fica exatamente como estava.
   *
   * POR QUE NÃO USAR "DÉBITO 2" SEMPRE — e não mude isso sem ler: as colunas
   * "2" eliminam as transferências entre unidades. Medido na base de 2026: na
   * rede inteira, receita e despesa caem exatamente o mesmo valor
   * (R$ 10.060.070,71), que é a assinatura de dinheiro saindo de uma unidade e
   * entrando em outra. Para a rede, eliminar isso está certo: é dinheiro
   * circulando dentro da própria Central. Para UMA unidade, está errado — o
   * dinheiro saiu dela de verdade. Com "Débito 2", a Central Contagem aparece
   * com 0,0% para Central Missionária e 0,0% para Assistência Social, quando na
   * realidade mandou 13,3% e 8,3% das despesas para esses fundos. A unidade
   * pareceria não ter contribuído com nada.
   *
   * Calculado aqui, uma vez, e passado às seções, para que os cards e o
   * gráfico de metas nunca discordem sobre qual coluna está valendo — as barras
   * do gráfico são porcentagens da mesma despesa total que o card mostra.
   */
  const usarColunas2 = papel === "admin" && uniSel.length === 0;
  const mesSel = useMemo(() => semTudo(mesesSel.map(String), 12).map(Number), [mesesSel]);

  /*
   * Os recortes são encaixados: unidade, depois mês, depois ano. Cada degrau
   * fica exposto porque duas visualizações precisam enxergar por cima de um dos
   * filtros — a tabela da Seção 2 compara com o ano anterior, e a esteira do
   * Gráfico 2 folheia os meses. Do recorte de ano saem também as opções dos três
   * filtros de detalhe, para a lista de projetos ou metas mostrar só o que
   * existe no período escolhido em vez de tudo o que já existiu na base.
   */
  const escopoUnidade = useMemo(() => {
    if (!uniSel.length) return financial;
    const uSet = new Set(uniSel.map(norm));
    return financial.filter((r) => uSet.has(norm(r.unidade)));
  }, [financial, uniSel.join("|")]);

  /** Ano e unidade aplicados, mês não: é o que a esteira do Gráfico 2 folheia. */
  const escopoAnoSemMes = useMemo(
    () => escopoUnidade.filter((r) => r.ano === ano),
    [escopoUnidade, ano],
  );

  /*
   * O recorte de mês sai do recorte de ano, e não da base inteira: o filtro roda
   * sobre um ano de lançamentos em vez de sobre todos os anos da planilha. O
   * conjunto resultante é idêntico — unidade, ano e mês são condições
   * independentes, a ordem não muda quem passa.
   */
  const escopoAno = useMemo(() => {
    if (!mesSel.length) return escopoAnoSemMes;
    const mSet = new Set(mesSel);
    return escopoAnoSemMes.filter((r) => mSet.has(r.mes));
  }, [escopoAnoSemMes, mesSel.join(",")]);

  /*
   * As três listas saem de uma varredura só. Eram três, uma por campo, cada uma
   * relendo o mesmo recorte do começo ao fim.
   */
  const { nat3Options, projetoOptions, metaOptions } = useMemo(() => {
    const nat3 = new Set<string>();
    const projeto = new Set<string>();
    const meta = new Set<string>();
    for (const r of escopoAno) {
      if (r.nat3) nat3.add(r.nat3);
      if (r.projeto) projeto.add(r.projeto);
      if (r.meta) meta.add(r.meta);
    }
    const ordenar = (s: Set<string>) => Array.from(s).sort();
    return {
      nat3Options: ordenar(nat3),
      projetoOptions: ordenar(projeto),
      metaOptions: ordenar(meta),
    };
  }, [escopoAno]);

  /*
   * Poda seleções que sumiram do universo — trocar a unidade, por exemplo, muda
   * a lista de projetos. Sem isso o dashboard poderia esvaziar filtrando por um
   * projeto que não existe mais no recorte, e pior: quando sobra a mesma
   * quantidade de opções que de selecionados, o botão volta a dizer "Todos".
   */
  useEffect(() => {
    const podar = (ops: string[]) => (atual: string[]) => {
      const proximo = atual.filter((v) => ops.includes(v));
      // Devolver a referência original faz o React não re-renderizar à toa.
      return proximo.length === atual.length ? atual : proximo;
    };
    setNat3Sel(podar(nat3Options));
    setProjetoSel(podar(projetoOptions));
    setMetaSel(podar(metaOptions));
  }, [nat3Options, projetoOptions, metaOptions]);

  const aplicaDetalhe = useMemo(() => {
    // Mesma redução do "tudo marcado = sem filtro" aplicada aos três detalhes.
    const n3Sel = semTudo(nat3Sel, nat3Options.length);
    const pjSel = semTudo(projetoSel, projetoOptions.length);
    const mtSel = semTudo(metaSel, metaOptions.length);
    const n3 = new Set(n3Sel.map(norm));
    const pj = new Set(pjSel.map(norm));
    const mt = new Set(mtSel.map(norm));
    return (rows: typeof financial) =>
      rows.filter((r) => {
        if (n3Sel.length && !n3.has(norm(r.nat3))) return false;
        if (pjSel.length && !pj.has(norm(r.projeto))) return false;
        if (mtSel.length && !mt.has(norm(r.meta))) return false;
        return true;
      });
  }, [
    nat3Sel.join("|"),
    projetoSel.join("|"),
    metaSel.join("|"),
    nat3Options.length,
    projetoOptions.length,
    metaOptions.length,
  ]);

  /** A base que as seções enxergam: os seis filtros já aplicados. */
  const dados = useMemo(() => aplicaDetalhe(escopoAno), [aplicaDetalhe, escopoAno]);

  /*
   * Total de Dízimos e Ofertas do recorte — denominador da aba "Relação entre
   * Dízimos e Ofertas" no tooltip da Seção 4.
   *
   * Lê a coluna "Crédito" (credito1), a mesma do card da Seção 1, para as duas
   * telas nunca discordarem sobre quanto a igreja arrecadou.
   *
   * Sai de escopoAno, e não de `dados`: as linhas de dízimo têm Meta e Projeto
   * vazios, então filtrar por qualquer meta ou projeto no cabeçalho as varreria
   * e o denominador iria a zero — a aba mostraria porcentagens infinitas
   * justamente quando alguém fosse investigar uma meta específica.
   */
  const dizimosOfertas = useMemo(
    () => escopoAno.reduce((s, r) => (isDizimosOfertas(r.nat2) ? s + r.credito1 : s), 0),
    [escopoAno],
  );

  /*
   * Saldo por centro de resultado. Só o filtro de unidade o alcança: é um saldo
   * acumulado, uma fotografia de um instante, e recortá-lo por mês ou natureza
   * não teria significado — o saldo de janeiro não é "a parte de janeiro" de
   * nada, é o que havia em janeiro.
   */
  const saldoFiltrado = useMemo(() => {
    if (!uniSel.length) return saldo;
    const uSet = new Set(uniSel.map(norm));
    return saldo.filter((r) => uSet.has(norm(r.unidade)));
  }, [saldo, uniSel.join("|")]);

  /** A mesma base sem o recorte de mês, para a esteira do Gráfico 2. */
  const dadosTodosMeses = useMemo(
    () => aplicaDetalhe(escopoAnoSemMes),
    [aplicaDetalhe, escopoAnoSemMes],
  );

  const logout = () => {
    void signOut();
  };

  /*
   * "Limpar Filtros". O ano não tem estado vazio — é seleção única — então o
   * limpo dele é o ano mais recente da base, que é onde o dashboard abre.
   */
  const temFiltro =
    ano !== defaultAno ||
    uniSel.length > 0 ||
    mesSel.length > 0 ||
    semTudo(nat3Sel, nat3Options.length).length > 0 ||
    semTudo(projetoSel, projetoOptions.length).length > 0 ||
    semTudo(metaSel, metaOptions.length).length > 0;

  const limparFiltros = () => {
    setAno(defaultAno);
    setUnidadesSel([]);
    setMesesSel([]);
    setNat3Sel([]);
    setProjetoSel([]);
    setMetaSel([]);
  };

  const secoes: SecaoDef[] = useMemo(
    () => [
      {
        id: "total",
        numero: 1,
        titulo: rotuloTodasUnidades,
        conteudo: (
          <Section1Total
            rotuloTodasUnidades={rotuloTodasUnidades}
            usarColunas2={usarColunas2}
            financial={dados}
            membership={membership}
            metaAnualPorUnidade={metaAnualPorUnidade}
            metaAnualTotalGeral={metaAnualTotalGeral}
            saldo={saldoFiltrado}
            ano={ano}
            unidadesSel={uniSel}
            mesesSel={mesSel}
          />
        ),
      },
      {
        id: "diario",
        numero: 2,
        titulo: "Acumulado Diário",
        conteudo: (
          <EntradasDiarias
            rotuloTodasUnidades={rotuloTodasUnidades}
            financial={dados}
            financialBruto={financial}
            financialTodosMeses={dadosTodosMeses}
            membership={membership}
            metaAnualPorUnidade={metaAnualPorUnidade}
            metaAnualTotalGeral={metaAnualTotalGeral}
            unidades={unidades}
            unidadesSel={uniSel}
            mesesSel={mesSel}
            ano={ano}
          />
        ),
      },
      {
        id: "despesas",
        numero: 3,
        titulo: "Análise de Despesas",
        conteudo: <Section2Despesas financial={dados} />,
      },
      {
        id: "metas",
        numero: 4,
        titulo: "Controle de Metas",
        conteudo: (
          // O card de metas é o próprio conteúdo da seção; a moldura com padding
          // fica aqui para ele não encostar nas bordas do quadro de design.
          <div className="flex h-full w-full min-h-0 flex-col p-6">
            <Section3Metas
              financial={dados}
              dizimosOfertas={dizimosOfertas}
              usarColunas2={usarColunas2}
            />
          </div>
        ),
      },
    ],
    [
      dados,
      dadosTodosMeses,
      saldoFiltrado,
      membership,
      metaAnualPorUnidade,
      metaAnualTotalGeral,
      unidades,
      uniSel,
      mesSel,
      ano,
    ],
  );

  /*
   * Sem nenhuma linha, o dashboard desenharia uma parede de zeros — e quem
   * olhasse não saberia se o sistema está quebrado, se a base não foi enviada
   * ou se ele não tem permissão. Um recado explicando custa menos do que a
   * ligação que o silêncio geraria.
   */
  if (!financial.length) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <header className="flex items-center justify-between gap-4 border-b border-line-soft bg-panel px-6 py-3">
          <div className="flex items-center gap-3">
            <LogoCentral className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Dashboard Financeiro Central
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-ink-2 sm:inline">{user}</span>
            {papel === "admin" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("upload")}
                className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Bases e permissões</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="gap-2 text-ink-2 hover:bg-panel-2 hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </header>

        <div className="grid flex-1 place-content-center px-6">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-content-center rounded-xl bg-panel-2 text-ink-3">
              <FolderOpen className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              Nenhum dado para mostrar
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
              {papel === "admin"
                ? "Ainda não há base de dados no servidor. Envie as planilhas em “Bases e permissões” para o dashboard aparecer."
                : "Nenhuma unidade foi liberada para o seu acesso ainda, ou a base do período ainda não foi enviada. Fale com o Financeiro da Central."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    /*
     * Coluna: o cabeçalho ocupa o que precisar e o deck fica com o resto exato
     * da tela. Antes a altura do deck era uma constante escrita à mão, que
     * quebraria agora que o cabeçalho ganhou a faixa de filtros.
     */
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="z-30 shrink-0 border-b border-line-soft bg-panel/85 backdrop-blur-md">
        <div className="flex items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-3">
            <LogoCentral className="h-9 w-9 shrink-0" />
            <p className="text-[15px] font-semibold leading-tight text-ink">
              Dashboard Financeiro Central
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-ink-2 sm:inline">{user}</span>
            {/*
             * Só o administrador vê o caminho de volta. Sem ele, mudar a unidade
             * de um pastor exigiria sair e entrar de novo — e a checagem de
             * papel que vale é a do servidor; isto aqui só evita desenhar um
             * botão que não levaria a lugar nenhum.
             */}
            {papel === "admin" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep("upload")}
                className="gap-2 border-line-strong bg-panel-2 text-ink hover:border-acc hover:bg-panel-2 hover:text-ink"
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Bases e permissões</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="gap-2 text-ink-2 hover:bg-panel-2 hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>

        {/* Faixa de filtros universais. */}
        <div className="flex flex-wrap items-end gap-3 border-t border-line-soft px-6 pb-3 pt-2">
          <div className="min-w-[110px]">
            <label className="mb-1 block text-xs text-ink-3">Ano</label>
            <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
              <SelectTrigger className="h-10 border-line-strong bg-panel-2 text-ink shadow-panel transition hover:border-acc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-line-strong bg-panel-2 text-ink">
                {anos.map((a) => (
                  <SelectItem key={a} value={String(a)}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <MultiSelect
            label="Unidade"
            options={unidades}
            selected={unidadesSel}
            onChange={setUnidadesSel}
            allLabel={rotuloTodasUnidades}
            triggerClassName="min-w-[180px] flex-1"
          />
          <MultiSelect
            label="Mês"
            options={MESES}
            selected={mesesSel.map((m) => MESES[m - 1])}
            onChange={(vals) =>
              setMesesSel(vals.map((v) => MESES.indexOf(v) + 1).sort((a, b) => a - b))
            }
            allLabel="Todos"
            triggerClassName="min-w-[150px] flex-1"
            popoverWidthClass="w-56"
            icon={<Calendar className="h-4 w-4 text-ink-3" />}
          />
          <MultiSelect
            label="Natureza Nível 3"
            options={nat3Options}
            selected={nat3Sel}
            onChange={setNat3Sel}
            allLabel="Todas"
            triggerClassName="min-w-[190px] flex-1"
          />
          <MultiSelect
            label="Projeto"
            options={projetoOptions}
            selected={projetoSel}
            onChange={setProjetoSel}
            allLabel="Todos"
            triggerClassName="min-w-[190px] flex-1"
          />
          <MultiSelect
            label="Meta"
            options={metaOptions}
            selected={metaSel}
            onChange={setMetaSel}
            allLabel="Todas"
            triggerClassName="min-w-[170px] flex-1"
          />
          <button
            type="button"
            onClick={limparFiltros}
            disabled={!temFiltro}
            title="Voltar todos os filtros ao estado inicial"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-panel-2 px-3 text-sm text-ink-2 shadow-panel transition hover:border-acc hover:text-ink active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-ink-2 disabled:active:scale-100"
          >
            <FilterX className="h-4 w-4" />
            Limpar Filtros
          </button>
        </div>
      </header>

      {/*
       * Sem rolagem: o deck ocupa exatamente o que sobra da tela e escala a
       * seção ativa para caber. Trocar de seção é clicar, não rolar.
       */}
      <div className="min-h-0 flex-1">
        <SectionDeck secoes={secoes} />
      </div>
    </div>
  );
}
