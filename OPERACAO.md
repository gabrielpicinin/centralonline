# Operação — Dashboard Financeiro Central

Roteiro para quem mantém o sistema no ar. Escrito para ser lido no dia em que
algo der errado, então vai direto ao ponto.

---

## O essencial em cinco linhas

|                         |                                                                     |
| ----------------------- | ------------------------------------------------------------------- |
| **O que é**             | Um site interno. Acesso pela rede da Central, via VPN.              |
| **Roda com**            | Node **22.18.0 ou mais novo**. Use 24, como o servidor. Nada além. |
| **Onde ficam os dados** | A pasta `dados/` — ou o caminho em `DADOS_DIR`.                     |
| **Banco de dados**      | SQLite, um arquivo. Não há serviço de banco para manter.            |
| **Contas**              | 1 administrador (`Financeiro`) e os pastores. Sem cadastro público. |

---

## Backup — a única coisa que precisa entrar na rotina

```bash
node ferramentas/backup.mjs
node ferramentas/backup.mjs /mnt/backup/central    # ou numa pasta de rede
```

Gera **um arquivo único**, com data e hora no nome, contendo tudo: contas,
senhas, permissões e as bases enviadas. Pode rodar com o sistema no ar e com
gente usando.

### Por que não copiar a pasta `dados/`

Parece equivalente e não é. O SQLite trabalha em modo WAL: as gravações mais
recentes ficam num arquivo ao lado (`central.db-wal`) até serem consolidadas no
`central.db`.

Medido neste projeto, com o servidor rodando: o `central.db` tinha **122 KB**
enquanto o `-wal` guardava **86 KB de gravações ainda não incorporadas**. Uma
cópia só do `.db` teria perdido 300 lançamentos — e nada indicaria isso, porque
o arquivo abriria normalmente e pareceria íntegro.

O comando acima pede ao próprio SQLite um retrato consistente, WAL incluído.

### Restaurar

```bash
# parar o serviço
mkdir -p dados
cp central-2026-09-11T16-42-07.db dados/central.db
# subir o serviço
```

Só isso: um arquivo, um nome. Apague o `-wal` e o `-shm` antigos se existirem.

> **Um backup que nunca foi restaurado não é backup, é esperança.** Restaure uma
> vez numa pasta de teste e confirme que o site sobe com ele. Este ciclo foi
> testado na entrega — restaurando, as senhas continuaram valendo e as
> permissões dos pastores vieram junto.

### Onde guardar

Uma cópia fora do prédio. Um disco na mesma sala do servidor não protege contra
incêndio, roubo ou sequestro de dados — que são exatamente os casos em que o
backup importa.

---

## Subir, derrubar, conferir

> ### O servidor NÃO compila. Ele recebe pronto.
>
> Isto mudou depois de uma tentativa real: `npm run build` morreu na máquina com
> `Ineffective mark-compacts near heap limit — JavaScript heap out of memory`.
> Não foi azar de configuração. **O build usa cerca de 2,2 GB de memória** — medido,
> não estimado — e a máquina não tem isso.
>
> A saída que se improvisou na hora foi subir `npm run dev`, o servidor de
> desenvolvimento, em produção. Ele não é feito para isso: recompila a cada
> requisição, expõe o código-fonte e traz ferramentas de depuração.
>
> O fluxo correto é: **compila-se fora, envia-se o resultado.** Quem compila é uma
> máquina de desenvolvimento, que gera um `pacote.zip`; o servidor só recebe,
> extrai e roda.

```bash
# No servidor: extrair o pacote recebido e rodar. Só isso.
unzip pacote.zip -d /opt/central
cd /opt/central
node .output/server/index.mjs
```

O pacote traz `.output/` (a aplicação compilada), `ferramentas/` e este manual.
**Não precisa de `npm install` nem de `node_modules`** — conferido rodando o
`.output/` sozinho numa pasta vazia. O único requisito é o Node instalado.

Variáveis de ambiente:

| Variável         | Obrigatória | Para quê                                                        |
| ---------------- | ----------- | --------------------------------------------------------------- |
| `SESSION_SECRET` | **sim**     | Cifra o cookie de sessão. Mínimo de 32 caracteres.              |
| `DADOS_DIR`      | **sim**     | Pasta do banco, caminho absoluto. Sem ela o serviço não sobe.   |
| `HOST`           | **sim**     | Interface de escuta. Use `127.0.0.1`. Ver o aviso abaixo.       |
| `PORT`           | não         | Porta. Sem ela, 3000.                                            |

> ### `DADOS_DIR` é exigida SEMPRE, e não depende de `NODE_ENV`
>
> O servidor compilado **recusa subir sem ela**, ponto. Não há modo de
> desenvolvimento, não há valor padrão, e definir `NODE_ENV` para outra coisa
> não afrouxa nada.
>
> Vale dizer isso com todas as letras porque o código-fonte dá a impressão
> contrária: lá a exigência está escrita como "se estiver em produção". Acontece
> que o empacotador resolve essa comparação **durante o build** e a remove — no
> arquivo que chega ao servidor, a exigência é incondicional, e o caminho
> alternativo `./dados` nem existe mais.
>
> Na prática, para quem opera: o `.output/` sempre exige `DADOS_DIR`. Se você
> compilar e rodar na sua própria máquina para testar, vai precisar dela
> também — não é defeito.

