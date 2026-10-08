# Operação — Dashboard Financeiro Central

Roteiro para quem mantém o sistema no ar. Escrito para ser lido no dia em que
algo der errado, então vai direto ao ponto.

---

## O essencial em seis linhas

|                         |                                                                       |
| ----------------------- | --------------------------------------------------------------------- |
| **O que é**             | Um site interno. Acesso pela rede da Central, via VPN.                |
| **Roda com**            | Node **22.18.0 ou mais novo**. Use 24, como o servidor. Nada além.   |
| **Onde ficam os dados** | A pasta `dados/` — ou o caminho em `DADOS_DIR`.                       |
| **Banco de dados**      | SQLite, um arquivo. Não há serviço de banco para manter.              |
| **Contas**              | 1 administrador (`Financeiro`) e os pastores. Sem cadastro público.   |
| **Bases**               | Duas, independentes: Brasil (real) e Angola (kwanza). Nunca se somam. |

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

| Variável         | Obrigatória | Para quê                                                             |
| ---------------- | ----------- | -------------------------------------------------------------------- |
| `SESSION_SECRET` | **sim**     | Cifra o cookie de sessão. Mínimo de 32 caracteres.                   |
| `DADOS_DIR`      | **sim**     | Pasta do banco, caminho absoluto. Sem ela o serviço não sobe.        |
| `COOKIE_SECURE`  | **sim**     | `true` com HTTPS, `false` sem. Sem ela o serviço não sobe.           |
| `HOST`           | **sim**     | Interface de escuta. Use `127.0.0.1`. Ver o aviso abaixo.            |
| `PORT`           | não         | Porta. Sem ela, 3000.                                                 |

> ### `COOKIE_SECURE` não tem padrão, e isso é de propósito
>
> Ela controla a flag `Secure` do cookie de sessão, que manda o navegador
> descartar o cookie quando a conexão não é cifrada.
>
> **Valor errado quebra o login sem deixar rastro.** Com o site em HTTP e a flag
> em `true`, a pessoa digita a senha, o servidor responde que deu certo, e a
> tela seguinte a devolve para o login — sem erro, sem log, sem pista. Foi o que
> travou a primeira tentativa de implantação.
>
> Não existe padrão seguro para chutar. `true` repete essa falha numa instalação
> sem HTTPS; `false` seria pior, porque entregaria sessão sem cifragem a uma
> instalação **com** HTTPS e ninguém perceberia — tudo funcionaria. Por isso o
> serviço se recusa a subir sem a variável: quem publica é quem sabe.
>
> Nesta implantação: **`COOKIE_SECURE=false`**.

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

Trocá-lo tem dois efeitos, e o segundo não é óbvio:

- **Derruba todas as sessões abertas.** Todo mundo entra de novo.
- **As senhas de pastor deixam de poder ser mostradas.** A cópia recuperável de
  cada uma é cifrada com uma chave derivada deste segredo; trocado o segredo,
  ela não decifra mais. Nada quebra — o "Mostrar senha" passa a dizer que a
  senha não pode ser lida e oferece gerar outra —, mas quem precisar da senha
  de um pastor depois disso vai ter que gerar uma nova.

As contas em si e o login continuam funcionando: o que o login confere é o
hash, que não depende deste segredo.

### Está no ar?

```bash
curl -I http://localhost:3000/
```

`HTTP/1.1 200` significa de pé. Qualquer outra coisa, ou nenhuma resposta,
significa que o serviço caiu — reinicie-o.

---

## Operando sem HTTPS

A implantação atual roda em `http://fin.central.online`, sem certificado. Foi
decisão do TI, e o sistema está configurado para funcionar bem dentro dela em
vez de meio quebrado. Esta seção diz o que isso implica e o que muda no dia em
que houver certificado.

### O que fica exposto

O tráfego entre o navegador e o Apache viaja em texto claro. Na prática:

- **O cookie de sessão é legível** por quem estiver na mesma rede com um
  farejador de pacotes. Quem o copiar assume a sessão de quem está logado, sem
  precisar da senha.
