# Dashboard Financeiro Central

Dashboard executivo de dízimos, ofertas e despesas da rede Central. O Financeiro
envia as planilhas, e cada pastor entra com a própria conta e enxerga **apenas as
unidades liberadas para ele**.

Roda num servidor da própria Central, na rede interna, acessível por VPN.

> Para operar o sistema no dia a dia — backup, atualização, o que fazer quando
> algo quebra — o documento é **[OPERACAO.md](OPERACAO.md)**. Este aqui é sobre
> o código.

## Seções

| | |
|---|---|
| 1 — Total Geral | KPIs do período, entradas x despesas, dízimos vs. meta, saldo por centro de resultado e dois donuts de distribuição |
| 2 — Acumulado Diário | Curva acumulada dia a dia contra a meta, comparação entre meses e a tabela do ano |
| 3 — Análise de Despesas | Naturezas de 3º e 4º nível e despesa mensal, com filtragem cruzada por clique |
| 4 — Controle de Metas | Meta contra realizado por categoria, com naturezas agrupadas |

Os seis filtros do cabeçalho — Ano, Unidade, Mês, Natureza Nível 3, Projeto e
Meta — são universais: valem para todas as seções ao mesmo tempo. Para um
pastor, o filtro de Unidade só lista as unidades dele.

## Quem entra, e por onde

```
Financeiro   login  ->  bases de dados + unidades por pastor  ->  dashboard
Pastor       login  ->  dashboard (só as unidades dele)
```

Existe **uma** conta de administrador, chamada `Financeiro`. Ela cadastra os
pastores, gera a senha de cada um e marca as unidades que cada um enxerga.

Não há cadastro público: conta só nasce pela mão do administrador. Na primeira
vez que o sistema sobe, sem nenhuma conta no banco, o endereço mostra a criação
do acesso do Financeiro em vez do login — e some para sempre depois disso.

## Como o recorte por unidade funciona

O corte acontece **no servidor**, antes de os dados saírem. O navegador do
pastor nunca recebe uma linha das unidades que não são dele.

Toda leitura passa por uma função só, `lerBase()` em `src/lib/banco.server.ts`,
que recebe a lista de unidades permitidas — e essa lista vem da sessão, nunca do
cliente. É a porta única a auditar quando a pergunta for "esse pastor podia
mesmo ver isso?".

Filtrar na tela não é proteção: quem abre o painel do desenvolvedor lê o que foi
baixado, escondido ou não.

## Rodando localmente

```bash
npm install
cp .env.example .env      # preencha o SESSION_SECRET
npm run dev
```

Abra `http://localhost:8080`. Sem nenhuma conta no banco, a primeira tela é a de
criação do acesso do Financeiro.

Gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Testes

```bash
npm test
```

Sete testes, todos sobre a mesma coisa: garantir que um pastor nunca receba uma
unidade que não é dele. Sem dependência — o Node 24 executa TypeScript e traz o
próprio executor.

**Rode antes de publicar.** Se algum falhar, não publique.

## Compilando para o servidor

```bash
npm run build
node .output/server/index.mjs
```

O build mira `node-server`. Um servidor Node comum, sem dependência de
plataforma.

## Onde as coisas estão

| | |
|---|---|
| `src/lib/banco.server.ts` | O único arquivo que fala SQL. `lerBase()` é a porta única de leitura. |
| `src/lib/sessao.server.ts` | Quem está do outro lado, e quais unidades pode ver. |
| `src/lib/gate.functions.ts` | Primeira execução, login, saída. |
| `src/lib/pastores.functions.ts` | Cadastro de pastores, senhas e permissões. |
| `src/lib/parsers.ts` | Leitura e normalização das planilhas, no navegador. |
| `src/components/Upload.tsx` | A tela do administrador: bases em cima, unidades embaixo. |
| `src/components/dashboard/` | As quatro seções e o trilho que as troca. |
| `ferramentas/` | Backup e a chave reserva de senha, para o TI. |
| `testes/` | O teste do recorte. |

## Banco de dados

SQLite, embutido no próprio Node — nenhuma dependência, nenhum serviço para o TI
manter. Um arquivo em `dados/central.db`, ou no caminho de `DADOS_DIR`.

Contas, senhas, permissões e as bases enviadas estão todas ali. **É a única
pasta que precisa de backup**, e o jeito certo de fazê-lo está no
[OPERACAO.md](OPERACAO.md) — copiar o arquivo com o sistema no ar não é seguro.

As tabelas são criadas sozinhas na primeira partida.
