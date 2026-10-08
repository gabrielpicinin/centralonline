# Dashboard Financeiro Central

Dashboard executivo de dízimos, ofertas e despesas da rede Central. O Financeiro
envia as planilhas, e cada pastor entra com a própria conta e enxerga **apenas as
unidades liberadas para ele**.

São **duas bases independentes**, Brasil (em real) e Angola (em kwanza), cada
uma com o seu dashboard. Elas nunca se misturam nem se somam.

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
| 4 — Controle de Metas   | Meta contra realizado por categoria, com naturezas agrupadas — só existe quando a carga tem metas nos lançamentos   |

Os filtros do cabeçalho — Ano, Unidade, Mês, Natureza Nível 3, Projeto e Meta —
são universais: valem para todas as seções ao mesmo tempo. Para um pastor, o
filtro de Unidade só lista as unidades dele.

**O que é de meta só existe quando a carga tem meta.** As colunas "Meta Anual
&lt;unidade&gt;" ligam o card e o gráfico de meta da Seção 1 e a meta da Seção 2; a
coluna "Meta" dos lançamentos liga a Seção 4 e o filtro Meta. A decisão é
tomada uma vez, no servidor, a partir dos dados — nunca pelo nome da base — e a
lista de todos os blocos que dependem de meta está em `src/lib/presenca.ts`.

## Quem entra, e por onde

```
Financeiro           login  ->  envio por base + unidades por pastor  ->  dashboard (alternador)
Pastor, uma base     login  ->  dashboard dessa base (sem alternador)
Pastor, duas bases   login  ->  escolha da base  ->  dashboard (alternador)
```

Existe **uma** conta de administrador, chamada `Financeiro`. Ela cadastra os
pastores, gera a senha de cada um e marca, base a base, as unidades que cada um
enxerga. Ter acesso a uma base é ter ao menos uma unidade marcada nela.

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

**A base é o único parâmetro que vem do navegador** — com dois dashboards, ele
precisa dizer qual quer. Mas a base pedida é um pedido, nunca uma autorização:
a cada requisição as unidades permitidas são relidas no banco **dentro da base
pedida**. Quem pede uma base onde não tem unidade recebe a base vazia — sem
erro e sem dados. Ver `unidadesDaSessao` em `src/lib/sessao.server.ts`.

## As duas bases

O que muda de uma base para a outra é **declarado** em `src/lib/bases.ts`, e não
adivinhado pelo código: a coluna de unidade (Brasil no 1º nível, Angola no 2º),
a coluna de data, a assinatura que recusa o financeiro trocado, a moeda, as
metas percentuais da Seção 4 e as regras da visão consolidada. Nenhum trecho do
código pergunta `base === "angola"`.

O que **não** é declarado ali é se a base tem meta, membresia ou saldo: isso é
fato de cada carga, decidido em `src/lib/presenca.ts` a partir dos dados. O
envio aceita os três arquivos nas duas bases.

Membresia e saldo não têm assinatura própria — a membresia real do Brasil tem
até uma linha "Central Angola". O que os prende à base é ter **ao menos uma
unidade em comum** com o financeiro do mesmo envio; nenhuma em comum é arquivo
de outra base, e o envio é recusado. Um arquivo sem unidade nenhuma entra
quando a linha de total tem a **identidade** da base — o 1º nível que a
assinatura "todas" declara, "Central Angola" (`identidadeDaBase` em
`src/lib/bases.ts`); o Brasil não tem identidade, porque a assinatura dele é uma
proibição. Ver `conferirArquivosDoEnvio` em `src/lib/parsers.ts`, com o porquê
do critério.

O total da membresia segue uma regra só, em `membresiaDoRecorte`: **a linha
explícita de total manda; na falta dela, soma das unidades.** Nunca o contrário
— no Brasil, nenhuma soma reproduz a linha "Total Geral" (o comentário da função
tem os números). É o que deixa os três formatos de arquivo funcionarem sem
código novo: só o total (Angola hoje), total e unidades (Brasil), só unidades
(Angola quando o detalhamento chegar).

