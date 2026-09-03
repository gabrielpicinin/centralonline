# Dashboard Financeiro Central

Dashboard executivo de dízimos, ofertas e despesas. Lê as bases financeira e de
membresia em `.csv` ou `.xlsx` e monta quatro seções navegáveis por um trilho de
miniaturas à esquerda.

**Os dados nunca saem do navegador.** Não existe banco nem envio: os arquivos são
lidos, processados e mantidos em memória, e se perdem ao recarregar a página. Só
o login fala com o servidor.

## Seções

| | |
|---|---|
| 1 — Total Geral | KPIs do período, entradas x despesas, dízimos vs. meta e dois donuts de distribuição |
| 2 — Acumulado Diário | Curva acumulada dia a dia contra a meta, comparação entre meses e a tabela do ano |
| 3 — Análise de Despesas | Naturezas de 3º e 4º nível e despesa mensal, com filtragem cruzada por clique |
| 4 — Controle de Metas | Meta contra realizado por categoria, com naturezas agrupadas |

Os seis filtros do cabeçalho — Ano, Unidade, Mês, Natureza Nível 3, Projeto e
Meta — são universais: valem para todas as seções ao mesmo tempo.

## Rodando localmente

Precisa de Node.js. As dependências são instaladas uma vez:

```bash
npm install
```

Copie `.env.example` para `.env` e preencha os três valores (veja abaixo como
gerar o `SESSION_SECRET`). Depois:

```bash
npm run dev
```

## Segredos

Três variáveis controlam o acesso, e **nenhuma delas vive no código**:

| Variável | O que é |
|---|---|
| `SITE_USERNAME` | Usuário do login |
| `SITE_PASSWORD` | Senha do login |
| `SESSION_SECRET` | Chave que cifra o cookie de sessão. Mínimo de 32 caracteres |

Gere o `SESSION_SECRET` aleatoriamente, nunca à mão:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Em desenvolvimento** elas vêm do `.env`, que está no `.gitignore` e não deve
ser versionado nunca.

**Publicado na Cloudflare** elas precisam ser *secrets* do Worker — não *vars*.
A diferença importa: vars ficam em texto puro no `wrangler.jsonc` e visíveis no
painel; secrets são cifrados e não aparecem em lugar nenhum depois de definidos.
Cada comando pede o valor de forma interativa:

```bash
npx wrangler secret put SITE_USERNAME
```

```bash
npx wrangler secret put SITE_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

Para conferir o que já está definido (mostra os nomes, nunca os valores):

```bash
npx wrangler secret list
```

Se algum faltar, o servidor recusa o login e escreve no log qual variável está
ausente e o comando para corrigi-la. Para ler esses logs em produção:

```bash
npx wrangler tail
```

### Trocar a senha

É o mesmo `wrangler secret put SITE_PASSWORD` — o valor novo substitui o antigo
no próximo deploy. Troque também o `SESSION_SECRET` se suspeitar que ele vazou:
isso invalida todas as sessões abertas e obriga todo mundo a entrar de novo.

## Build e deploy

```bash
npm run build
```

```bash
npx wrangler deploy
```

## Estrutura

```
src/
  components/
    Login.tsx, Upload.tsx        fluxo antes do dashboard
    Dashboard.tsx                cabeçalho, filtros universais e composição das seções
    dashboard/
      SectionDeck.tsx            trilho de miniaturas e palco
      Section1Total.tsx          Seção 1
      EntradasDiarias.tsx        Seção 2
      Section2Despesas.tsx       Seção 3
      Section3Metas.tsx          Seção 4
  lib/
    parsers.ts                   leitura e normalização das planilhas
    gate.functions.ts            login, sessão e freio de força bruta
    appState.tsx                 estado da aplicação em memória
```

## Formato das planilhas

**Base financeira** — as colunas são encontradas por nome, tolerando variações
de acento e caixa:

`Descrição CR. 1º Nível` (unidade) · `Descrição Nat. 2º/3º/4º Nível` ·
`Razão Social Parceiro` · `Nome Projeto` · `Meta` · `Crédito` · `Débito` ·
`Dia/Mês/Ano Baixa` · `Nro. Único Financeiro`

As metas vêm de uma coluna por unidade, com o valor **anual**:
`Meta Anual <Unidade>`, mais `Meta Anual Total Geral` com o consolidado. O
consolidado é lido à parte, nunca somado com as unidades — ele já é a soma
delas. A meta mensal é essa anual dividida por 12.

**Base de membresia** — coluna `Unidades` e uma coluna por mês no formato
`jan/26`, `fev/26`, e assim por diante.
