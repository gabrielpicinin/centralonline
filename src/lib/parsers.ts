/*
 * Com a extensão `.ts`: os testes carregam este arquivo direto no Node — ver o
 * comentário em src/lib/consolidado.ts.
 */
import { DECLARACOES, type Base, type DeclaracaoBase } from "./bases.ts";
import { temMetaDeDizimos } from "./presenca.ts";

export type RawRow = Record<string, unknown>;

export interface FinancialRow {
  unidade: string; // a coluna de unidade da base — ver bases.ts
  nat2: string; // Descrição Nat. 2º Nível
  nat3: string; // Descrição Nat. 3º Nível
  nat4: string; // Descrição Nat. 4º Nível
  razaoSocial: string; // Razão Social Parceiro
  projeto: string; // Nome Projeto
  meta: string; // Meta
  credito: number; // Crédito 2
  credito1: number; // Crédito
  debito: number; // Débito 2
  debito1: number; // Débito
  data: Date | null; // a coluna de data da base — ver bases.ts
  dia: number;
  mes: number; // Mês Baixa
  ano: number; // Ano Baixa
  nroUnico: string; // Nro. Único Financeiro
}

export interface MembershipRow {
  unidade: string;
  meses: Record<string, number>; // key like "jan/26"
}

export interface FinancialParsed {
  rows: FinancialRow[];
  /** Meta MENSAL por unidade (= anual / 12). */
  metaPorUnidade: Record<string, number>;
  /** Meta ANUAL por unidade, como vem da coluna "Meta Anual <Unidade>". */
  metaAnualPorUnidade: Record<string, number>;
  /** Coluna "Meta Anual Total Geral": meta anual de todas as unidades juntas. */
  metaAnualTotalGeral: number;
  /**
   * Unidades da planilha sem coluna "Meta Anual <unidade>" de nome IDÊNTICO.
   *
   * É para o aviso da tela de envio, e não recusa nada: unidade sem meta é um
   * caso legítimo. Mas onde a busca aproximada ainda está ligada (Brasil), uma
   * unidade desta lista pode estar pegando a meta de outra de nome parecido; e
   * onde o casamento é exato, fica com meta zero. Nos dois casos o número na
   * tela parece verdade — então quem envia precisa saber.
   *
   * Vazia quando a planilha não tem meta nenhuma: aí não há o que avisar.
   */
  unidadesSemMetaExata: string[];
}

/**
 * A planilha não serve para a base em que foi enviada.
 *
 * É lançada em vez de "ler do jeito que der": uma planilha errada lida sem
 * reclamar vira um dashboard plausível e falso — ou, no pior caso, substitui a
 * base inteira de um país pela do outro. A mensagem é escrita para quem envia,
 * e aparece na tela de envio do jeito que está.
 */
export class PlanilhaRecusada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PlanilhaRecusada";
  }
}

const MES_MAP: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

/*
 * norm() roda dentro dos predicados de filtro, linha a linha. Numa base de 20 mil
 * lan\u00e7amentos s\u00e3o centenas de milhares de chamadas a cada clique de filtro \u2014
 * quase todas sobre as mesmas poucas dezenas de strings distintas: nomes de
 * unidade, natureza, projeto, meta. O NFD \u00e9 a parte cara; medido, ele responde
 * por 8x o custo de um toLowerCase puro. O cache guarda o resultado por entrada.
 *
 * O teto existe para o caso patol\u00f3gico de uma coluna com valor \u00fanico por linha,
 * em que o Map cresceria junto com a base. Ao estourar, esvazia e recome\u00e7a: o
 * pior caso volta ao custo de antes, nunca a um vazamento de mem\u00f3ria.
 */
const LIMITE_CACHE_NORM = 50_000;
const cacheNorm = new Map<string, string>();

export const norm = (s: unknown) => {
  const bruto = (s ?? "").toString();
  const guardado = cacheNorm.get(bruto);
  if (guardado !== undefined) return guardado;
  const limpo = bruto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (cacheNorm.size >= LIMITE_CACHE_NORM) cacheNorm.clear();
  cacheNorm.set(bruto, limpo);
  return limpo;
};

function pickKey(row: RawRow, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const t = norm(cand);
    const found = keys.find((k) => norm(k) === t);
    if (found) return found;
  }
  for (const cand of candidates) {
    const t = norm(cand);
    const found = keys.find((k) => norm(k).includes(t));
    if (found) return found;
  }
  return undefined;
}

