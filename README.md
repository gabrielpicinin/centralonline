# Dashboard Financeiro Central

Dashboard executivo de dízimos, ofertas e despesas da rede Central. O Financeiro
envia as planilhas, e cada pastor entra com a própria conta e enxerga **apenas as
unidades liberadas para ele**.

Roda num servidor da própria Central, na rede interna, acessível por VPN.

> Para operar o sistema no dia a dia — backup, atualização, o que fazer quando
> algo quebra — o documento é **[OPERACAO.md](OPERACAO.md)**. Este aqui é sobre
> o código.

## Seções

|                         |                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1 — Total Geral         | KPIs do período, entradas x despesas, dízimos vs. meta, saldo por centro de resultado e dois donuts de distribuição |
| 2 — Acumulado Diário    | Curva acumulada dia a dia contra a meta, comparação entre meses e a tabela do ano                                   |
| 3 — Análise de Despesas | Naturezas de 3º e 4º nível e despesa mensal, com filtragem cruzada por clique                                       |
| 4 — Controle de Metas   | Meta contra realizado por categoria, com naturezas agrupadas                                                        |

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

## O gerenciador de pacotes é o npm

**npm, e só npm.** O lockfile oficial é o `package-lock.json`. No servidor a
instalação é:

```bash
npm ci
```

Não é `npm install`. O `npm ci` apaga o `node_modules`, instala exatamente as
versões travadas no lock e falha se o lock e o `package.json` discordarem —
enquanto o `npm install` tem liberdade para resolver versões novas.

A escolha do npm não é preferência: é que ele vem junto com o Node. Este
projeto inteiro é construído para não exigir nada extra de quem o mantém, e
pedir um gerenciador a mais no servidor contradiria isso. Antes existia um
`bun.lock`, que o npm não lê — e foi exatamente esse descompasso que fez uma
instalação no servidor resolver 513 pacotes do zero, em vez de reproduzir os
que haviam sido testados aqui.

### A trava de 24 horas, e o que ela faz agora

O `bunfig.toml` recusava pacotes publicados havia menos de 24 horas. A razão é
que ataques a bibliotecas npm vivem numa janela curta: rouba-se a conta de quem
publica, sobe-se uma versão com código a mais, e ela fica no ar até alguém
perceber — costuma ser algumas horas. Esperar um dia elimina quase toda essa
janela, e não custa nada a um projeto que não depende de novidade recém-saída.

A trava continua, no `.npmrc`, com outra escrita: `min-release-age=1`. O bun
contava em segundos (`86400`), o npm conta em dias. Mesmo efeito.

**Ela é real, e foi verificada por comportamento — não por a chave ser aceita.**
O npm guarda em silêncio configurações que não reconhece, então "ele aceitou"
não prova nada. O teste que prova: com `min-release-age=100000`, o npm recusa
instalar qualquer coisa, com `ENOVERSIONS — No versions available`; sem a chave,
resolve normalmente. Quem filtra é o resolvedor.

| | |
| ------------------------- | ------------------------------------------------ |
| `min-release-age` | npm **11.10.0** — [npm/cli#8965](https://github.com/npm/cli/pull/8965) |
| `min-release-age-exclude` | npm **11.17.0** |
| Documentação | [docs.npmjs.com/cli/v11/using-npm/config](https://docs.npmjs.com/cli/v11/using-npm/config) |

**Exige npm 11.17.0 ou mais novo.** Num npm mais antigo, as chaves são
ignoradas caladas — sem erro, sem aviso, e sem proteção. Confira com `npm -v`
antes de confiar nela. Isso vale para a máquina que gera o `package-lock.json`;
no servidor não muda nada, porque lá se usa `npm ci`, que não resolve versão
nenhuma.

Vale entender **quando** ela atua, porque é menos do que parece: o `npm ci` não
resolve versão nenhuma, então no servidor a trava é irrelevante. Ela protege a
máquina que **gera** o lock — ou seja, na hora em que alguém roda `npm install`
para atualizar algo de propósito. Esse é o único momento em que versões novas
entram no projeto, e é justamente o momento coberto.

## Testes

```bash
npm test
```

Oito testes, todos sobre a mesma coisa: garantir que um pastor nunca receba uma
unidade que não é dele. Sem dependência — o próprio Node executa TypeScript e
traz o executor de testes.

## Qual Node

Mínimo **22.18.0**, declarado em `engines`. O número não é escolha de gosto: são
dois recursos do Node que este projeto usa sem flag nenhuma, e cada um tem a sua
versão de estreia.

| Recurso                                   | Livre de flag desde |
| ----------------------------------------- | ------------------- |
| `node:sqlite` — o banco                   | 22.13.0             |
| TypeScript executado direto — os testes   | 22.18.0             |

O piso é o maior dos dois. O `.nvmrc` diz **24**, que é a linha instalada no
servidor: o `engines` marca o mínimo aceitável, o `.nvmrc` marca o que se deve
usar, e os dois só são iguais por acidente em projetos que não pensaram nisso.

**Rode antes de publicar.** Se algum falhar, não publique.

## Compilando para o servidor

O build **não roda no servidor** — ele precisa de cerca de 2,2 GB de memória,
medido, e a máquina da Central não tem. Compila-se aqui e envia-se o resultado.

```bash
npm ci
npm run build
```

O build mira `node-server`: um servidor Node comum, sem dependência de
plataforma. O resultado é `.output/`, que roda sozinho — sem `node_modules`,
sem `package.json`, sem nada mais. Conferido extraindo só essa pasta para um
diretório vazio.

Para montar o pacote que vai ao servidor por FTP, com `.output/`,
`ferramentas/` e o `OPERACAO.md` na raiz do zip:

```bash
node ferramentas/empacotar.mjs
```

## Onde as coisas estão

|                                 |                                                                       |
| ------------------------------- | --------------------------------------------------------------------- |
| `src/lib/banco.server.ts`       | O único arquivo que fala SQL. `lerBase()` é a porta única de leitura. |
| `src/lib/sessao.server.ts`      | Quem está do outro lado, e quais unidades pode ver.                   |
| `src/lib/gate.functions.ts`     | Primeira execução, login, saída.                                      |
| `src/lib/pastores.functions.ts` | Cadastro de pastores, senhas e permissões.                            |
| `src/lib/parsers.ts`            | Leitura e normalização das planilhas, no navegador.                   |
| `src/components/Upload.tsx`     | A tela do administrador: bases em cima, unidades embaixo.             |
| `src/components/dashboard/`     | As quatro seções e o trilho que as troca.                             |
| `ferramentas/`                  | Backup e a chave reserva de senha, para o TI.                         |
| `testes/`                       | O teste do recorte.                                                   |

## Banco de dados

SQLite, embutido no próprio Node — nenhuma dependência, nenhum serviço para o TI
manter. Um arquivo em `dados/central.db`, ou no caminho de `DADOS_DIR`.

Contas, senhas, permissões e as bases enviadas estão todas ali. **É a única
pasta que precisa de backup**, e o jeito certo de fazê-lo está no
[OPERACAO.md](OPERACAO.md) — copiar o arquivo com o sistema no ar não é seguro.

As tabelas são criadas sozinhas na primeira partida.