- **A senha digitada no login viaja em claro**, na primeira vez que a pessoa
  entra.
- **Os números do dashboard viajam em claro** — receitas, despesas e metas por
  unidade.

O que **não** fica exposto: a senha do administrador, que só existe em *hash* e
não trafega nunca. As de pastor ficam no banco em hash e cifradas; uma delas só
viaja quando o Financeiro pede **Mostrar senha** — e, sem HTTPS, viaja em claro
nessa hora, como a senha digitada no login.

### O que sustenta a segurança no lugar do TLS

- A rede é interna, alcançável por VPN. Quem consegue farejar o tráfego já está
  dentro dela.
- O freio de força bruta do login foi refeito para não ser contornável — sem
  TLS, ele é a única defesa que sobra contra tentativa de senha. Ver
  `src/lib/origem.ts`.
- A aplicação escuta só em `127.0.0.1`, então tudo passa pelo Apache.

### O que é visível para quem usa

A tela de login mostra, no rodapé, **"Conexão não cifrada. Use apenas na rede
interna."** — discreto, permanente, e some sozinho quando houver HTTPS. E o
serviço registra um aviso no journal a cada subida, para a decisão não virar
esquecimento com o tempo.

Um efeito colateral aparece no cadastro de pastor: **o botão de copiar a senha
pode não funcionar**, porque os navegadores bloqueiam o acesso à área de
transferência fora de HTTPS. Quando isso acontece, a tela diz e pede para
selecionar a senha com o mouse. Ela nunca marca "Copiada" sem ter copiado.

### No dia em que houver certificado

Três passos, nesta ordem:

1. Trocar para **`COOKIE_SECURE=true`** na configuração do serviço.
2. Reiniciar. O aviso do journal some, e o rodapé da tela de login some junto —
   nenhum dos dois precisa ser editado à mão.
3. Conferir que o login continua funcionando. Se a pessoa entrar e cair de volta
   na tela de login, é sinal de que o HTTPS não está de fato terminando no
   Apache, e a variável voltou a discordar da realidade.

Nada mais muda. Não há URL escrita no código, nem redirecionamento a ajustar.

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

## As duas bases: Brasil e Angola

O sistema opera duas bases que **nunca se misturam nem se somam**, cada uma com
o seu dashboard. Elas moram no mesmo banco, mas cada envio, cada permissão e
cada leitura é de uma base só.

**Enviar.** Em _Bases e permissões_ há um bloco por país, cada um com o nome e a
cor dele. Enviar um não toca no outro: substituir o Brasil deixa Angola como
estava, e vice-versa.

Os dois blocos são iguais: **financeiro** (obrigatório), **membresia** e **saldo**
(opcionais), com as mesmas regras. O que vale é o que foi enviado em cada carga
— o sistema não supõe que uma base tenha ou não tenha membresia ou saldo.

**Cada envio substitui a base inteira.** O que não vier no envio deixa de
aparecer no dashboard: mandar só o financeiro tira a membresia e o saldo que
estavam lá. Por isso, quando a base no servidor tem membresia ou saldo e o envio
novo não traz o arquivo, a tela **avisa antes de enviar**, e o próprio botão diz
o que vai faltar ("Substituir a base do Brasil sem a membresia"). Não impede —
às vezes é de propósito.

**Arquivo trocado é recusado.** A planilha financeira de Angola diz "Central
Angola" em todas as linhas da coluna "Descrição CR. 1º Nível"; a do Brasil, em
nenhuma. Um financeiro no bloco errado é recusado com uma mensagem que diz isso,
**antes de qualquer linha sair do navegador** — a base que está no servidor fica
intacta. O mesmo vale para uma planilha sem as colunas essenciais: a mensagem
lista as que faltam.

