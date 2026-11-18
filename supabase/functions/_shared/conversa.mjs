/* ============================================================
   Conversa com o lead pelo iGreen Turbo (pedido do Jimmy em 17/11/2026)

   O mesmo modelo do igreencel e do querocarregador: as mensagens ficam no
   Turbo, que recebe os dois números do Jimmy (pessoal e carregador), e o
   painel lê e envia pela API pública de lá (função "conversa"). Aqui ficam
   só as contas, sem rede nem tela: juntar a conversa dos dois números, o
   selo de cada lead, a situação para o filtro, as pastas de fluxos e a onda
   dos gravadores.

   ES5 de propósito, como mensagem.mjs: a função importa este arquivo e o
   build.js cola o conteúdo no script do painel, no lugar do marcador da
   conversa, tirando as palavras de exportação do começo das linhas. Tudo
   começa com "conv"/"CONV" para não colidir com os nomes do painel.
   Testes: tests/conversa.test.mjs.
   ============================================================ */

/* Os números do Jimmy no Turbo. O primeiro é o principal do anovaprofissao e
   do querovendercarregador (o do aviso "quem vai te chamar") e o padrão para enviar. */
export var CONV_NUMEROS = [
  { instancia: "pessoal", rotulo: "(48) 99106-7007", curto: "7007" },
  { instancia: "carregador", rotulo: "(47) 98809-2413", curto: "2413" }
];

export function convEhInstancia(v) {
  for (var i = 0; i < CONV_NUMEROS.length; i++) if (CONV_NUMEROS[i].instancia === v) return true;
  return false;
}

export function convCurto(instancia) {
  for (var i = 0; i < CONV_NUMEROS.length; i++) if (CONV_NUMEROS[i].instancia === instancia) return CONV_NUMEROS[i].curto;
  return String(instancia || "");
}

/* Celular brasileiro como o painel guarda: 55 + DDD + número (com ou sem o 9). */
export function convNumeroValido(v) {
  return typeof v === "string" && /^55[1-9][0-9]9?[0-9]{8}$/.test(v);
}

var CONV_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function convEhUuid(v) { return typeof v === "string" && CONV_UUID.test(v); }

function convMs(v) {
  if (v == null || v === "") return 0;
  var ms = Date.parse(String(v));
  return isNaN(ms) ? 0 : ms;
}

/* Junta as conversas dos números (porInstancia: { pessoal: [...], carregador: [...] }),
   sem repetir a mesma mensagem, da mais antiga para a mais nova. Cada mensagem
   ganha a instância por onde passou. */
export function convJuntar(porInstancia) {
  var vistas = {}, todas = [], p = porInstancia || {};
  for (var i = 0; i < CONV_NUMEROS.length; i++) {
    var inst = CONV_NUMEROS[i].instancia, lista = p[inst] || [];
    for (var k = 0; k < lista.length; k++) {
      var m = lista[k];
      if (!m || typeof m.id !== "string" || Object.prototype.hasOwnProperty.call(vistas, m.id)) continue;
      vistas[m.id] = true;
      var c = {};
      for (var chave in m) if (Object.prototype.hasOwnProperty.call(m, chave)) c[chave] = m[chave];
      c.instancia = inst;
      todas.push(c);
    }
  }
  /* sort estável nos navegadores atuais; empate fica na ordem dos números */
  return todas.sort(function (a, b) { return convMs(a.sent_at) - convMs(b.sent_at); });
}

export var CONV_RESUMO_VAZIO = {
  enviadas: 0, recebidas: 0, ultima_enviada_em: null, ultima_recebida_em: null, ultima_direcao: null, ultima_em: null
};

function convDepois(a, b) { return !b || convMs(a) > convMs(b); }

/* O que o selo do lead precisa: se o Jimmy já mandou mensagem e se a pessoa respondeu. */
export function convResumir(mensagens) {
  var r = {
    enviadas: 0, recebidas: 0, ultima_enviada_em: null, ultima_recebida_em: null, ultima_direcao: null, ultima_em: null
  };
  var lista = mensagens || [];
  for (var i = 0; i < lista.length; i++) {
    var m = lista[i];
    if (!m) continue;
    if (m.direction === "out") {
      r.enviadas++;
      if (m.sent_at && convDepois(m.sent_at, r.ultima_enviada_em)) r.ultima_enviada_em = m.sent_at;
    } else {
      r.recebidas++;
      if (m.sent_at && convDepois(m.sent_at, r.ultima_recebida_em)) r.ultima_recebida_em = m.sent_at;
    }
    if (m.sent_at && convDepois(m.sent_at, r.ultima_em)) {
      r.ultima_em = m.sent_at;
      r.ultima_direcao = m.direction === "out" ? "out" : "in";
    }
  }
  return r;
}

