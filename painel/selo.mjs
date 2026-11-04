/* ============================================================
   Selo "mensagem agendada" nos leads do painel (nov/2026)

   Pedido do Jimmy (03/11/2026): quando ele agenda o envio de uma mensagem,
   o lead aparece com uma indicação disso. Aqui só se calcula o selo, a partir
   da fila do disparo (tabelas disparos e disparo_envios, db/18); quem busca
   no banco e desenha é o admin.html.

   Como o renderizador (supabase/functions/_shared/mensagem.mjs), o arquivo é
   ES5 puro: o build.js cola o conteúdo no script do painel, no lugar do
   marcador do selo (ver build.js), tirando as palavras de exportação do
   começo das linhas.
   Nomes internos começam com "selo" para não colidir com o painel.
   Testes: tests/selo.test.mjs.

   Regras (um selo por número; só contam envios "pendente" ou "enviando" de
   disparo "ativo" ou "pausado"; com mais de um, vale o mais próximo):
   - envio saindo                        -> "Enviando agora"
   - disparo pausado                     -> "Envio pausado" (tom de alerta)
   - hora marcada no futuro              -> "Mensagem agendada · hoje 18:00"
   - sem hora e o disparo começa depois  -> "Mensagem agendada · a partir de hoje 18:00"
   - o resto (fila que já começou)       -> "Na fila de envio"
   O disparo agendado que foi retomado antes da hora já começou (a primeira
   pessoa ganha hora de agora, antes do início): as outras ficam "Na fila".
   Hora sempre no fuso de Brasília. Quando a mensagem sai, o envio deixa de
   ser "pendente" e o selo some na próxima atualização.
   ============================================================ */

var SELO_DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
var seloFmt = null;

/* Date, número (ms) ou texto ISO -> ms; vazio ou inválido -> NaN */
function seloMs(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  if (typeof v.getTime === "function") return v.getTime();
  return Date.parse(String(v));
}

function seloAgora(agora) {
  var ms = seloMs(agora);
  return isNaN(ms) ? new Date().getTime() : ms;
}

/* Ano, mês, dia, hora e minuto em Brasília */
function seloPartes(ms) {
  try {
    if (!seloFmt) {
      seloFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric", day: "numeric",
        hour: "numeric", minute: "numeric", hourCycle: "h23"
      });
    }
    var p = seloFmt.formatToParts(new Date(ms)), o = {};
    for (var i = 0; i < p.length; i++) o[p[i].type] = parseInt(p[i].value, 10);
    if (o.year > 0 && o.month > 0 && o.day > 0 && o.hour >= 0 && o.minute >= 0) {
      return { ano: o.year, mes: o.month, dia: o.day, hora: o.hour % 24, min: o.minute };
    }
  } catch (e) { /* sem Intl: cai no cálculo fixo abaixo */ }
  var d = new Date(ms - 3 * 3600e3);   // Brasília é UTC-3 (sem horário de verão desde 2019)
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate(), hora: d.getUTCHours(), min: d.getUTCMinutes() };
}

function seloDia(p) { return Math.round(Date.UTC(p.ano, p.mes - 1, p.dia) / 864e5); }
function seloDois(n) { return (n < 10 ? "0" : "") + n; }
function seloHora(p) { return seloDois(p.hora) + ":" + seloDois(p.min); }
function seloDiaMes(p) { return seloDois(p.dia) + "/" + seloDois(p.mes); }

/* "hoje 18:00", "amanhã 09:30" ou "05/11 14:00", em Brasília */
export function quandoSelo(quando, agora) {
  var ms = seloMs(quando);
  if (isNaN(ms)) return "";
  var p = seloPartes(ms), dif = seloDia(p) - seloDia(seloPartes(seloAgora(agora)));
  return (dif === 0 ? "hoje" : dif === 1 ? "amanhã" : seloDiaMes(p)) + " " + seloHora(p);
}

/* "quinta-feira, 05/11 às 14:00", em Brasília */
export function dataCompletaSelo(quando) {
  var ms = seloMs(quando);
  if (isNaN(ms)) return "";
  var p = seloPartes(ms);
  return SELO_DIAS[new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()] + ", " + seloDiaMes(p) + " às " + seloHora(p);
}

/* Só dígitos; 10 ou 11 dígitos (DDD + número) ganham o 55 */
function seloNumero(s) {
  var d = String(s == null ? "" : s).replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d.length >= 10 ? d : "";
}

