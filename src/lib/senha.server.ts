/*
 * Guarda e conferência de senhas.
 *
 * Usa `scrypt`, que vem no próprio Node — nenhuma biblioteca externa, o que
 * importa num servidor que o TI da Central vai manter sem querer mexer em
 * dependências. Ele é uma função deliberadamente lenta e pesada de memória:
 * conferir uma senha custa ~60ms e 16 MB, o que é imperceptível para quem está
 * entrando e inviabiliza testar milhões de candidatas contra um banco roubado.
 *
 * O que se guarda nunca é a senha: é o resultado de uma transformação que não
 * tem volta. Nem eu, nem o TI, nem quem copiasse o arquivo do banco consegue
 * lê-la.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

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