/*
 * A coluna cujo cabeçalho é EXATAMENTE este nome — depois de tirar acento,
 * maiúscula e espaço nas pontas, e nada além disso. Sem o "contém" do pickKey:
 * ver em bases.ts por que as colunas que definem unidade e data não aceitam
 * palpite.
 */
function colunaExata(row: RawRow, nome: string): string | undefined {
  const alvo = norm(nome);
  return Object.keys(row).find((k) => norm(k) === alvo);
}

function parseNumber(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  s = s.replace(/R\$|\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function parseInt0(v: unknown): number {
  const n = parseNumber(v);
  return Math.trunc(n);
}

function parseMonth(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  const s = norm(v);
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return MES_MAP[s.slice(0, 3)] ?? 0;
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isFinite(v.getTime()) ? v : null;
  if (typeof v === "number") {
    // Excel serial date
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + v * 86400000);
    return isFinite(d.getTime()) ? d : null;
  }
  const s = String(v).trim();
  /*
   * As barras invertidas antes de / e - NÃO são supérfluas, por mais que o lint
   * diga que são. Dentro da classe, o hífen fica entre "/" e "." — sem o escape
   * ele vira um INTERVALO de 0x2F a 0x2E, que está fora de ordem, e o regex
   * deixa de compilar. Verificado: rodar "eslint --fix" aqui derruba a leitura
   * de datas inteira, com "Range out of order in character class".
   */
  // eslint-disable-next-line no-useless-escape
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  }
  const iso = new Date(s);
  return isFinite(iso.getTime()) ? iso : null;
}

function decodeBytes(buf: ArrayBuffer): string {
  let bytes = new Uint8Array(buf);
  // Strip UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/*
 * Os dois leitores entram por import dinâmico, e cada um só desce quando um
 * arquivo do seu tipo aparece. Estáticos, eles viajavam no pacote inicial: o
 * SheetJS sozinho pesa ~745 KB e era baixado por quem só ia ver a tela de senha,
 * e nunca por quem sobe apenas CSV.
 */
export async function parseFile(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".csv")) {
    const { default: Papa } = await import("papaparse");
    const text = decodeBytes(buf);
    return new Promise((resolve, reject) => {
      Papa.parse<RawRow>(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimiter: ";",
        complete: (res) => resolve(res.data as RawRow[]),
        error: reject,
      });
    });
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: true });
}

/**
 * Lê a planilha financeira de UMA base.
 *
 * A base declara de qual coluna sai a unidade e de qual sai a data, e o que a
 * planilha precisa ter para ser aceita como dela (ver bases.ts). O parser não
 * adivinha nada disso.
 *
 * Lança PlanilhaRecusada, com a mensagem pronta para a tela, quando falta
 * coluna essencial ou quando a assinatura não bate — o arquivo de um país
 * enviado no lugar do outro. Recusar aqui, no navegador, é recusar antes de
 * qualquer linha sair para o servidor: a base que está lá fica intacta.
 */