function convIntervalo(iso, agora) {
  var min = Math.max(0, Math.round((agora - convMs(iso)) / 60000));
  if (min < 60) return Math.max(1, min) + " min";
  var h = Math.round(min / 60);
  if (h < 24) return h + " h";
  return Math.round(h / 24) + " d";
}

/* Frase curta do selo, para quem olha a lista saber se já falou com o lead.
   tom: "nenhuma" | "aguardando" | "respondeu" | "recebeu". */
export function convSelo(r, agora) {
  var ag = agora == null ? Date.now() : (typeof agora === "number" ? agora : convMs(agora));
  if (!r || (!r.enviadas && !r.recebidas)) return { texto: "Você ainda não mandou mensagem", tom: "nenhuma" };
  if (r.ultima_direcao === "in" && r.ultima_recebida_em) {
    return r.enviadas
      ? { texto: "Respondeu há " + convIntervalo(r.ultima_recebida_em, ag), tom: "respondeu" }
      : { texto: "Mandou mensagem há " + convIntervalo(r.ultima_recebida_em, ag) + " e ainda não recebeu resposta", tom: "recebeu" };
  }
  var enviada = r.ultima_enviada_em ? " há " + convIntervalo(r.ultima_enviada_em, ag) : "";
  return r.recebidas
    ? { texto: "Você mandou a última" + enviada, tom: "aguardando" }
    : { texto: "Você mandou" + enviada + " · sem resposta", tom: "aguardando" };
}

/* Em que pé está a conversa, para o filtro da lista. Cada lead cai em uma só. */
export var CONV_SITUACOES = [
  { valor: "nenhuma", rotulo: "Ainda não mandei mensagem" },
  { valor: "sem_resposta", rotulo: "Mandei e nunca respondeu" },
  { valor: "aguardando", rotulo: "Mandei por último" },
  { valor: "esperando", rotulo: "Esperando minha resposta" }
];

export function convSituacao(r) {
  if (!r || (!r.enviadas && !r.recebidas)) return "nenhuma";
  if (r.ultima_direcao === "in") return "esperando";
  return r.recebidas ? "aguardando" : "sem_resposta";
}

/* Por cima dos filtros de sempre: só a situação escolhida ("" = todas) e, se
   pedido, a ordem pela última mensagem trocada (mais recente primeiro). Lead
   sem selo carregado não entra no filtro e vai para o fim da ordem, pela data
   do cadastro. numeroDe(l) e criadoDe(l) dizem como ler cada lead. */
export function convListaPorConversa(lista, resumos, filtro, porConversa, numeroDe, criadoDe) {
  var r = lista || [], res = resumos || {};
  if (filtro) {
    r = r.filter(function (l) {
      var x = res[numeroDe(l)];
      return !!x && convSituacao(x) === filtro;
    });
  }
  if (porConversa) {
    var quando = function (l) { var x = res[numeroDe(l)]; return x ? convMs(x.ultima_em) : 0; };
    r = r.slice().sort(function (a, b) { return quando(b) - quando(a) || convMs(criadoDe(b)) - convMs(criadoDe(a)); });
  }
  return r;
}

/* ---- envio de mídia e fluxos, como no iGreen Cel ---- */

/* O que a Conversa manda pelo Turbo: texto, áudio de voz, vídeo redondo, foto, vídeo ou documento. */
export var CONV_TIPOS = ["text", "audio", "ptv", "image", "video", "document"];
export function convTipoValido(v) { return CONV_TIPOS.indexOf(v) !== -1; }

/* Legenda só onde o WhatsApp mostra. */
export function convAceitaLegenda(tipo) { return tipo === "image" || tipo === "video" || tipo === "document"; }