> ### `HOST` é obrigatória na prática, e o padrão joga contra
>
> **Sem `HOST`, o servidor escuta em todas as interfaces.** Isso significa que
> a aplicação fica alcançável direto por qualquer máquina da rede, na porta do
> Node, contornando o Apache — e com ele o HTTPS, os logs de acesso e qualquer
> regra que o proxy aplique.
>
> Não dá para corrigir isso pelo código deste projeto. O servidor compilado lê
> a variável na primeira linha do arquivo que o Node executa, antes de qualquer
> código nosso rodar:
>
> ```js
> const host = process.env.NITRO_HOST || process.env.HOST;
> ```
>
> Sem valor, ele passa `hostname: undefined` adiante, e o Node interpreta isso
> como "escute em tudo". **Por isso `HOST=127.0.0.1` precisa estar na
> configuração do serviço**, junto das outras variáveis. Com ele, só quem passa
> pelo Apache entra.
>
> `NITRO_HOST` faz o mesmo e tem precedência, se algum dia for preciso.
>
> O servidor de desenvolvimento é outra história: lá o padrão já foi corrigido
> para `127.0.0.1` no `vite.config.ts`. Mas o servidor de desenvolvimento não
> deve rodar no servidor de produção de jeito nenhum.

Gerar o `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Trocá-lo derruba todas as sessões abertas — e só isso. As contas e as senhas
estão no banco e não dependem dele.

### Está no ar?

```bash
curl -I http://localhost:3000/
```

`HTTP/1.1 200` significa de pé. Qualquer outra coisa, ou nenhuma resposta,
significa que o serviço caiu — reinicie-o.

---

## A primeira vez que o site sobe

Enquanto não existir nenhuma conta, o endereço mostra **"Criar o acesso do
Financeiro"** no lugar do login. Quem abrir primeiro define a senha do
administrador.

**Avise a pessoa do Financeiro no momento em que publicar**, para ela criar a
senha em seguida. A janela é curta e só alcançável de dentro da VPN, mas é uma
janela.

> Se ela abrir o endereço e vir a tela de **login** quando esperava a de
> criação, alguém chegou antes. Isso precisa ser investigado no mesmo dia.

Depois da primeira conta, essa tela desaparece para sempre e não há caminho de
volta.

---

## O dia ruim: ninguém consegue entrar

Não existe recuperação por e-mail — o sistema não envia e-mail. Se a senha do
`Financeiro` se perdeu, use a chave reserva, na pasta do projeto **no
servidor**:

```bash
node ferramentas/redefinir-senha.mjs Financeiro
```

Ele imprime uma senha nova. A antiga deixa de valer na hora.

Serve para qualquer conta:

```bash
node ferramentas/redefinir-senha.mjs pastor@central.online
```

Sem argumento ou com um usuário inexistente, ele lista as contas que existem.

**Isto não é um passo de instalação.** É a chave reserva, e só funciona para
quem já tem acesso ao servidor.

---

## Senha de pastor

O caminho normal **não** é este script: é a tela do administrador. O Financeiro
entra, vai em _Bases e permissões_, e usa o ícone de chave na linha do pastor
para gerar uma senha nova, que aparece uma vez com botão de copiar.

A senha não é guardada em texto em lugar nenhum — o que fica no banco é um
hash. Por isso não existe "ver a senha de novo": só gerar outra.

---

## Perguntas que vão aparecer

**"O pastor diz que não vê nada."**
Provavelmente não tem unidade marcada. O Financeiro abre _Bases e permissões_,
marca as unidades dele e aperta **Salvar seleções** — o botão é fácil de
esquecer, e sem ele nada muda.

**"Mudei as unidades e ele continua vendo o de antes."**
Vale na próxima vez que o dashboard dele buscar dados. Peça para atualizar a
página.

**"Tem dois pastores com o mesmo e-mail."**
Não tem: o sistema recusa. Maiúsculas e minúsculas contam como o mesmo usuário.

**"Quero apagar um pastor."**
Use _desativar_, não apagar. A conta para de entrar e continua na lista, marcada,
podendo ser reativada. Apagar removeria também o registro de quem enviou cada
base.

---

## Atualizar o sistema

Pelo mesmo motivo da seção anterior, a atualização **não é compilada aqui**. Quem
mantém o código gera um `pacote.zip` novo e envia; no servidor:

```bash
# 1. Backup ANTES, sempre
node ferramentas/backup.mjs /caminho/do/backup

# 2. Parar o serviço, trocar a aplicação, subir de novo
pm2 stop central
rm -rf /opt/central/.output
unzip pacote.zip -d /opt/central
pm2 start central
```

A pasta de dados não é tocada por nada disso — ela fica fora do `.output/`, no
caminho de `DADOS_DIR`, que é justamente por isso que essa variável é obrigatória.

O banco não é tocado por uma atualização: tabelas novas são criadas sozinhas na
partida, e as existentes não são alteradas. Ainda assim, **faça o backup antes** —
custa segundos.

---

## Testes

```bash
npm test
```

Sete testes, e todos existem por um motivo só: garantir que um pastor nunca veja
uma unidade que não é dele. Eles falham se alguém alterar o código de leitura e
deixar escapar alguma tabela.

**Rode antes de publicar qualquer atualização.** Se algum falhar, não publique:
o que eles protegem é exatamente o que não pode vazar.
