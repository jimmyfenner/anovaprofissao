/* ============================================================
   Mensagens com variáveis — disparo de WhatsApp pelo painel (nov/2026)

   Um arquivo só para os dois lados:
   - a Edge Function "disparos" importa como módulo ESM;
   - o build.js cola este conteúdo dentro do script do admin.html (no lugar
     do marcador), tirando as palavras de exportação do começo das linhas.
   Por isso o código é ES5 puro: function e var, sem arrow, sem crase, sem
   const/let e sem parâmetro com valor padrão. Os nomes internos começam com
   "msg" para não colidir com as funções do painel.
   Testes: tests/mensagem.test.mjs (os mesmos casos do querocarregador).
   ============================================================ */

/* Botões de inserir variável no painel, na ordem em que aparecem. */
export var VARIAVEIS = [
  { nome: "primeiro_nome", rotulo: "Primeiro nome", exemplo: "João" },
  { nome: "nome", rotulo: "Nome completo", exemplo: "João da Silva" },
  { nome: "cidade", rotulo: "Cidade", exemplo: "Florianópolis" },
  { nome: "uf", rotulo: "Estado", exemplo: "SC" },
  { nome: "saudacao", rotulo: "Saudação", exemplo: "bom dia, boa tarde ou boa noite" }
];

/* nome normalizado -> variável ("estado" é apelido de "uf") */
var MSG_CONHECIDAS = { primeironome: "primeironome", nome: "nome", cidade: "cidade", uf: "uf", estado: "uf", saudacao: "saudacao" };
var MSG_MINUSCULAS = { da: 1, de: 1, "do": 1, das: 1, dos: 1, e: 1 };
var MSG_VAZIO = "\u0000";      // marca onde entrou um valor vazio, para a limpeza
var MSG_TOKEN = /\{([^{}\n]+)\}/g;
var MSG_LIMITE = 4096;
var msgFmtHora = null;

/* "Primeiro Nome", "primeiro_nome" e "primeironome" viram a mesma chave */
function msgChave(s) {
  var t = String(s == null ? "" : s);
  if (typeof t.normalize === "function") t = t.normalize("NFD");
  return t.replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_\-]+/g, "");
}

function msgInicialMaiuscula(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* Tira espaços extras. Nome todo em maiúsculas ou todo em minúsculas vira
   "Título" palavra a palavra (da, de, do, das, dos, e ficam minúsculas, menos
   na primeira palavra). Nome com maiúsculas e minúsculas misturadas fica como
   a pessoa escreveu. */
export function formatarNome(s) {
  var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().split(" ").map(function (p, i) {
    if (i > 0 && MSG_MINUSCULAS[p]) return p;
    return p.split("-").map(msgInicialMaiuscula).join("-");
  }).join(" ");
}

function msgHoraBrasilia(d) {
  try {
    if (!msgFmtHora) {
      msgFmtHora = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hourCycle: "h23" });
    }
    var partes = msgFmtHora.formatToParts(d);
    for (var i = 0; i < partes.length; i++) {
      if (partes[i].type === "hour") return parseInt(partes[i].value, 10) % 24;
    }
  } catch (e) { /* sem Intl: cai no cálculo fixo abaixo */ }
  return (d.getUTCHours() + 21) % 24;   // Brasília é UTC-3 (sem horário de verão desde 2019)
}

/* Saudação pela hora de Brasília: 05:00–11:59 bom dia, 12:00–17:59 boa tarde,
   18:00–04:59 boa noite. Em minúsculas; vira maiúscula quando abre frase. */
export function saudacaoPara(agora) {
  var d = agora == null ? new Date() : new Date(agora);
  if (isNaN(d.getTime())) d = new Date();
  var h = msgHoraBrasilia(d);
  if (h >= 5 && h < 12) return "bom dia";
  if (h >= 12 && h < 18) return "boa tarde";
  return "boa noite";
}

function msgValor(chave, dados, agora) {
  if (chave === "saudacao") return saudacaoPara(agora);
  if (chave === "nome") return formatarNome(dados.nome);
  if (chave === "primeironome") return formatarNome(dados.nome).split(" ")[0] || "";
  if (chave === "cidade") return formatarNome(dados.cidade);
  if (chave === "uf") return String(dados.uf == null ? "" : dados.uf).trim().toUpperCase();
  return "";
}

/* O valor abre frase quando o texto antes dele (sem contar espaços e os
   marcadores *_~ do WhatsApp) está vazio ou termina em quebra de linha, . ! ? */
function msgAbreFrase(antes) {
  var t = antes.replace(/[ \t *_~\u0000]+$/, "");
  if (!t) return true;
  var c = t.charAt(t.length - 1);
  return c === "\n" || c === "\r" || c === "." || c === "!" || c === "?";
}

