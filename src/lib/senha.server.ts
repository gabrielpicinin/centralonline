/*
 * Guarda e conferência de senhas.
 *
 * Usa `scrypt`, que vem no próprio Node — nenhuma biblioteca externa, o que
 * importa num servidor que o TI da Central vai manter sem querer mexer em
 * dependências. Ele é uma função deliberadamente lenta e pesada de memória:
 * conferir uma senha custa ~60ms e 16 MB, o que é imperceptível para quem está
 * entrando e inviabiliza testar milhões de candidatas contra um banco roubado.
 *
 * Para CONFERIR a senha, o que se guarda nunca é ela: é o resultado de uma
 * transformação que não tem volta. Isso vale para todo mundo.
 *
 * A exceção está no fim do arquivo e é só para pastores: além do hash, a senha
 * deles fica guardada cifrada, para o administrador poder mostrá-la de novo. A
 * do administrador nunca. Ver "senha recuperável do pastor", abaixo, para o
 * porquê de cada uma dessas decisões.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

/*
 * N=16384 é o custo. Cada dobra dele dobra tempo e memória; este é o ponto em
 * que a conferência ainda é instantânea para uma pessoa e já é cara demais para
 * quem tenta força bruta. Os parâmetros vão gravados junto do hash para que uma
 * troca futura não invalide as senhas existentes.
 */
const N = 16384;
const r = 8;
const p = 1;
const TAMANHO_CHAVE = 64;

function derivar(senha: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha.normalize("NFKC"), sal, TAMANHO_CHAVE, { N, r, p }, (erro, chave) =>
      erro ? reject(erro) : resolve(chave),
    );
  });
}

/** Formato: `scrypt$N$r$p$sal$hash`, tudo em hexadecimal. */
export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const chave = await derivar(senha, sal);
  return `scrypt$${N}$${r}$${p}$${sal.toString("hex")}$${chave.toString("hex")}`;
}

/**
 * Confere a senha contra o hash guardado.
 *
 * A comparação é feita em tempo constante. Uma comparação comum sai no primeiro
 * byte diferente, e a diferença de tempo entre "errou no primeiro caractere" e
 * "errou no último" é medível pela rede — o bastante para descobrir a senha
 * caractere a caractere.
 */
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;
  const [, nTxt, rTxt, pTxt, salHex, chaveHex] = partes;
  try {
    const sal = Buffer.from(salHex, "hex");
    const esperado = Buffer.from(chaveHex, "hex");
    const chave = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        senha.normalize("NFKC"),
        sal,
        esperado.length,
        { N: Number(nTxt), r: Number(rTxt), p: Number(pTxt) },
        (erro, k) => (erro ? reject(erro) : resolve(k)),
      );
    });
    return chave.length === esperado.length && timingSafeEqual(chave, esperado);
  } catch {
    return false;
  }
}

/*
 * Hash de um valor que ninguém usa, calculado uma vez.
 *
 * Serve para o login conferir alguma coisa mesmo quando o usuário não existe.
 * Sem isso, "usuário inexistente" responderia na hora e "senha errada" levaria
 * os 60ms do scrypt — e essa diferença de tempo diz a quem está sondando quais
 * e-mails têm conta, que é meio caminho andado.
 */
let hashFalso: string | null = null;
export async function queimarTempoDeSenha(senha: string): Promise<void> {
  if (!hashFalso) hashFalso = await gerarHash(randomBytes(32).toString("hex"));
  await conferirSenha(senha, hashFalso);
}

/*
 * Senha gerada para um pastor: duas sílabas e quatro dígitos, como
 * `picos-4712`. Curta e digitável de propósito — ela vai ser passada por
 * WhatsApp e digitada à mão, talvez num celular. Uma senha embaralhada seria
 * mais forte no papel e, na prática, acabaria anotada num bilhete colado no
 * monitor.
 *
 * A entropia vem dos dígitos e da palavra sorteada, e o contexto sustenta o
 * resto: o app só existe dentro da rede da Central, atrás da VPN, e o freio
 * progressivo do login torna a varredura inviável.
 */
const PALAVRAS = [
  "aurora",
  "bonanca",
  "campina",
  "duna",
  "estrela",
  "farol",
  "girassol",
  "horizonte",
  "ilha",
  "jardim",
  "lago",
  "manha",
  "nascente",
  "oliveira",
  "pedra",
  "quintal",
  "raiz",
  "semente",
  "trilha",
  "vale",
  "vento",
  "vitoria",
];