export function normalizeFinancial(rows: RawRow[], base: Base): FinancialParsed {
  const declaracao = DECLARACOES[base];
  if (!rows.length)
    return {
      rows: [],
      metaPorUnidade: {},
      metaAnualPorUnidade: {},
      metaAnualTotalGeral: 0,
      unidadesSemMetaExata: [],
    };
  const sample = rows[0];

  /*
   * Por nome EXATO: as duas colunas que a base declara, e também dia, mês e
   * ano. As de tempo entraram na lista por causa de Angola — na falta de "Ano
   * Baixa", o "contém" do pickKey sairia procurando "ano" em qualquer
   * cabeçalho, e um "Plano de Contas" tem "ano": o ano de todo lançamento
   * viraria zero. O Brasil tem as quatro com o nome exato, então para ele nada
   * muda.
   */
  const kUnidade = colunaExata(sample, declaracao.colunas.unidade);
  const kData = colunaExata(sample, declaracao.colunas.data);
  const kDia = colunaExata(sample, "Dia Baixa") ?? colunaExata(sample, "Dia");
  const kMes = colunaExata(sample, "Mês Baixa");
  const kAno = colunaExata(sample, "Ano Baixa") ?? colunaExata(sample, "Ano");
  const kNat2 = pickKey(sample, ["Descrição Nat. 2º Nível", "Descricao Nat 2 Nivel", "Nat 2"]);
  const kNat3 = pickKey(sample, ["Descrição Nat. 3º Nível", "Descricao Nat 3 Nivel", "Nat 3"]);
  const kNat4 = pickKey(sample, ["Descrição Nat. 4º Nível", "Descricao Nat 4 Nivel", "Nat 4"]);
  const kRazao = pickKey(sample, [
    "Razão Social Parceiro",
    "Razao Social Parceiro",
    "Razão Social",
    "Razao Social",
  ]);
  const kProjeto = pickKey(sample, ["Nome Projeto", "Projeto"]);
  const kMeta = pickKey(sample, ["Meta"]);
  const kCredito = pickKey(sample, ["Crédito 2", "Credito 2", "Crédito2"]);
  const kDebito = pickKey(sample, ["Débito  2", "Debito 2", "Débito 2"]);
  const keys0 = Object.keys(sample);
  // As colunas "Crédito"/"Débito" puras convivem com "Crédito 2"/"Débito 2";
  // pegamos a que casa exatamente e, na falta dela, a primeira que não seja a "2".
  const kDebito1 =
    keys0.find((k) => /^debito$/.test(norm(k))) ??
    keys0.find((k) => norm(k).startsWith("debito") && k !== kDebito);
  const kCredito1 =
    keys0.find((k) => /^credito$/.test(norm(k))) ??
    keys0.find((k) => norm(k).startsWith("credito") && k !== kCredito);
  const kNro = pickKey(sample, ["Nro. Único Financeiro", "Nro Unico Financeiro", "Nro Unico"]);

  /*
   * Metas. A base traz uma coluna por unidade — "Meta Anual <Unidade>" — com o
   * valor ANUAL, mais uma "Meta Anual Total Geral" com o consolidado de todas.
   * O total geral é lido à parte, nunca somado com as unidades: ele já é a soma
   * delas, e somar de novo dobraria a meta.
   *
   * Bases antigas usavam "Meta Entradas <Unidade>" com o valor MENSAL; esse
   * formato continua aceito e é convertido para anual (× 12).
   */
  const colunasMeta = (prefixo: RegExp) =>
    Object.keys(sample)
      .filter((k) => prefixo.test(norm(k)))
      .map((col) => ({ col, unidade: norm(col).replace(prefixo, "").trim(), rotulo: col }));

  const anuais = colunasMeta(/^meta anual /);
  const mensaisAntigas = colunasMeta(/^meta entradas /);
  const usaAnual = anuais.length > 0;
  const colunas = usaAnual ? anuais : mensaisAntigas;

  // O maior valor da coluna: a meta se repete em toda linha, mas há células
  // vazias ou zeradas em lançamentos de outras naturezas.
  const maiorDaColuna = (col: string) => {
    let max = 0;
    for (const r of rows) {
      const v = parseNumber(r[col]);
      if (v > max) max = v;
    }
    return max;
  };

  const metaAnualPorUnidade: Record<string, number> = {};
  let metaAnualTotalGeral = 0;

  for (const { col, unidade, rotulo } of colunas) {
    const valor = maiorDaColuna(col);
    /*
     * Zero é resposta, não ausência: uma unidade pode ter meta 0 (é o caso de
     * "Central Picos - Missões"). Pular a coluna deixaria a unidade sem registro
     * e a busca por nome cairia na unidade de nome parecido — "Central Picos" —
     * emprestando a meta dela.
     */
    if (valor < 0) continue;
    const anual = usaAnual ? valor : valor * 12;
    if (unidade === "total geral") {
      metaAnualTotalGeral = anual;
    } else {
      // Guarda o nome com a grafia original da planilha, sem o prefixo.
      const nome = rotulo.replace(/^\s*meta\s+(anual|entradas)\s+/i, "").trim();
      metaAnualPorUnidade[nome] = anual;
    }
  }

  // Sem a coluna consolidada, o total geral é a soma das unidades.
  if (!metaAnualTotalGeral) {
    metaAnualTotalGeral = Object.values(metaAnualPorUnidade).reduce((s, v) => s + v, 0);
  }

  const metaPorUnidade: Record<string, number> = {};
  for (const [nome, anual] of Object.entries(metaAnualPorUnidade)) {
    metaPorUnidade[nome] = anual / 12;
  }

  const lidas = rows
    .map((r) => {
      const d = kData ? parseDate(r[kData]) : null;
      const dia = d ? d.getDate() : kDia ? parseInt0(r[kDia]) : 0;
      const linha: FinancialRow = {
        unidade: kUnidade ? String(r[kUnidade] ?? "").trim() : "",
        nat2: kNat2 ? String(r[kNat2] ?? "").trim() : "",
        nat3: kNat3 ? String(r[kNat3] ?? "").trim() : "",
        nat4: kNat4 ? String(r[kNat4] ?? "").trim() : "",
        razaoSocial: kRazao ? String(r[kRazao] ?? "").trim() : "",
        projeto: kProjeto ? String(r[kProjeto] ?? "").trim() : "",
        meta: kMeta ? String(r[kMeta] ?? "").trim() : "",
        credito: kCredito ? parseNumber(r[kCredito]) : 0,
        credito1: kCredito1 ? parseNumber(r[kCredito1]) : 0,
        debito: kDebito ? parseNumber(r[kDebito]) : 0,
        debito1: kDebito1 ? parseNumber(r[kDebito1]) : 0,
        data: d,
        dia,
        mes: kMes ? parseMonth(r[kMes]) : d ? d.getMonth() + 1 : 0,
        ano: kAno ? parseInt0(r[kAno]) : d ? d.getFullYear() : 0,
        nroUnico: kNro ? String(r[kNro] ?? "").trim() : "",
      };
      return { bruta: r, linha };
    })
    .filter(({ linha }) => linha.unidade || linha.credito || linha.debito);

  conferirAssinatura(
    declaracao,
    colunaExata(sample, declaracao.assinatura.coluna),
    lidas.map((l) => l.bruta),
  );

  /*
   * Sem qualquer uma destas, o dashboard não fica errado de um jeito visível:
   * fica zerado, ou com tudo num mês só, e parece verdade. A planilha é
   * recusada, e a mensagem diz o que falta.
   *
   * Vem DEPOIS da assinatura, de propósito: o arquivo de Angola no lugar do
   * Brasil também não tem a coluna "Data", e a mensagem certa para esse caso é
   * "arquivo trocado", não "falta uma coluna".
   */
  const faltando: string[] = [];
  if (!kUnidade) faltando.push(`"${declaracao.colunas.unidade}"`);
  if (!kData && !(kMes && kAno)) faltando.push(`"${declaracao.colunas.data}"`);
  if (!kCredito) faltando.push(`"Crédito 2"`);
  if (!kDebito) faltando.push(`"Débito 2"`);
  if (!kCredito1) faltando.push(`"Crédito"`);
  if (!kDebito1) faltando.push(`"Débito"`);
  if (faltando.length) {
    throw new PlanilhaRecusada(
      (faltando.length === 1
        ? `Falta a coluna ${faltando[0]}`
        : `Faltam as colunas ${faltando.join(", ")}`) +
        ` na planilha financeira da base ${declaracao.nome}. Nada foi enviado. ` +
        `Confira se é o arquivo certo e se o cabeçalho não foi alterado.`,
    );
  }
  const out = lidas.map((l) => l.linha);

  /*
   * O aviso só existe quando a carga TEM meta de dízimos — pela mesma regra que
   * liga os blocos de meta no dashboard (src/lib/presenca.ts). Sem meta nenhuma,
   * que é o estado normal de Angola hoje, cada envio listaria todas as
   * unidades: um aviso sobre algo que ninguém pode resolver, que vira ruído e
   * ensina a ignorar o aviso no dia em que ele importar.
   */
  const temMeta = temMetaDeDizimos([...Object.values(metaAnualPorUnidade), metaAnualTotalGeral]);
  const nomesComMeta = new Set(Object.keys(metaAnualPorUnidade).map(norm));
  const unidadesSemMetaExata = !temMeta
    ? []
    : [...new Set(out.map((r) => r.unidade).filter(Boolean))]
        .filter((u) => !nomesComMeta.has(norm(u)))
        .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return {
    rows: out,
    metaPorUnidade,
    metaAnualPorUnidade,
    metaAnualTotalGeral,
    unidadesSemMetaExata,
  };
}