/* Arruma o texto em volta de cada valor que saiu vazio, sem mexer no resto
   da mensagem: espaço duplo vira um, espaço antes de , . ! ? ; : some,
   vírgula duplicada some (e a vírgula que ficaria colada em . ! ? ; :). */
function msgLimpa(s) {
  if (s.indexOf(MSG_VAZIO) !== -1) {
    s = s
      .replace(/\u0000(?:[ \t]*\u0000)+/g, MSG_VAZIO)
      .replace(/(^|\n)[ \t]*\u0000[ \t]*,[ \t]*/g, "$1")
      .replace(/,[ \t]*\u0000[ \t]*(?=[,.!?;:])/g, "")
      .replace(/[ \t]*\u0000[ \t]*(?=[,.!?;:])/g, "")
      .replace(/[ \t]+\u0000[ \t]+/g, " ")
      .replace(/[ \t]*\u0000[ \t]*(?=\r?\n|$)/g, "")
      .replace(/(^|\n)[ \t]*\u0000[ \t]*/g, "$1")
      .replace(/\u0000/g, "");
  }
  s = s.trim();
  return s.length > MSG_LIMITE ? s.slice(0, MSG_LIMITE) : s;
}

/* Lista o que o modelo usa: variáveis conhecidas (com ou sem plano B),
   variáveis desconhecidas e quantas variações {A|B|C} existem. */
export function analisarModelo(modelo) {
  var texto = String(modelo == null ? "" : modelo);
  var usadas = [], desconhecidas = [], vistas = {}, variacoes = 0, m;
  MSG_TOKEN.lastIndex = 0;
  while ((m = MSG_TOKEN.exec(texto)) !== null) {
    var partes = m[1].split("|");
    var chave = MSG_CONHECIDAS[msgChave(partes[0])];
    if (chave) usadas.push({ chave: chave, planoB: partes.length > 1 });
    else if (partes.length > 1) variacoes++;
    else if (!vistas[m[1]]) { vistas[m[1]] = 1; desconhecidas.push(m[1]); }
  }
  MSG_TOKEN.lastIndex = 0;
  return { usadas: usadas, desconhecidas: desconhecidas, variacoes: variacoes };
}

/* {qualquercoisa} sem | e fora da lista: fica no texto como está. */
export function variaveisDesconhecidas(modelo) {
  return analisarModelo(modelo).desconhecidas;
}

/* Texto final para uma pessoa.
   dados: { nome, cidade, uf } (podem vir vazios); agora: Date, número ou ISO;
   sorteio: função que devolve [0, 1) para as variações (padrão Math.random). */
export function renderizar(modelo, dados, agora, sorteio) {
  var rnd = typeof sorteio === "function" ? sorteio : Math.random;
  var d = dados || {};
  var texto = String(modelo == null ? "" : modelo).replace(/\u0000/g, "");
  var saida = "", ultimo = 0, m, re = new RegExp(MSG_TOKEN.source, "g");
  while ((m = re.exec(texto)) !== null) {
    saida += texto.slice(ultimo, m.index);
    ultimo = re.lastIndex;
    var partes = m[1].split("|");
    var chave = MSG_CONHECIDAS[msgChave(partes[0])];
    var v;
    if (chave) {
      v = msgValor(chave, d, agora);
      if (!v && partes.length > 1) v = partes.slice(1).join("|").trim();
      if (v && msgAbreFrase(saida)) v = msgInicialMaiuscula(v);
    } else if (partes.length > 1) {
      var i = Math.floor(rnd() * partes.length);
      if (!(i >= 0)) i = 0;
      if (i > partes.length - 1) i = partes.length - 1;
      v = partes[i].trim();
      if (v && msgAbreFrase(saida)) v = msgInicialMaiuscula(v);   /* só a 1ª letra: o resto fica como foi escrito */
    } else {
      v = m[0];
    }
    saida += v || MSG_VAZIO;
  }
  return msgLimpa(saida + texto.slice(ultimo));
}

/* Número de WhatsApp do Brasil: só dígitos; 10 ou 11 dígitos (DDD + número)
   ganham o 55; 12 ou 13 começando com 55 ficam como estão; o resto é recusado. */
export function normalizarNumero(s) {
  var d = String(s == null ? "" : s).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return { numero: "55" + d, motivo: null };
  if ((d.length === 12 || d.length === 13) && d.indexOf("55") === 0) return { numero: d, motivo: null };
  return { numero: null, motivo: d ? "Número fora do padrão (DDD + número)" : "Sem número de WhatsApp" };
}