function seloDoEnvio(e, d, ag, comecou) {
  var total = parseInt(d.total, 10);
  var s = {
    tipo: "fila", curto: "Na fila", texto: "Na fila de envio",
    quando: null, chave: ag, disparo_id: d.id, ordem: parseInt(e.ordem, 10) || 0,
    origem: total === 1 ? "mensagem só para esta pessoa" : total > 1 ? "disparo para " + total + " pessoas" : "disparo pelo painel",
    motivo: "", outras: 0, titulo: ""
  };
  var hora = seloMs(e.agendado_para), ini = seloMs(d.inicio), q;
  if (e.status === "enviando") {
    s.tipo = "enviando"; s.curto = "Enviando"; s.texto = "Enviando agora"; s.chave = -Infinity;
  } else if (d.status === "pausado") {
    s.tipo = "pausado"; s.curto = "Pausada"; s.texto = "Envio pausado"; s.chave = Infinity;
    s.motivo = d.motivo ? String(d.motivo) : "";
  } else if (hora > ag) {
    q = quandoSelo(hora, ag);
    s.tipo = "agendada"; s.curto = "Agendada " + q; s.texto = "Mensagem agendada · " + q;
    s.quando = hora; s.chave = hora;
  } else if (isNaN(hora) && ini > ag && !comecou) {
    q = quandoSelo(ini, ag);
    s.tipo = "apartir"; s.curto = "A partir de " + q; s.texto = "Mensagem agendada · a partir de " + q;
    s.quando = ini; s.chave = ini;
  }
  return s;
}

/* o mais próximo primeiro: saindo agora, fila andando, hora marcada, pausado por último */
function seloAntes(a, b) {
  if (a.chave !== b.chave) return a.chave < b.chave;
  return a.ordem < b.ordem;
}

function seloTitulo(s) {
  var partes = [];
  if (s.quando != null) partes.push(dataCompletaSelo(s.quando));
  partes.push(s.origem);
  var t = s.texto + " (" + partes.join(", ") + ")";
  if (s.motivo) t += ". Motivo: " + s.motivo.replace(/[\s.]+$/, "");
  if (s.outras > 0) t += ". Este número tem mais " + s.outras + (s.outras === 1 ? " mensagem na fila" : " mensagens na fila");
  return t;
}

/* Mapa número (55 + DDD + número) -> selo.
   envios: [{ disparo_id, numero, status, agendado_para, ordem }]
   disparos: [{ id, status, inicio, total, motivo }]
   agora: Date, ms ou ISO (padrão: agora).
   Cada selo: { tipo: "enviando" | "pausado" | "agendada" | "apartir" | "fila",
   curto (texto do pill), texto, titulo (texto completo, com data e origem),
   quando (ms ou null), disparo_id, outras (quantos envios a mais o número tem) }. */
export function selosMensagem(envios, disparos, agora) {
  var ag = seloAgora(agora), porId = {}, mapa = {}, conta = {}, i;
  var ds = disparos || [], es = envios || [];
  for (i = 0; i < ds.length; i++) {
    if (ds[i] && (ds[i].status === "ativo" || ds[i].status === "pausado")) porId[ds[i].id] = ds[i];
  }
  /* disparo que já começou: alguém saindo ou já tentado, ou com hora antes do início (retomado) */
  var comecou = {};
  for (i = 0; i < es.length; i++) {
    var x = es[i];
    if (!x || !Object.prototype.hasOwnProperty.call(porId, x.disparo_id)) continue;
    if ((x.status && x.status !== "pendente" && x.status !== "cancelado") ||
        seloMs(x.agendado_para) < seloMs(porId[x.disparo_id].inicio)) comecou[x.disparo_id] = true;
  }
  for (i = 0; i < es.length; i++) {
    var e = es[i];
    if (!e || (e.status !== "pendente" && e.status !== "enviando")) continue;
    if (!Object.prototype.hasOwnProperty.call(porId, e.disparo_id)) continue;
    var num = seloNumero(e.numero);
    if (!num) continue;
    var s = seloDoEnvio(e, porId[e.disparo_id], ag, comecou[e.disparo_id] === true);
    conta[num] = (conta[num] || 0) + 1;
    if (!mapa[num] || seloAntes(s, mapa[num])) mapa[num] = s;
  }
  for (var n in mapa) {
    if (!Object.prototype.hasOwnProperty.call(mapa, n)) continue;
    mapa[n].outras = conta[n] - 1;
    mapa[n].titulo = seloTitulo(mapa[n]);
  }
  return mapa;
}

/* Selo de um lead pelo WhatsApp dele (aceita com ou sem 55, com máscara). */
export function seloDoNumero(mapa, numero) {
  var n = seloNumero(numero);
  return n && mapa && Object.prototype.hasOwnProperty.call(mapa, n) ? mapa[n] : null;
}