/*
 * A conferência do arquivo trocado — ver `assinatura` em bases.ts.
 *
 * Olha só as linhas que seriam gravadas: uma linha em branco no fim do arquivo
 * não diz nada sobre de onde ele veio. (O arquivo do Brasil tem cinco assim, com
 * o 1º nível vazio e nenhum valor.)
 */
function conferirAssinatura(d: DeclaracaoBase, coluna: string | undefined, brutas: RawRow[]) {
  const { valor, exige } = d.assinatura;
  const alvo = norm(valor);
  const temAMarca = (r: RawRow) => coluna !== undefined && norm(r[coluna]) === alvo;
  const n = (x: number) => x.toLocaleString("pt-BR");
  const desfecho =
    "Nada foi enviado, e a base que está no servidor continua a mesma. " +
    "Confira se os arquivos não foram trocados.";

  if (exige === "nenhuma") {
    const marcadas = brutas.filter(temAMarca).length;
    if (marcadas) {
      throw new PlanilhaRecusada(
        `Este arquivo não pode entrar na base ${d.nome}: ${n(marcadas)} de ${n(brutas.length)} ` +
          `lançamentos têm "${valor}" na coluna "${d.assinatura.coluna}", que é a marca da ` +
          `planilha de outra base. ${desfecho}`,
      );
    }
    return;
  }

  if (coluna === undefined) {
    throw new PlanilhaRecusada(
      `Este arquivo não pode entrar na base ${d.nome}: falta a coluna "${d.assinatura.coluna}", ` +
        `que na planilha da base ${d.nome} diz "${valor}" em todas as linhas. ${desfecho}`,
    );
  }
  const fora = brutas.filter((r) => !temAMarca(r));
  if (fora.length) {
    const exemplos = [...new Set(fora.map((r) => String(r[coluna] ?? "").trim() || "(vazio)"))]
      .slice(0, 3)
      .map((e) => `"${e}"`)
      .join(", ");
    throw new PlanilhaRecusada(
      `Este arquivo não pode entrar na base ${d.nome}: ${n(fora.length)} de ${n(brutas.length)} ` +
        `lançamentos não têm "${valor}" na coluna "${d.assinatura.coluna}" — por exemplo, ` +
        `${exemplos}. ${desfecho}`,
    );
  }
}