No banco, a base está em `cargas` e em `permissoes`; lançamentos, membresia,
saldos e metas a herdam pela carga. Bancos criados antes das duas bases são
migrados sozinhos na primeira partida — tudo o que existia vira Brasil. Como
conferir a migração num banco de verdade está em [OPERACAO.md](OPERACAO.md).

`metaAproximada` em `bases.ts` é transitória: o Brasil ainda aceita a busca de
meta por nome aproximado até a planilha dele ter os cabeçalhos corrigidos; aí
passa ao casamento exato, como Angola, e a propriedade sai.

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

Sem dependência — o próprio Node executa TypeScript e traz o executor de
testes.

| Arquivo                     | O que garante                                                          |
| --------------------------- | ---------------------------------------------------------------------- |
| `testes/recorte.test.ts`    | Um pastor nunca recebe uma unidade que não é dele.                     |
| `testes/bases.test.ts`      | As duas bases nunca se misturam; enviar ou podar uma não toca a outra. |
| `testes/migracao.test.ts`   | A migração para duas bases não perde uma linha, em cada esquema antigo. |
| `testes/planilhas.test.ts`  | Cada planilha é lida pela base certa; o arquivo trocado é recusado.    |
| `testes/metas.test.ts`      | Os blocos de meta aparecem e somem pelos dados da carga.               |
| `testes/membresia-saldo.test.ts` | Membresia e saldo ausentes viram "—" e aviso, nunca zero; os de outra base são recusados; o total da membresia vem da linha explícita e só sem ela da soma — Angola de hoje (uma linha) e de amanhã (por unidade) pela mesma regra. |
| `testes/moeda.test.ts`      | O real sai idêntico ao de antes; o kwanza, com `Kz`.                   |
| os demais                   | Visão consolidada, senha visível, origem do login.                     |

Cada proteção foi conferida desfazendo-a de propósito: com ela desfeita, algum
teste falha.

Um teste fica pulado de propósito: o **ensaio da migração num banco de
verdade**. Ele copia o arquivo apontado (que só é aberto para leitura), migra a
cópia e confere a impressão digital de cada tabela. No PowerShell:

```powershell
$env:ENSAIO_BANCO = "C:\caminho\do\backup.db"
node --test testes/migracao.test.ts
Remove-Item Env:ENSAIO_BANCO
```

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
| `src/lib/banco.server.ts`       | O único arquivo do app que fala SQL. `lerBase()` é a porta única de leitura. |
| `src/lib/sessao.server.ts`      | Quem está do outro lado, e quais unidades pode ver em cada base.             |
| `src/lib/bases.ts`              | O que cada base declara: colunas, assinatura, moeda, metas, regras.          |
| `src/lib/presenca.ts`           | O que a carga tem, e todos os blocos que dependem de meta.                   |
| `src/lib/gate.functions.ts`     | Primeira execução, login, saída.                                             |
| `src/lib/pastores.functions.ts` | Cadastro de pastores, senhas e permissões.                                   |
| `src/lib/parsers.ts`            | Leitura e normalização das planilhas, no navegador, por base.                |
| `src/components/Upload.tsx`     | A tela do administrador: um bloco de envio por base, unidades embaixo.       |
| `src/components/dashboard/`     | As seções e o trilho que as troca.                                           |
| `ferramentas/`                  | Backup, impressão digital do banco e a chave reserva de senha, para o TI.    |
| `testes/`                       | Os testes — ver a tabela acima.                                              |

## Banco de dados

SQLite, embutido no próprio Node — nenhuma dependência, nenhum serviço para o TI
manter. Um arquivo em `dados/central.db`, ou no caminho de `DADOS_DIR`.

Contas, senhas, permissões e as bases enviadas estão todas ali. **É a única
pasta que precisa de backup**, e o jeito certo de fazê-lo está no
[OPERACAO.md](OPERACAO.md) — copiar o arquivo com o sistema no ar não é seguro.

As tabelas são criadas sozinhas na primeira partida, e os bancos que já existem
são migrados na partida — cada migração confere se já foi feita, e rodar de novo
não muda nada.