A membresia e o saldo são conferidos contra o financeiro do mesmo envio. Se o
arquivo tem linhas de unidade, **pelo menos uma** precisa casar com as do
financeiro — senão ele é de outra base, e o envio é recusado. Basta uma em comum
para passar: a membresia real do Brasil tem congregações que o financeiro não
tem, e unidades do financeiro sem linha de membresia. O "Total Geral" sozinho não
prova nada, porque existe nas duas bases. Um arquivo **sem nenhuma unidade** só
entra se a linha de total tiver o nome da base — em Angola, "Central Angola", que
é a membresia de Angola hoje: uma linha só, o país inteiro. A membresia do Brasil
continua recusada no bloco de Angola mesmo com a linha "Central Angola" que ela
ainda traz, porque as unidades dela não casam com as de Angola.

**Os nomes das unidades precisam ser iguais aos do financeiro** — em Angola, os
do 2º nível como estão na planilha ("Central Angola Calumbiro", e não só
"Calumbiro").

**O total da membresia.** Sem filtro de unidade, vale a linha de total da
planilha — "Total Geral", ou o nome da base ("Central Angola") — e, **só na falta
dela**, a soma das unidades que casam com o financeiro. Nunca o contrário: no
Brasil, em setembro, a linha diz 25.432; somar todas as linhas daria 28.602 (a
linha "Central Angola" está no arquivo), e somar só as do financeiro daria 24.352
(o Total Geral inclui congregações ainda sem lançamento). Com essa regra, os três
formatos de arquivo funcionam sem atualizar o sistema: só o total (Angola hoje),
total e unidades (Brasil hoje) e só unidades (Angola, quando o detalhamento
chegar). Uma unidade sem linha na membresia aparece com zero no filtro.

**Resumo da membresia no envio.** Depois de enviar, a tela mostra quantas
unidades o arquivo tem, quantas casaram com o financeiro, a lista das que não
casaram e de onde saiu o total. É informação, não aviso — no Brasil, a lista
sempre traz as congregações sem lançamento. Serve para pegar nome errado:
"Calumbiro" na lista é uma unidade que vai aparecer zerada até o arquivo ser
corrigido e reenviado.

**Quem vê o quê.** O pastor vê as bases em que tem ao menos uma unidade marcada.
Com uma só, entra direto no dashboard dela e não vê alternador nenhum — para
ele, a outra base não existe. Com as duas, escolhe numa tela curta depois do
login e troca pelo alternador no canto superior direito. O Financeiro usa o
mesmo alternador. O dashboard de Angola mostra os valores em kwanza
(`Kz 1.234,56`).

**Meta aparece quando a planilha tem meta.** Não é configuração de país, é o
que a carga trouxe:

- as colunas **"Meta Anual &lt;unidade&gt;"** com algum valor ligam o card "Meta de
  Dízimos", o gráfico "Dízimos e Ofertas vs. Meta" e as partes de meta da
  Seção 2;
- a coluna **"Meta"** preenchida em algum lançamento liga a Seção 4 inteira e o
  filtro "Meta" do topo.

Sem elas, esses blocos simplesmente não aparecem, sem aviso — é o estado normal
de Angola hoje. Quando a planilha de Angola vier com as colunas preenchidas, os
blocos aparecem sozinhos, sem atualização do sistema.

**Aviso de meta no envio.** Quando a planilha tem meta e alguma unidade não tem
coluna "Meta Anual" com **exatamente** o nome dela, o envio avisa e lista as
unidades — não recusa. A correção é na planilha: o nome da coluna tem de ser
igual ao da unidade.

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

O caminho normal **não** é este script: é a tela do administrador. Em _Bases e
permissões_, o ícone de chave na linha do pastor tem duas opções:

- **Mostrar senha** — exibe de novo a senha atual dele, com botão de copiar;
- **Gerar nova senha** — troca a senha; a anterior deixa de valer na hora.

A senha do pastor fica guardada de dois jeitos: em _hash_, que é o que o login
confere, e cifrada, para o "Mostrar senha" poder exibi-la. A do administrador
fica **só** em hash — ninguém pode vê-la, nem pela tela.

Contas de pastor criadas antes desse recurso só têm o hash. Para poder mostrar a
senha delas, gere uma nova uma vez; a partir daí, ela pode ser mostrada sempre.
Trocar o `SESSION_SECRET` tem o mesmo efeito em todas — ver a seção sobre ele.