export function gerarSenhaLegivel(): string {
  const palavra = PALAVRAS[randomBytes(1)[0] % PALAVRAS.length];
  // 1000–9999: quatro dígitos sempre, sem zero à esquerda para não sumir na cópia.
  const numero = 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
  return `${palavra}-${numero}`;
}

/* ===================== senha recuperável do pastor ===================== */

/*
 * Tudo acima deste ponto trata a senha como algo que ninguém pode ler. Esta
 * parte abre uma exceção deliberada, e só para pastores.
 *
 * A PEDIDO DA CENTRAL: o administrador precisa poder ver de novo a senha de um
 * pastor — por exemplo quando o botão de copiar falha, o que é comum em HTTP, e
 * a senha gerada sumiria da tela. A regra de "nunca guardar senha recuperável"
 * existe por causa de REUSO: vaza a senha de um sistema, vaza a do e-mail da
 * pessoa. Aqui isso não se aplica — a senha do pastor é gerada pelo sistema e
 * ele não tem como trocá-la por uma dele. E quem conseguisse ler estas senhas
 * no banco já lê todos os números financeiros no mesmo arquivo, que não é
 * cifrado; entrar como pastor não daria nada a mais, porque pastor só lê.
 *
 * O administrador fica de fora. A senha dele permanece só em hash, sempre:
 * quem a tivesse poderia ALTERAR o sistema, e isso sim seria ganho real para
 * quem roubasse o banco.
 *
 * ---------------------------------------------------------------------------
 * POR QUE CIFRAR ALGO QUE O PRÓPRIO SISTEMA VAI DECIFRAR
 * ---------------------------------------------------------------------------
 *
 * Por causa do backup. O arquivo do banco sai do prédio — é o que o OPERACAO.md
 * pede, e com razão. O SESSION_SECRET não sai: ele vive na configuração do
 * serviço, não no banco. Cifrando com uma chave derivada dele, um backup
 * perdido sozinho não revela senha nenhuma. Quem tem o banco E a configuração
 * do servidor consegue decifrar — mas essa pessoa já tem acesso a tudo.
 *
 * A chave é derivada por HKDF em vez de usar o SESSION_SECRET direto porque
 * ele já é usado para selar o cookie de sessão. Reusar os mesmos bytes como
 * chave de outra cifra é má higiene; o HKDF com um rótulo próprio dá uma chave
 * independente a partir do mesmo segredo.
 *
 * CONSEQUÊNCIA QUE PRECISA ESTAR NO MANUAL: trocar o SESSION_SECRET torna as
 * senhas guardadas ilegíveis. Nada quebra — o "Mostrar senha" passa a dizer que
 * não há senha disponível e oferece gerar outra. Mas deixa de ser verdade que
 * trocar o segredo "só derruba as sessões".
 */
function chaveDeCifragem(): Buffer {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET ausente");
  return Buffer.from(hkdfSync("sha256", segredo, "central-online", "senha-visivel-v1", 32));
}

/**
 * Cifra a senha de um pastor para guardar.
 *
 * AES-256-GCM, que além de esconder o conteúdo detecta adulteração: um valor
 * mexido no banco não decifra para uma senha errada, ele simplesmente falha.
 * O `v1` na frente permite trocar o esquema no futuro sem confundir o antigo.
 */
export function cifrarSenha(senha: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveDeCifragem(), iv);
  const corpo = Buffer.concat([cifra.update(senha, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return ["v1", iv, tag, corpo]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join("$");
}

/**
 * Decifra. Devolve `null` em QUALQUER falha, sem distinguir o motivo.
 *
 * Os motivos possíveis são: SESSION_SECRET trocado desde que a senha foi
 * guardada, valor adulterado no banco, ou formato desconhecido. Para quem está
 * na tela a saída é a mesma nos três casos — gerar uma senha nova —, e a
 * pior resposta possível seria mostrar lixo como se fosse a senha.
 */
export function decifrarSenha(guardada: string): string | null {
  const partes = guardada.split("$");
  if (partes.length !== 4 || partes[0] !== "v1") return null;
  try {
    const [, iv, tag, corpo] = partes;
    const decifra = createDecipheriv(
      "aes-256-gcm",
      chaveDeCifragem(),
      Buffer.from(iv, "base64url"),
    );
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decifra.update(Buffer.from(corpo, "base64url")),
      decifra.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