/* ================= Saldo por Centro de Resultado ================= */

export interface SaldoRow {
  unidade: string;
  /** Texto original da coluna "Período", preservado para rotular o card. */
  periodo: string;
  /** "atual" ou a competência do período; null quando não dá para interpretar. */
  quando: "atual" | { ano: number; mes: number } | null;
  saldo: number;
}

/*
 * A coluna "Período" mistura duas naturezas: uma competência ("jan/26",
 * "01/01/2026") e a palavra "Atual", que é o saldo de agora. Classificar aqui,
 * uma vez, evita que cada leitor tenha de reinterpretar o texto — e é o que
 * permite ao card achar sozinho qual é o mês de abertura da base.
 */
function classificarPeriodo(v: unknown): SaldoRow["quando"] {
  const s = norm(v);
  if (!s) return null;
  if (s === "atual") return "atual";

  // "jan/26", "jan-2026", "janeiro/2026"
  const m = s.match(/^([a-z]{3})[a-z]*\s*[/-]\s*(\d{2,4})$/);
  if (m) {
    const mes = MES_MAP[m[1]];
    if (mes) {
      let ano = parseInt(m[2], 10);
      if (ano < 100) ano += 2000;
      return { ano, mes };
    }
  }

  const d = parseDate(v);
  if (d) return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  return null;
}

export function normalizeSaldo(rows: RawRow[]): SaldoRow[] {
  if (!rows.length) return [];
  const sample = rows[0];
  const kUnidade = pickKey(sample, [
    "Descrição CR. 1º Nível",
    "Descricao CR 1 Nivel",
    "Centro de Resultado",
    "CR 1 Nivel",
    "Unidade",
  ]);
  const kPeriodo = pickKey(sample, ["Período", "Periodo"]);
  const kSaldo = pickKey(sample, ["Saldo Acumulado", "Saldo Acum", "Saldo"]);

  return rows
    .map((r) => ({
      unidade: kUnidade ? String(r[kUnidade] ?? "").trim() : "",
      periodo: kPeriodo ? String(r[kPeriodo] ?? "").trim() : "",
      quando: kPeriodo ? classificarPeriodo(r[kPeriodo]) : null,
      saldo: kSaldo ? parseNumber(r[kSaldo]) : 0,
    }))
    .filter((r) => r.quando !== null);
}

