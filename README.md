# Dashboard Financeiro Central

Dashboard executivo de dízimos, ofertas e despesas. Lê as bases financeira, de
membresia e de saldo por centro de resultado em `.csv` ou `.xlsx` e monta quatro
seções navegáveis por um trilho de miniaturas à esquerda. A base de saldo é
opcional — sem ela o dashboard abre normalmente, só o card de saldo fica vazio.

**Os dados nunca saem do navegador.** Não existe banco nem envio: os arquivos são
lidos, processados e mantidos em memória, e se perdem ao recarregar a página. Só
o login fala com o servidor.

## Seções

| | |
|---|---|
| 1 — Total Geral | KPIs do período, entradas x despesas, dízimos vs. meta, saldo por centro de resultado e dois donuts de distribuição |
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

### Onde cada ambiente lê

**No seu computador** elas vêm do arquivo `.env` na raiz. Ele está no
`.gitignore` e não deve ser versionado nunca. Copie o `.env.example` e preencha.

**No site publicado** quem hospeda é o **Lovable** — o app roda em
`centralonline.lovable.app`. As três variáveis são definidas lá, dentro do
projeto no Lovable, e é lá que se trocam. Não há nada a fazer pela linha de
comando.

> O projeto traz um `wrangler.jsonc` herdado do modelo TanStack Start. Ele
> **não é usado**: ninguém publica este app na Cloudflare a partir daqui.
> Ignore instruções de `wrangler secret put` — elas mirariam uma conta
> Cloudflare própria, que não é onde o site está no ar, e um `wrangler deploy`
> criaria uma segunda cópia separada em vez de atualizar o site.

Se alguma variável faltar, o servidor recusa o login e escreve no log qual é a
ausente — em vez de devolver um erro mudo.

### Trocar a senha

Troque no projeto do Lovable, no mesmo lugar onde as variáveis estão definidas,
e publique de novo. Troque `SESSION_SECRET` junto se quiser derrubar todas as
sessões abertas e obrigar todo mundo a entrar com a senha nova.

Lembre de atualizar também o seu `.env` local, senão o login para de funcionar
no `npm run dev`.

## Publicar

O site é publicado pelo **Lovable**, a partir da branch `main` deste
repositório. O fluxo é: comitar e enviar para o GitHub, abrir o projeto no
Lovable, deixar ele puxar as mudanças e publicar.

Para conferir se o build passa antes de enviar:

```bash
npm run build
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
      secaoAtiva.tsx             adia o trabalho das seções fora do palco
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

**Base de saldo por centro de resultado** — opcional. Três colunas:

`Descrição CR. 1º Nível` (unidade) · `Período` · `Saldo Acumulado`

O `Período` aceita tanto uma competência (`jan/26`, `01/01/2026`) quanto a
palavra `Atual`. O card da Seção 1 mostra duas linhas: a competência mais antiga
da base — que é a abertura do exercício, e por isso acompanha a virada do ano
sem ninguém editar código — e o saldo `Atual`. Linhas com `Período` em branco ou
irreconhecível são descartadas. Diferente das outras bases, esta responde apenas
ao filtro de unidade: mês e natureza não fazem sentido sobre um saldo acumulado.