---

## Perguntas que vão aparecer

**"O pastor diz que não vê nada."**
Provavelmente não tem unidade marcada **na base que ele abriu** — cada base tem as
suas, e marcar o Brasil não libera Angola. O Financeiro abre _Bases e
permissões_, marca as unidades dele na coluna da base certa e aperta **Salvar
seleções** — o botão é fácil de esquecer, e sem ele nada muda. Base marcada sem
nenhuma unidade é base que ele não vê; a tela avisa isso na própria linha.

**"O envio foi recusado: '… não pode entrar na base…'."**
O arquivo é do outro país — o de Angola no bloco do Brasil, ou o contrário. Vale
para o financeiro, a membresia e o saldo. Nada foi enviado, e a base no servidor
continua a mesma. Envie no bloco certo. Na membresia e no saldo, a mesma recusa
pega o arquivo em que **nenhum** nome de unidade bate com o financeiro, e o que
só traz a linha "Total Geral". A mensagem mostra nomes dos dois lados: se o
arquivo é do país certo, corrija os nomes e reenvie.

**"Uma unidade aparece com membresia zero."**
A membresia não tem linha com o nome exato dela. Confira o resumo que aparece
depois do envio: o nome estará entre os que não casaram. Corrija a planilha e
reenvie. As unidades do financeiro que não têm congregação (Colégio Central,
Filiais, Light Church…) aparecem com zero de propósito — é o número certo.

**"Os cards de membresia mostram '—'." / "O card de saldo diz que a base não foi
carregada."**
A base foi enviada sem esse arquivo — vale igual para as duas bases. Reenvie-a
com ele. A tela de envio avisa antes, quando o envio vai sair sem um arquivo que
a base atual tem.

**"Angola não tem a Seção 4, nem o card de meta."**
É o normal enquanto a planilha de Angola vier sem meta — ver _As duas bases_.
Quando ela vier com as colunas preenchidas, os blocos aparecem sozinhos.

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

**A atualização das duas bases (Brasil e Angola) MIGRA o banco** no primeiro
acesso depois de subir: as cargas e as permissões existentes passam a ser do
Brasil. A migração é uma transação só, idempotente, e foi ensaiada numa cópia
do banco real sem perder uma linha. Mesmo assim, confira:

```bash
# 3. Abrir o site uma vez NO NAVEGADOR — a tela de login basta, é ela que abre o
#    banco (um curl não abre) — e, ANTES de qualquer envio, um segundo backup
node ferramentas/backup.mjs /caminho/do/backup

# 4. Comparar os dois backups (os arquivos levam data e hora no nome):
#    tem de terminar em "Nenhuma linha perdida ou alterada em nenhuma tabela."
node ferramentas/impressao-digital.mjs /caminho/do/backup/central-ANTES.db /caminho/do/backup/central-DEPOIS.db
```

Se a migração parar, o log diz `[banco] o esquema não pôde ser preparado` com o
motivo, e nada foi alterado. O caso previsível é uma permissão de um perfil que
não existe mais; a mensagem traz o `perfil_id` e o comando `DELETE` que resolve.
Rodar a impressão digital no backup de antes já mostra esse caso.

---

## Testes

```bash
npm test
```

Rodam na máquina de quem gera o pacote, não no servidor. O que eles protegem:

- um pastor nunca recebe uma unidade que não é dele;
- as duas bases nunca se misturam — pedir uma base sem acesso dá vazio, e
  enviar ou podar uma base não toca na outra;
- a migração para duas bases não perde uma linha;
- cada planilha é lida pela base certa, e o arquivo trocado é recusado;
- os blocos de meta aparecem e somem pelos dados, nunca pelo nome da base.

Cada proteção foi conferida desfazendo-a de propósito: com ela desfeita, algum
teste falha. **Rode antes de publicar qualquer atualização.** Se algum falhar,
não publique: o que eles protegem é exatamente o que não pode vazar.