export function normalizeMembership(rows: RawRow[]): MembershipRow[] {
  if (!rows.length) return [];
  const sample = rows[0];
  const kUnidade = pickKey(sample, ["Unidades", "Unidade", "Descrição CR. 1º Nível"]);
  const monthKeys = Object.keys(sample).filter((k) =>
    // eslint-disable-next-line no-useless-escape -- mesma razão do regex de data
    /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s*[\/\-]\s*\d{2,4}/i.test(k.trim()),
  );
  return rows
    .map((r) => {
      const meses: Record<string, number> = {};
      for (const mk of monthKeys) {
        const raw = String(r[mk] ?? "").replace(/[^\d-]/g, "");
        meses[mk.trim().toLowerCase().replace(/\s+/g, "")] = raw ? parseInt(raw, 10) : 0;
      }
      return {
        unidade: kUnidade ? String(r[kUnidade] ?? "").trim() : "",
        meses,
      };
    })
    .filter((r) => r.unidade);
}

export function membershipForMonth(
  rows: MembershipRow[],
  unidade: string | "Total Geral",
  ano: number,
  mes: number,
): number {
  const abrev = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  const yy = String(ano).slice(-2);
  const k1 = `${abrev[mes - 1]}/${yy}`;
  const k2 = `${abrev[mes - 1]}/${ano}`;
  const get = (r: MembershipRow) => r.meses[k1] ?? r.meses[k2] ?? 0;
  if (unidade === "Total Geral") {
    const tg = rows.find((r) => norm(r.unidade) === "total geral");
    if (tg) return get(tg);
    return rows.reduce((s, r) => s + get(r), 0);
  }
  const found = rows.find((r) => norm(r.unidade) === norm(unidade));
  return found ? get(found) : 0;
}

/**
 * Meta anual de uma unidade, lida das colunas "Meta Anual <Unidade>".
 *
 * A correspondência é exata. Já foi por continência, e isso dava errado sempre
 * que um nome era prefixo do outro: "Central Picos - Missões" contém "Central
 * Picos", então a filial herdava a meta da sede — e a soma de todas as unidades
 * vinha inflada. A continência só entra como último recurso, e apenas quando há
 * um único candidato: com dois ou mais não há como escolher sem chutar, e chutar
 * é justamente o que produzia o erro.
 *
 * E só nas bases que a permitem (`metaAproximada` em bases.ts). Em Angola ela
 * é desligada: "Central Angola Sede" contém "Central Angola", e a Sede sem
 * coluna de meta herdaria a meta do país inteiro. Lá, sem coluna exata, a meta
 * é zero — e a unidade aparece no aviso do envio (ver unidadesSemMetaExata).
 */
export function metaAnualDaUnidade(
  metaAnualPorUnidade: Record<string, number>,
  unidade: string,
  base: Base,
): number {
  const alvo = norm(unidade);
  const entradas = Object.entries(metaAnualPorUnidade);

  for (const [nome, v] of entradas) {
    if (norm(nome) === alvo) return v;
  }
  if (!DECLARACOES[base].metaAproximada) return 0;

  const parciais = entradas.filter(([nome]) => {
    const n = norm(nome);
    return n.includes(alvo) || alvo.includes(n);
  });
  return parciais.length === 1 ? parciais[0][1] : 0;
}

export function isDizimosOfertas(nat2: string): boolean {
  const n = norm(nat2);
  return n.includes("dizimo") && n.includes("oferta");
}

export function classifyNat3(
  nat3: string,
): "Gazofilácio" | "PIX" | "Depósitos Diretos" | "Cartões" | "In Church" | null {
  const c = norm(nat3);
  if (c.includes("gazofilacio")) return "Gazofilácio";
  if (c === "pix" || c.includes("pix")) return "PIX";
  if (c.includes("deposito")) return "Depósitos Diretos";
  if (c.includes("cartao") || c.includes("cartoes") || c.includes("cartão")) return "Cartões";
  if (c.includes("in church") || c.includes("inchurch") || c.includes("in-church"))
    return "In Church";
  return null;
}