/* Tipo de envio de um arquivo escolhido, pelo tipo que o navegador informa. */
export function convTipoDoArquivo(mime) {
  var t = String(mime || "");
  if (t.indexOf("image/") === 0) return "image";
  if (t.indexOf("video/") === 0) return "video";
  if (t.indexOf("audio/") === 0) return "audio";
  return "document";
}

/* A mesma arrumação da Inbox do Turbo: pastas por nome, só com os fluxos ativos,
   e os fluxos sem pasta (ou numa pasta que não veio) no fim.
   Devolve [{ chave, pasta: {id, name} | null, fluxos: [...] }]. */
export function convGruposDeFluxos(lista) {
  var porNome = function (a, b) { return String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" }); };
  var flows = (lista && lista.flows) || [], folders = (lista && lista.folders) || [];
  var ativos = flows.filter(function (f) { return f && f.status === "active"; }).sort(porNome);
  var conhecidas = {};
  folders.forEach(function (p) { if (p && p.id) conhecidas[p.id] = true; });
  var pastaDe = function (f) { return f.folder_id && conhecidas[f.folder_id] ? f.folder_id : null; };
  var grupos = folders.filter(function (p) { return p && p.id; }).slice().sort(porNome).map(function (p) {
    return { chave: p.id, pasta: p, fluxos: ativos.filter(function (f) { return pastaDe(f) === p.id; }) };
  }).filter(function (g) { return g.fluxos.length > 0; });
  var soltos = ativos.filter(function (f) { return !pastaDe(f); });
  if (soltos.length) grupos.push({ chave: "sem-pasta", pasta: null, fluxos: soltos });
  return grupos;
}

/* ---- agendadas no Turbo (scheduled_messages) ---- */

/* As que ainda vão sair: pendentes (ou saindo) e com hora até 10 min no passado
   (o envio das agendadas do Turbo passa de minuto em minuto). */
export function convAgendadasPendentes(itens, agora) {
  var ag = agora == null ? Date.now() : (typeof agora === "number" ? agora : convMs(agora));
  return (itens || []).filter(function (x) {
    return x && (x.status === "pending" || x.status === "processing") && convMs(x.quando) > ag - 600000;
  }).sort(function (a, b) { return convMs(a.quando) - convMs(b.quando); });
}

/* ---- onda dos gravadores (áudio e vídeo redondo) ----
   Em 15/11/2026 um áudio de 26 s saiu mudo do iPad (pico de −65 dB no Turbo).
   Voz normal fica acima de −35 dB, e até um sussurro passa de −50 dB; abaixo
   disso é microfone sem captar. */
export var CONV_SOM_DB = -50;

/* Volume em dB (RMS) para a altura da barra: −60 dB ou menos vira 0, −10 dB ou mais vira 1. */
export function convNivelDoDb(db) {
  return isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 50)) : 0;
}

/* Volume (dB) de um trecho de amostras de −1 a 1. */
export function convDbDasAmostras(amostras) {
  if (!amostras || !amostras.length) return -Infinity;
  var soma = 0;
  for (var i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i];
  var rms = Math.sqrt(soma / amostras.length);
  return rms > 0 ? 20 * (Math.log(rms) / Math.LN10) : -Infinity;
}

/* Junta as leituras em "barras" colunas, cada uma com o maior nível do seu trecho; gravação curta é esticada. */
export function convResumirNiveis(niveis, barras) {
  var total = (niveis || []).length, saida = [];
  if (!total || barras < 1) return saida;
  for (var i = 0; i < barras; i++) {
    var de = Math.floor((i * total) / barras);
    var ate = Math.max(de + 1, Math.floor(((i + 1) * total) / barras));
    var maior = 0;
    for (var k = de; k < ate && k < total; k++) maior = Math.max(maior, niveis[k]);
    saida.push(maior);
  }
  return saida;
}

/* Mudo só quando deu para medir; sem medição (navegador sem Web Audio) não dá para afirmar (null). */
export function convSaiuMuda(mediu, picoDb) { return mediu ? picoDb < CONV_SOM_DB : null; }

/* 75 -> "1:15" */
export function convDuracao(s) {
  var t = Math.max(0, Math.round(s || 0)), seg = t % 60;
  return Math.floor(t / 60) + ":" + (seg < 10 ? "0" : "") + seg;
}
