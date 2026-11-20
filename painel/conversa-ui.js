/* ================= CONVERSA PELO iGREEN TURBO (17/11/2026) =================
   Pedido do Jimmy: no querovendercarregador.com.br/admin (o mesmo painel do
   anovaprofissao) a mesma Conversa do igreencel e do querocarregador. Mostra o
   que já foi trocado com o lead nos dois números dele (pessoal 7007 e
   carregador 2413) e manda, pelo número escolhido, texto, áudio gravado, vídeo
   redondo, foto, vídeo, documento ou um fluxo do Turbo (inteiro ou a partir de
   uma etapa); agenda mensagem no Turbo; e tem mensagens prontas editáveis. Tudo
   sai pelo Turbo e fica na Inbox de lá; os arquivos sobem do navegador direto
   para o Turbo (função "conversa", tabelas do db/31).

   O build.js cola este arquivo dentro do script do painel (marcador da
   conversa), depois das contas de supabase/functions/_shared/conversa.mjs.
   Usa as funções do painel ($, esc, sb, CFG, leads, render, mudarStatus...).
   Nomes começam com "cv" para não colidir com o resto do painel. */

var TEM_CONVERSA = typeof convSelo === "function";   // false só no admin.html cru, sem o build
var CV_RELEITURA_MS = 6000;
var CV_MAX_ARQ = 64 * 1024 * 1024;
var CV_MAX_VIDEO = 32 * 1024 * 1024;
var CV_MEDIABUNNY = "https://cdn.jsdelivr.net/npm/mediabunny@1.56.2/dist/bundles/mediabunny.min.mjs";
var CV_PARA = {
  todos: "Todos os leads", integrador: "Integradores (Quero Vender Carregador)", quiz: "Avaliação de perfil (A Nova Profissão)",
  direto: "Cadastro direto", agendamento: "Reuniões agendadas"
};
var CV_ROTULO_TIPO = { image: "Foto", video: "Vídeo", audio: "Áudio", ptv: "Vídeo redondo", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato" };

var cv = null;               // conversa aberta
var cvResumos = {};          // número -> resumo da conversa (+ atualizado_em)
var cvPedidos = {};          // números já pedidos ao Turbo nesta visita
var cvLendo = 0;             // quantos números esperam o Turbo agora
var cvErroResumos = 0;       // hora do último erro ao ler os selos (espera 2 min para tentar de novo)
var cvAgendadas = [];        // conversa_agendadas pendentes (selo "Agendada")
var cvProntas = null;        // mensagens_prontas (null = ainda não leu)

/* ---------- ícones (traço do Lucide) ---------- */
var CV_ICONES = {
  clipe: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  fluxo: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  check2: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  lixo: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  regravar: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  play: '<path d="M6 3l14 9-14 9V3Z" fill="currentColor"/>',
  pausa: '<rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  parar: '<rect width="14" height="14" x="5" y="5" rx="2" fill="currentColor"/>',
  bola: '<circle cx="12" cy="12" r="6" fill="currentColor"/>',
  pasta: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  doc: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  balao: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
  lapis: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>',
  fora: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  seta: '<path d="m9 18 6-6-6-6"/>'
};
function cvIc(nome, cls){
  return '<svg class="cv-ic' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (CV_ICONES[nome] || "") + "</svg>";
}
var CV_GIRA = '<span class="cv-gira" aria-hidden="true"></span>';

/* ---------- quem pode conversar ---------- */
function cvNumero(l){ var n = l && l.whatsapp_e164; return TEM_CONVERSA && convNumeroValido(n) ? n : null; }
function cvMotivo(l){
  if(!TEM_CONVERSA) return "Este painel foi aberto sem passar pelo build (node build.js).";
  if(l.licenciado) return "Lead de espelho de licenciado: quem chama é o licenciado.";
  if(!cvNumero(l)) return "Este lead não tem um celular brasileiro válido.";
  return "";
}
function cvParaDoLead(l){
  if(l.tipo === "agendamento") return "agendamento";
  // o cadastro direto da página de integradores (20/11/2026) também é "direto": não respondeu o formulário
  if(l.tipo === "direto") return "direto";
  if(ehInteg(l)) return "integrador";
  return "quiz";
}

/* ---------- chamada da função "conversa" com o seu login ---------- */
function fnConv(action, extra){
  if(DEMO) return new Promise(function(ok){ setTimeout(function(){ ok(cvDemo(action, extra || {})); }, action === "fluxo" ? 1200 : 350); });
  return sb.auth.getSession().then(function(s){
    var t = s.data.session && s.data.session.access_token;
    return fetch(CFG.url + "/functions/v1/conversa", {
      method: "POST",
      headers: {"Content-Type": "application/json", "apikey": CFG.anonKey, "Authorization": "Bearer " + t},
      body: JSON.stringify(Object.assign({action: action}, extra || {}))
    });
  }).then(function(r){
    return r.json().catch(function(){ return null; }).then(function(j){
      j = j && typeof j === "object" ? j : {};
      if(!r.ok && !j.error) j.error = r.status === 404 ? "A função da conversa ainda não foi publicada." : "O servidor recusou o pedido (erro " + r.status + ").";
      return j;
    });
  }).catch(function(){ return {error: "Não consegui falar com o servidor agora. Confira a internet e tente de novo."}; });
}
function cvFaltaTabela(e){ return e && (e.code === "PGRST205" || e.code === "42P01" || /schema cache/i.test(e.message || "")); }

/* ================= SELOS NA LISTA ================= */

/* selo da conversa embaixo do nome; tocar abre a conversa */
function cvSeloHtml(l){
  var n = cvNumero(l), r = n && cvResumos[n];
  if(!r || l.licenciado) return "";
  var s = convSelo(r, Date.now());
  return '<span class="pill pill--conv is-' + s.tom + '" data-conv-abrir="' + esc(l.id) + '" title="Ver a conversa (iGreen Turbo)">' + esc(s.texto) + "</span>";
}

/* resumos guardados (conversa_resumo): ao abrir o painel e a cada minuto */
function cvCarregarResumos(){
  if(!TEM_CONVERSA) return Promise.resolve(false);
  if(DEMO) return Promise.resolve(false);
  var acc = [];
  var pagina = function(de){
    return sb.from("conversa_resumo").select("*").order("numero").range(de, de + 999).then(function(r){
      if(r.error){ if(!cvFaltaTabela(r.error)) console.error(r.error); return null; }
      acc = acc.concat(r.data || []);
      return (r.data || []).length === 1000 && de < 9000 ? pagina(de + 1000) : acc;
    });
  };
  return pagina(0).then(function(lista){
    if(!lista) return false;
    var mudou = false;
    lista.forEach(function(x){
      var atual = cvResumos[x.numero];
      if(!atual || Date.parse(x.atualizado_em) > Date.parse(atual.atualizado_em)){ cvResumos[x.numero] = x; mudou = true; }
    });
    return mudou;
  });
}

/* pede ao Turbo os selos velhos (mais de 10 min): só os 50 do topo da lista, ou todos quando a
   ordem ou o filtro dependem da conversa. Cada número vai ao Turbo uma vez por visita. */
function cvPedirResumos(fs){
  if(!TEM_CONVERSA || cvLendo || Date.now() - cvErroResumos < 120e3) return;
  var todos = !!($("#f-conv") && $("#f-conv").value) || $("#f-ordem").value === "conversa";
  var nums = [], visto = {};
  fs.forEach(function(l){ var n = cvNumero(l); if(n && !l.licenciado && !visto[n]){ visto[n] = 1; nums.push(n); } });
  var alvo = (todos ? nums : nums.slice(0, 50)).filter(function(n){
    var r = cvResumos[n];
    return !cvPedidos[n] && (!r || Date.now() - Date.parse(r.atualizado_em) > 10 * 60e3);
  });
  cvAvisoLendo(alvo.length);
  if(!alvo.length) return;
  var lote = alvo.slice(0, 25);
  lote.forEach(function(n){ cvPedidos[n] = true; });
  cvLendo = lote.length;
  fnConv("resumos", {numeros: lote}).then(function(r){
    cvLendo = 0;
    var agora = new Date().toISOString();
    Object.keys(r.resumos || {}).forEach(function(n){ cvResumos[n] = Object.assign({}, r.resumos[n], {atualizado_em: agora}); });
    if(r.error || (r.erros && r.erros.length)){
      cvErroResumos = Date.now();
      cvAvisoLendo(0, r.error || r.erros[0]);
    }
    // a lista sai com os selos novos e pede o próximo lote (render chama de novo)
    if(vista === "leads" && !$("#tela-painel").classList.contains("hidden") && podeRedesenhar()) render();
  });
}
function cvAvisoLendo(n, erro){
  var el = $("#cv-lendo");
  if(!el) return;
  el.textContent = erro ? "Selos da conversa: " + erro : n ? "lendo " + n + (n === 1 ? " conversa" : " conversas") + " no iGreen Turbo…" : "";
  el.classList.toggle("is-erro", !!erro);
}

/* agendadas pendentes (conversa_agendadas): junto com os selos de disparo; a cada 5 min
   a função relê no Turbo (pega também as agendadas pela Inbox de lá) */
var cvSincronizou = 0;
function cvCarregarAgendadas(){
  if(!TEM_CONVERSA) return Promise.resolve(false);
  var antes = JSON.stringify(cvAgendadas);
  var ler = function(){
    if(DEMO) return Promise.resolve(CV_DEMO.agendadas.slice());
    return sb.from("conversa_agendadas").select("id,numero,quando,texto,instancia,status,cancelar_se_responder")
      .in("status", ["pending", "processing"]).order("quando").limit(1000).then(function(r){
        if(r.error){ if(!cvFaltaTabela(r.error)) console.error(r.error); return null; }
        return r.data || [];
      });
  };
  var sinc = !DEMO && Date.now() - cvSincronizou > 5 * 60e3;
  if(sinc) cvSincronizou = Date.now();
  return (sinc ? fnConv("agendadas", {}).then(ler) : ler()).then(function(lista){
    if(!lista) return false;
    cvAgendadas = lista;
    return JSON.stringify(cvAgendadas) !== antes;
  });
}
function cvSelosTurbo(){ return TEM_SELO && typeof selosTurbo === "function" ? selosTurbo(cvAgendadas, Date.now()) : {}; }
var cvSelosTb = {};          // número -> selo da agendada no Turbo (painel/selo.mjs)
function cvRefazSelos(){ cvSelosTb = cvSelosTurbo(); selosSujos = true; }
function cvSeloTurboDe(l){ return TEM_SELO && TEM_CONVERSA ? seloDoNumero(cvSelosTb, l.whatsapp_e164) : null; }

/* ================= JANELA DA CONVERSA ================= */

function cvAbrirPorId(id){
  var l = leads.find(function(x){ return x.id === id; });
  if(l) cvAbrir(l);
}

function cvAbrir(l){
  var motivo = cvMotivo(l);
  if(motivo){ alert(motivo); return; }
  if(cv) cvFechar(true);
  var n = cvNumero(l);
  cv = {
    lead: l, numero: n, nome: l.nome, mensagens: null, ids: [], doisNumeros: false, erros: [], falha: null,
    instancia: CONV_NUMEROS[0].instancia, escolheu: false, anexo: null, gravando: null, grav: null,
    comFluxos: false, fluxos: null, enviando: null, erro: null, agendar: false, agendadas: [], prontas: false,
    volta: document.activeElement, timer: null, lendo: false
  };
  $("#cv-tit").textContent = l.nome || fmtNumero(n);
  $("#cv-sub").innerHTML = '<span class="mono">' + esc(fmtNumero(n)) + "</span> · conversa nos seus dois WhatsApps, pelo iGreen Turbo · " +
    '<a href="https://wa.me/' + esc(n) + '" target="_blank" rel="noopener">WhatsApp ' + cvIc("fora", "cv-ic--p") + "</a>";
  $("#cv-msgs").innerHTML = '<p class="cv-vazio">' + CV_GIRA + " Lendo a conversa no iGreen Turbo…</p>";
  $("#cv-erros").classList.add("hidden");
  $("#cv-txt").value = "";
  $("#cv-fluxos").classList.add("hidden");
  $("#cv-gerenciar").classList.add("hidden");
  $("#cv-ag").classList.add("hidden");
  $("#cv-agendadas").innerHTML = "";
  $("#cv-inst").innerHTML = CONV_NUMEROS.map(function(x){ return '<option value="' + x.instancia + '">' + esc(x.rotulo) + "</option>"; }).join("");
  $("#cv-inst").value = cv.instancia;
  $("#conv").classList.remove("hidden");
  document.body.classList.add("modal-aberto");
  cvAtualiza();
  cvLer();
  cvLerAgendadas();
  cvCarregarProntas().then(function(){ if(cv) cvAtualiza(); });
  var c = cv;
  cv.timer = setInterval(function(){ if(cv === c && document.visibilityState === "visible" && !cv.lendo) cvLer(); }, CV_RELEITURA_MS);
  setTimeout(function(){ if(cv === c && window.matchMedia("(min-width: 720px)").matches) $("#cv-txt").focus(); }, 30);
}

/* força: troca de conversa ou exclusão (sem perguntar) */
function cvFechar(forca){
  if(!cv) return;
  if(!forca && (cv.gravando || cv.enviando)){
    cvErro(cv.gravando ? "Pare ou descarte a gravação antes de fechar." : "Espere o envio terminar.");
    return;
  }
  clearInterval(cv.timer);
  if(cv.grav) cv.grav.destruir();
  var volta = cv.volta;
  cv = null;
  $("#conv").classList.add("hidden");
  $("#cv-grav-video").innerHTML = "";
  $("#cv-grav-audio").innerHTML = "";
  document.body.classList.remove("modal-aberto");
  if(vista === "leads") render();   // os selos que a conversa leu
  if(volta && volta.focus && document.body.contains(volta)) volta.focus();
}

function cvErro(t){
  if(cv) cv.erro = t || null;
  $("#cv-erro").innerHTML = t ? '<p class="cv-alerta" role="alert">' + cvIc("alerta") + "<span>" + esc(t) + "</span></p>" : "";
}

/* ---------- leitura ---------- */
function cvLer(){
  if(!cv) return Promise.resolve();
  var c = cv;
  c.lendo = true;
  return fnConv("ler", {numero: c.numero}).then(function(r){
    c.lendo = false;
    if(cv !== c) return;
    if(r.error){ c.falha = r.error; if(!c.mensagens) cvMostraFalha(); return; }
    c.falha = null;
    c.erros = r.erros || [];
    var lidas = Array.isArray(r.mensagens) ? r.mensagens : [];
    c.mensagens = lidas;
    cvMostraMensagens(lidas);
    var e = $("#cv-erros");
    e.textContent = c.erros.length ? "Não deu para ler tudo agora. " + c.erros.join(" · ") : "";
    e.classList.toggle("hidden", !c.erros.length);
    // sem escolha de quem toca, a resposta sai pelo número da última mensagem que o Jimmy mandou
    if(!c.escolheu){
      for(var i = lidas.length - 1; i >= 0; i--){
        if(lidas[i].direction === "out"){ c.instancia = lidas[i].instancia; $("#cv-inst").value = c.instancia; break; }
      }
    }
    if(!c.erros.length) cvResumos[c.numero] = Object.assign(convResumir(lidas), {atualizado_em: new Date().toISOString()});
  });
}
function cvMostraFalha(){
  $("#cv-msgs").innerHTML = '<p class="cv-alerta cv-alerta--amb">' + cvIc("alerta") + "<span>" + esc(cv.falha) + "</span></p>";
  cv.ids = [];
}

function cvHora(iso){
  return iso ? new Date(iso).toLocaleString("pt-BR", {timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"}) : "";
}
function cvEntrega(m){
  if(m.direction !== "out") return "";
  var s = m.delivery_status;
  if(s === "read") return '<span class="cv-tique is-lida" title="Lida">' + cvIc("check2") + "</span>";
  if(s === "delivered") return '<span class="cv-tique" title="Entregue">' + cvIc("check2") + "</span>";
  if(s === "failed" || s === "error") return '<span class="cv-tique is-falhou" title="Não saiu">' + cvIc("alerta") + "</span>";
  if(s === "pending") return '<span class="cv-tique" title="Enviando">' + cvIc("relogio") + "</span>";
  return '<span class="cv-tique" title="Enviada">' + cvIc("check") + "</span>";
}
function cvMidia(m){
  var url = m.media_url && /^https?:\/\//.test(m.media_url) ? m.media_url : (DEMO && /^blob:/.test(m.media_url || "") ? m.media_url : null);
  var rot = CV_ROTULO_TIPO[m.msg_type] || m.msg_type;
  if(!url) return m.msg_type === "text" ? "" : '<p class="cv-b__rot">[' + esc(rot) + "]</p>";
  var falha = ' data-rotulo="' + esc(rot) + '"';
  if(m.msg_type === "image" || m.msg_type === "sticker")
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener"><img class="cv-b__img' + (m.msg_type === "sticker" ? " is-fig" : "") + '" src="' + esc(url) + '" alt="" loading="lazy"' + falha + "></a>";
  if(m.msg_type === "audio") return '<audio class="cv-b__aud" src="' + esc(url) + '" controls preload="none"' + falha + "></audio>";
  if(m.msg_type === "video" || m.msg_type === "ptv")
    return '<video class="cv-b__vid' + (m.msg_type === "ptv" ? " is-ptv" : "") + '" src="' + esc(url) + '" controls playsinline preload="metadata"' + falha + "></video>";
  return '<a class="cv-b__doc" href="' + esc(url) + '" target="_blank" rel="noopener">' + cvIc("doc") + " " + esc(rot) + "</a>";
}
function cvMeta(m, mostrarNumero){
  return (m.author_type === "ai" ? "IA · " : m.author_type === "automation" ? "Fluxo · " : "") +
    (mostrarNumero ? '<span title="Seu WhatsApp por onde passou">pelo ' + esc(convCurto(m.instancia)) + " · </span>" : "") +
    esc(cvHora(m.sent_at)) + " " + cvEntrega(m);
}
function cvBalao(m, mostrarNumero){
  var minha = m.direction === "out";
  return '<div class="cv-b ' + (minha ? "is-minha" : "is-dele") + '" data-mid="' + esc(m.instancia + "-" + m.id) + '"><div class="cv-b__c">' +
    cvMidia(m) + (m.content ? '<p class="cv-b__t">' + esc(m.content) + "</p>" : "") +
    '<p class="cv-b__m">' + cvMeta(m, mostrarNumero) + "</p></div></div>";
}

/* atualiza sem refazer o que já está na tela (um áudio tocando não para a cada releitura) */
function cvMostraMensagens(lista){
  var box = $("#cv-msgs");
  var perto = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  var ids = lista.map(function(m){ return m.instancia + "-" + m.id; });
  var insts = {};
  lista.forEach(function(m){ insts[m.instancia] = 1; });
  var dois = Object.keys(insts).length > 1;
  if(!lista.length){
    box.innerHTML = '<p class="cv-vazio">Nenhuma mensagem com este número nos seus dois WhatsApps ainda.</p>';
    cv.ids = []; cv.doisNumeros = false;
    return;
  }
  var prefixo = cv.ids.length > 0 && dois === cv.doisNumeros && cv.ids.length <= ids.length &&
    cv.ids.every(function(id, i){ return ids[i] === id; });
  if(!prefixo){
    box.innerHTML = lista.map(function(m){ return cvBalao(m, dois); }).join("");
    perto = true;
  }else{
    // as que já estão: só a hora e o tique; as novas entram no fim
    lista.forEach(function(m, i){
      if(i < cv.ids.length){
        var el = box.querySelector('[data-mid="' + CSS.escape(ids[i]) + '"] .cv-b__m');
        if(el) el.innerHTML = cvMeta(m, dois);
      }else{
        box.insertAdjacentHTML("beforeend", cvBalao(m, dois));
      }
    });
  }
  cv.ids = ids; cv.doisNumeros = dois;
  if(perto) box.scrollTop = box.scrollHeight;
}

/* mídia que não carrega (link vencido) vira o rótulo */
document.addEventListener("error", function(e){
  var el = e.target;
  if(!el || !el.getAttribute || !el.closest || !el.closest("#cv-msgs") || !el.getAttribute("data-rotulo")) return;
  var p = document.createElement("p");
  p.className = "cv-b__rot";
  p.textContent = "[" + el.getAttribute("data-rotulo") + "]";
  var alvo = el.parentNode && el.parentNode.tagName === "A" ? el.parentNode : el;
  alvo.parentNode.replaceChild(p, alvo);
}, true);

/* ---------- estado do compositor ---------- */
function cvOcupado(){ return !!(cv && cv.enviando); }
function cvAtualiza(){
  if(!cv) return;
  cvAcertaPronta();
  var ocup = cvOcupado(), grav = !!cv.gravando, a = cv.anexo, txt = $("#cv-txt"), tem = !!txt.value.trim();
  txt.classList.toggle("hidden", cv.gravando === "audio");
  txt.disabled = ocup || !!(a && a.redondo);
  txt.maxLength = a ? 1024 : 4096;
  txt.placeholder = a && !a.redondo ? "Legenda (opcional)" : a ? "Vídeo redondo vai sem legenda" : "Escreva a mensagem";
  txt.setAttribute("aria-label", a && !a.redondo ? "Legenda" : "Mensagem");
  ["#cv-b-anexo", "#cv-b-fluxo", "#cv-b-video", "#cv-b-audio"].forEach(function(s){ $(s).disabled = ocup || grav; });
  $("#cv-b-agendar").disabled = ocup || grav;
  $("#cv-b-fluxo").classList.toggle("is-on", cv.comFluxos);
  $("#cv-b-agendar").classList.toggle("is-on", cv.agendar);
  $("#cv-b-fluxo").setAttribute("aria-pressed", cv.comFluxos ? "true" : "false");
  $("#cv-b-agendar").setAttribute("aria-pressed", cv.agendar ? "true" : "false");
  $("#cv-inst").disabled = ocup;
  $("#cv-ag").classList.toggle("hidden", !cv.agendar);

  // anexo
  var an = $("#cv-anexo");
  an.classList.toggle("hidden", !a);
  if(a){
    an.innerHTML = cvIc(a.redondo ? "video" : "clipe", "cv-ic--cor") +
      '<span class="cv-anexo__n">' + esc(a.redondo ? "Vídeo redondo pronto" : a.arquivo.name) + "</span>" +
      (a.tipo === "video" && !a.redondo ? '<button class="btn btn--sm" type="button" id="cv-redondo"' + (ocup ? " disabled" : "") + ">Mandar redondo</button>" : "") +
      (a.redondo ? '<button class="cv-bt" type="button" id="cv-anexo-regravar" aria-label="Gravar de novo" title="Gravar de novo"' + (ocup ? " disabled" : "") + ">" + cvIc("regravar") + "</button>" : "") +
      '<button class="cv-bt" type="button" id="cv-anexo-x" aria-label="Tirar o anexo" title="Tirar o anexo"' + (ocup ? " disabled" : "") + ">" + cvIc("x") + "</button>";
  }

  // agendar: só texto
  var quando = cvQuandoAgendado(), dq = "", okq = true;
  if(cv.agendar){
    if(a){ dq = "O agendamento vai só com texto. Tire o anexo para agendar."; okq = false; }
    else if(isNaN(quando)){ dq = "Escolha o dia e a hora."; okq = false; }
    else if(quando < Date.now() - 60e3){ dq = "Esse horário já passou."; okq = false; }
    else if(quando > Date.now() + 180 * 864e5){ dq = "Agende para no máximo 180 dias à frente."; okq = false; }
    else dq = "Sai " + quandoBR(quando) + " (horário de Brasília), pelo " + convCurto(cv.instancia) + ".";
  }
  $("#cv-ag-dica").textContent = dq;
  $("#cv-ag-dica").classList.toggle("is-erro", !okq);

  // botão principal
  var b = $("#cv-enviar");
  b.classList.toggle("hidden", cv.gravando === "audio");
  b.disabled = ocup || (!tem && !a) || (cv.agendar && (!okq || !tem));
  b.innerHTML = (ocup ? CV_GIRA : cvIc(cv.agendar ? "relogio" : "enviar")) + (cv.agendar ? " Agendar" : " Enviar");
  $("#cv-estado").innerHTML = cv.enviando ? CV_GIRA + " " + esc(cv.enviando) : esc(cv.agendar ? "A mensagem fica na fila do iGreen Turbo e sai sozinha na hora." : "Ctrl+Enter (ou ⌘+Enter) também envia.");

  cvMostraProntas();
  cvCresce();
  // o gravador acompanha o envio (botão "Enviando…")
  if(cv.grav && cv.grav.atualizar) cv.grav.atualizar();
}
/* "hoje às 18:00", "amanhã às 09:30" ou "05/11 às 14:00" (Brasília) */
function cvQuando(ms){ return quandoBR(ms).replace(/^às /, "hoje às ").replace(/^em /, ""); }
/* a caixa cresce com o texto (até umas 7 linhas), para a mensagem pronta ser lida inteira antes de sair */
function cvCresce(){
  var el = $("#cv-txt");
  if(el.classList.contains("hidden")) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight + 2, 190) + "px";
}

/* ---------- envio ---------- */
function cvSubir(arquivo){
  var tipo = arquivo.type || "application/octet-stream";
  if(DEMO) return Promise.resolve(URL.createObjectURL(arquivo));
  return fnConv("upload", {nome: arquivo.name, tipo: tipo}).then(function(r){
    if(r.error) throw new Error(r.error);
    return fetch(r.upload_url, {method: "PUT", body: arquivo, headers: {"Content-Type": tipo, "x-upsert": "false"}})
      .catch(function(){ return null; })
      .then(function(resp){
        if(!resp || !resp.ok) throw new Error("O arquivo não subiu. Confira a internet e tente de novo.");
        return r.public_url;
      });
  });
}

/* envio: {tipo, texto?, arquivo?, legenda?} -> Promise<boolean> */
function cvEnviar(envio){
  if(!cv || cv.enviando) return Promise.resolve(false);
  var c = cv;
  c.enviando = envio.arquivo ? "Subindo o arquivo" : "Enviando";
  cvErro(null);
  cvAtualiza();
  var midia = Promise.resolve({});
  if(envio.arquivo){
    midia = cvSubir(envio.arquivo).then(function(url){
      c.enviando = "Enviando";
      if(cv === c) cvAtualiza();
      var x = {media_url: url, mime_type: envio.arquivo.type, filename: envio.arquivo.name};
      if(envio.legenda) x.legenda = envio.legenda;
      return x;
    });
  }
  return midia.then(function(m){
    var corpo = {numero: c.numero, nome: c.nome, instancia: c.instancia, tipo: envio.tipo};
    if(envio.tipo === "text") corpo.texto = envio.texto; else Object.assign(corpo, m);
    return fnConv("enviar", corpo);
  }).then(function(r){
    if(r.error) throw new Error(r.error);
    c.enviando = null;
    cvMarcarContatado(c.lead);
    if(cv === c){ cvAtualiza(); cvAvisoOk(r.pendente ? "Mensagem na fila do WhatsApp." : "Mensagem enviada."); cvLer(); }
    return true;
  }).catch(function(e){
    c.enviando = null;
    if(cv === c){ cvErro(e.message || String(e)); cvAtualiza(); }
    return false;
  });
}
function cvMarcarContatado(l){
  if(l && l.status === "novo") mudarStatus(l.id, "contatado");
}
function cvAvisoOk(t){
  var el = $("#cv-ok");
  el.textContent = t;
  el.classList.remove("hidden");
  clearTimeout(cvAvisoOk.t);
  cvAvisoOk.t = setTimeout(function(){ el.classList.add("hidden"); }, 3500);
}

function cvMandar(){
  if(!cv || cvOcupado()) return;
  var texto = $("#cv-txt").value.trim(), a = cv.anexo;
  if(cv.agendar){ cvAgendar(); return; }
  if(a){
    cvEnviar({tipo: a.redondo ? "ptv" : a.tipo, arquivo: a.arquivo, legenda: a.redondo ? "" : cvRender(texto, cv.lead)}).then(function(ok){
      if(ok && cv){ cv.anexo = null; $("#cv-txt").value = ""; cvAtualiza(); }
    });
    return;
  }
  if(!texto) return;
  cvEnviar({tipo: "text", texto: cvRender(texto, cv.lead)}).then(function(ok){
    if(ok && cv){ $("#cv-txt").value = ""; cvAtualiza(); }
  });
}

/* ---------- anexo ---------- */
function cvEscolherArquivo(f){
  if(!f || !cv) return;
  cvErro(null);
  if(f.size > CV_MAX_ARQ) return cvErro("O arquivo passa de 64 MB.");
  var tipo = convTipoDoArquivo(f.type);
  if(tipo === "video" && f.size > CV_MAX_VIDEO) return cvErro("O WhatsApp aceita vídeo de até 32 MB.");
  cv.anexo = {arquivo: f, tipo: tipo, redondo: false};
  cv.agendar = false;
  cvAtualiza();
}
function cvTornarRedondo(){
  if(!cv || !cv.anexo) return;
  var c = cv;
  cvErro(null);
  c.enviando = "Preparando o vídeo redondo";
  cvAtualiza();
  cvParaVideoRedondo(c.anexo.arquivo).then(function(blob){
    c.enviando = null;
    if(cv !== c) return;
    c.anexo = {arquivo: new File([blob], "redondo-" + Date.now() + ".mp4", {type: "video/mp4"}), tipo: "video", redondo: true};
    cvAtualiza();
  }).catch(function(e){
    c.enviando = null;
    if(cv === c){ cvErro(e.message || "Não deu para preparar o vídeo redondo."); cvAtualiza(); }
  });
}

/* Vídeo redondo do WhatsApp: MP4 H.264 quadrado, até 60 s. Recorta o centro do que a câmera gravou. */
function cvParaVideoRedondo(entrada){
  return import(CV_MEDIABUNNY).catch(function(){
    throw new Error("Não consegui carregar o preparador de vídeo. Confira a internet e tente de novo.");
  }).then(function(mb){
    var input = new mb.Input({formats: mb.ALL_FORMATS, source: new mb.BlobSource(entrada)});
    var target = new mb.BufferTarget();
    var output = new mb.Output({format: new mb.Mp4OutputFormat({fastStart: "in-memory"}), target: target});
    return input.computeDuration().then(function(dur){
      var op = {input: input, output: output, video: {codec: "avc", width: 480, height: 480, fit: "cover"}, audio: {codec: "aac"}};
      if(dur > 60) op.trim = {start: 0, end: 60};
      return mb.Conversion.init(op);
    }).then(function(conv){
      if(!conv.isValid) throw new Error("Este aparelho não consegue preparar o vídeo redondo.");
      return conv.execute();
    }).then(function(){
      if(!target.buffer) throw new Error("O vídeo redondo saiu vazio.");
      return new Blob([target.buffer], {type: "video/mp4"});
    });
  });
}

/* ---------- gravações ---------- */
function cvGravar(tipo){
  if(!cv) return;
  cvErro(null);
  cv.comFluxos = false;
  cv.agendar = false;
  $("#cv-fluxos").classList.add("hidden");
  if(cv.grav) cv.grav.destruir();
  cv.gravando = tipo;
  var op = {
    aoEnviar: function(arquivo){
      return cvEnviar({tipo: tipo === "video" ? "ptv" : "audio", arquivo: arquivo}).then(function(ok){
        if(ok && cv && cv.gravando === tipo){ cv.grav.destruir(); cv.grav = null; cv.gravando = null; cvAtualiza(); }
        return ok;
      });
    },
    aoRegravar: function(){ cvGravar(tipo); },
    aoCancelar: function(){ if(cv){ if(cv.grav) cv.grav.destruir(); cv.grav = null; cv.gravando = null; cvAtualiza(); } },
    ocupado: cvOcupado,
    erroDoEnvio: function(){ return cv && cv.erro; }
  };
  cv.grav = tipo === "audio" ? cvGravadorAudio($("#cv-grav-audio"), op) : cvGravadorVideo($("#cv-grav-video"), op);
  cvAtualiza();
}

/* formato que o gravador deste aparelho sabe fazer; no iPad, MP4 (o Turbo converte para o WhatsApp) */
function cvFormato(tipo){
  var op = tipo === "audio"
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
    : ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm"];
  for(var i = 0; i < op.length; i++) if(typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(op[i])) return op[i];
  return tipo === "audio" ? "audio/mp4" : "video/mp4";
}
function cvExtensao(mime){
  return mime.indexOf("mp4") !== -1 ? (mime.indexOf("audio") === 0 ? "m4a" : "mp4") : mime.indexOf("ogg") !== -1 ? "ogg" : mime.indexOf("webm") !== -1 ? "webm" : "bin";
}
var CV_AVISO_SURDO = "Não estou ouvindo nada. Confira se o microfone está liberado e se outro app não está usando.";
var CV_AVISO_CORTADO = "O aparelho cortou o microfone (outro app ou uma ligação). A gravação pode sair muda.";
function cvAvisoGrav(t, escuro){ return '<p class="cv-alerta' + (escuro ? " cv-alerta--esc" : "") + '" role="alert">' + cvIc("alerta") + "<span>" + esc(t) + "</span></p>"; }

/* medidor de som do microfone: onda ao vivo, "surdo" (3 s sem som) e "cortado" (o aparelho tirou o microfone) */
function cvMedidor(stream, aoMudar){
  var m = {recentes: [], gravadas: [], pico: -Infinity, mediu: false, gravando: false, inicio: 0, surdo: false, cortado: false, ligado: true};
  m.comecar = function(){ m.gravadas = []; m.pico = -Infinity; m.mediu = false; m.inicio = performance.now(); m.gravando = true; };
  m.terminar = function(){ m.gravando = false; if(m.surdo){ m.surdo = false; aoMudar(); } };
  m.parar = function(){};
  var trilha = stream && stream.getAudioTracks()[0];
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if(!trilha || !Ctx) return m;
  var ctx;
  try{ ctx = new Ctx(); }catch(e){ return m; }
  var fonte = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
  an.fftSize = 1024;
  // ligado à saída por um volume zero: no Safari, analisador solto pode ler só zeros
  var calado = ctx.createGain();
  calado.gain.value = 0;
  fonte.connect(an); an.connect(calado); calado.connect(ctx.destination);
  var amostras = new Float32Array(an.fftSize);
  var acordar = function(){ if(ctx.state === "suspended") ctx.resume().catch(function(){}); };
  acordar();
  window.addEventListener("pointerdown", acordar);
  var muda = function(v){ if(m.cortado !== v){ m.cortado = v; aoMudar(); } };
  var aoCortar = function(){ muda(true); }, aoVoltar = function(){ muda(false); };
  trilha.addEventListener("mute", aoCortar);
  trilha.addEventListener("unmute", aoVoltar);
  trilha.addEventListener("ended", aoCortar);
  m.cortado = trilha.muted || trilha.readyState === "ended";
  var quadro = 0, ultima = 0, aberto = performance.now();
  var ler = function(agora){
    quadro = requestAnimationFrame(ler);
    // dá 1 s para o navegador ligar a medição antes de pedir um toque
    var lig = ctx.state === "running" || agora - aberto < 1000;
    if(lig !== m.ligado){ m.ligado = lig; aoMudar(); }
    if(ctx.state !== "running" || agora - ultima < 60) return;
    ultima = agora;
    an.getFloatTimeDomainData(amostras);
    var db = convDbDasAmostras(amostras), nivel = convNivelDoDb(db);
    m.recentes.push(nivel);
    if(m.recentes.length > 120) m.recentes.shift();
    if(!m.gravando) return;
    m.mediu = true;
    m.gravadas.push(nivel);
    if(db > m.pico) m.pico = db;
    var s = convSaiuMuda(true, m.pico) === true && agora - m.inicio > 3000;
    if(s !== m.surdo){ m.surdo = s; aoMudar(); }
  };
  quadro = requestAnimationFrame(ler);
  m.parar = function(){
    cancelAnimationFrame(quadro);
    window.removeEventListener("pointerdown", acordar);
    trilha.removeEventListener("mute", aoCortar);
    trilha.removeEventListener("unmute", aoVoltar);
    trilha.removeEventListener("ended", aoCortar);
    try{ fonte.disconnect(); }catch(e){}
    // fecha para o iPad voltar a tocar pelo alto-falante na prévia
    ctx.close().catch(function(){});
    m.recentes = [];
  };
  return m;
}
/* onda que corre da direita para a esquerda com o som que o microfone está captando agora */
function cvOndaAoVivo(tela, m){
  var g = tela.getContext("2d"), quadro = 0, cor = "", apagada = "";
  if(!g) return function(){};
  var desenhar = function(){
    quadro = requestAnimationFrame(desenhar);
    var dpr = window.devicePixelRatio || 1, w = tela.clientWidth, h = tela.clientHeight;
    if(!w || !h) return;
    if(tela.width !== Math.round(w * dpr) || tela.height !== Math.round(h * dpr) || !cor){
      tela.width = Math.round(w * dpr); tela.height = Math.round(h * dpr);
      var est = getComputedStyle(tela.parentElement || tela);
      cor = est.color; apagada = est.borderColor || cor;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var passo = 5, cabem = Math.floor(w / passo), v = m.recentes.slice(-cabem);
    for(var i = 0; i < cabem; i++){
      var x = w - (cabem - i) * passo + 1, nivel = v[i - (cabem - v.length)];
      var alt = nivel === undefined ? 2 : Math.max(3, nivel * h);
      g.fillStyle = nivel === undefined || nivel < 0.05 ? apagada : cor;
      g.fillRect(x, (h - alt) / 2, 3, alt);
    }
  };
  quadro = requestAnimationFrame(desenhar);
  return function(){ cancelAnimationFrame(quadro); };
}
function cvMedirGravacao(m, desde){
  return {segundos: (performance.now() - desde) / 1000, niveis: m.gravadas.slice(), muda: convSaiuMuda(m.mediu, m.pico)};
}
/* onda da gravação pronta: a parte já tocada fica acesa, e um toque pula para aquele ponto */
function cvOndaGravadaHtml(niveis){
  var b = convResumirNiveis(niveis, 44);
  return '<div class="cv-onda" role="slider" aria-label="Posição na gravação" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">' +
    (b.length ? b.map(function(n){ return '<i style="height:' + Math.max(8, Math.round(n * 100)) + '%"></i>'; }).join("")
              : '<span class="cv-onda__linha"><b></b></span>') + "</div>";
}
/* toca a gravação pronta: play/pausa, posição e o tempo, sem depender da duração que o arquivo informa */
function cvPrevia(gravacao, midia, aoAndar){
  var p = {tocando: false, posicao: 0, defeito: false};
  var url = URL.createObjectURL(gravacao.arquivo);
  midia.src = url;
  midia.preload = "auto";
  var quadro = 0;
  var total = function(){ var d = midia.duration; return d && isFinite(d) ? d : gravacao.segundos || 1; };
  var seguir = function(){ quadro = requestAnimationFrame(seguir); p.posicao = midia.currentTime; aoAndar(); };
  midia.addEventListener("ended", function(){ cancelAnimationFrame(quadro); p.tocando = false; p.posicao = 0; aoAndar(); });
  midia.addEventListener("error", function(){ p.defeito = true; aoAndar(); });
  p.fracao = function(){ return Math.min(1, p.posicao / total()); };
  p.alternar = function(){
    if(midia.paused){
      midia.play().then(function(){ p.tocando = true; quadro = requestAnimationFrame(seguir); aoAndar(); }, function(){ p.defeito = true; aoAndar(); });
    }else{
      midia.pause(); cancelAnimationFrame(quadro); p.tocando = false; aoAndar();
    }
  };
  p.buscar = function(f){ midia.currentTime = f * total(); p.posicao = midia.currentTime; aoAndar(); };
  p.parar = function(){ midia.pause(); cancelAnimationFrame(quadro); p.tocando = false; };
  p.destruir = function(){ p.parar(); URL.revokeObjectURL(url); };
  return p;
}
function cvLigarOnda(raiz, previa){
  var onda = raiz.querySelector(".cv-onda");
  if(!onda) return;
  onda.addEventListener("click", function(e){
    var r = onda.getBoundingClientRect();
    previa.buscar(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  });
}
function cvAndarOnda(raiz, fracao){
  var onda = raiz.querySelector(".cv-onda");
  if(!onda) return;
  onda.setAttribute("aria-valuenow", String(Math.round(fracao * 100)));
  var bs = onda.querySelectorAll("i");
  for(var i = 0; i < bs.length; i++) bs[i].classList.toggle("is-on", (i + 0.5) / bs.length <= fracao);
  var linha = onda.querySelector(".cv-onda__linha b");
  if(linha) linha.style.width = (fracao * 100) + "%";
}

/* Áudio de voz: começa a gravar ao abrir, Parar leva para a prévia, e só Enviar manda. */
function cvGravadorAudio(host, op){
  var g = {vivo: true, stream: null, rec: null, med: null, relogio: null, pararOnda: null, gravacao: null, previa: null};
  var desde = 0;
  var redesenhaAvisos = function(){
    var av = host.querySelector(".cv-g__avisos");
    if(av && g.med) av.innerHTML = g.med.cortado ? cvAvisoGrav(CV_AVISO_CORTADO) : g.med.surdo ? cvAvisoGrav(CV_AVISO_SURDO) : "";
    var toque = host.querySelector(".cv-g__toque");
    if(toque && g.med) toque.classList.toggle("hidden", g.med.ligado);
  };
  var telaGravando = function(){
    host.innerHTML = '<div class="cv-g cv-g--rec">' +
      '<span class="cv-g__bola">' + cvIc("bola") + "</span>" +
      '<span class="cv-g__tempo">0:00</span>' +
      '<span class="cv-g__onda"><canvas aria-hidden="true"></canvas><span class="cv-g__toque hidden">Toque aqui para ver o som</span><span class="cv-g__abrindo">Abrindo o microfone</span></span>' +
      '<button class="cv-bt cv-bt--g" type="button" data-g="descartar" aria-label="Descartar" title="Descartar">' + cvIc("lixo") + "</button>" +
      '<button class="cv-g__parar" type="button" data-g="parar" disabled>' + cvIc("parar") + " Parar</button></div>" +
      '<div class="cv-g__avisos"></div>';
    host.querySelector('[data-g="descartar"]').addEventListener("click", op.aoCancelar);
    host.querySelector('[data-g="parar"]').addEventListener("click", function(){ if(g.rec && g.rec.state === "recording") g.rec.stop(); });
  };
  var telaPrevia = function(){
    var gr = g.gravacao;
    host.innerHTML = '<div class="cv-g cv-g--prev"><div class="cv-g__linha">' +
      '<button class="cv-g__play" type="button" data-g="play" aria-label="Ouvir a gravação">' + cvIc("play") + "</button>" +
      cvOndaGravadaHtml(gr.niveis) + '<span class="cv-g__tempo">' + convDuracao(gr.segundos) + "</span></div>" +
      '<div class="cv-g__avisos">' + (gr.muda ? cvAvisoGrav("Este áudio saiu sem som. Confira o microfone e grave de novo.") : "") + "</div>" +
      '<div class="cv-g__acoes">' +
      '<button class="cv-bt cv-bt--g" type="button" data-g="descartar" aria-label="Descartar" title="Descartar">' + cvIc("lixo") + "</button>" +
      '<button class="btn btn--sm" type="button" data-g="regravar">' + cvIc("regravar") + " Gravar de novo</button>" +
      '<button class="btn ' + (gr.muda ? "" : "btn--primary ") + 'cv-g__env" type="button" data-g="enviar"></button></div>' +
      '<audio class="hidden"></audio></div>';
    var midia = host.querySelector("audio");
    g.previa = cvPrevia(gr, midia, function(){
      var p = g.previa;
      host.querySelector('[data-g="play"]').innerHTML = cvIc(p.tocando ? "pausa" : "play");
      host.querySelector('[data-g="play"]').setAttribute("aria-label", p.tocando ? "Pausar" : "Ouvir a gravação");
      host.querySelector(".cv-g__tempo").textContent = convDuracao(p.tocando || p.posicao > 0 ? p.posicao : gr.segundos);
      cvAndarOnda(host, p.fracao());
      if(p.defeito) host.querySelector(".cv-g__avisos").innerHTML = cvAvisoGrav("Este aparelho não conseguiu tocar a gravação. Grave de novo antes de mandar.");
    });
    cvLigarOnda(host, g.previa);
    host.querySelector('[data-g="play"]').addEventListener("click", function(){ g.previa.alternar(); });
    host.querySelector('[data-g="descartar"]').addEventListener("click", op.aoCancelar);
    host.querySelector('[data-g="regravar"]').addEventListener("click", op.aoRegravar);
    host.querySelector('[data-g="enviar"]').addEventListener("click", function(){ g.previa.parar(); op.aoEnviar(gr.arquivo); });
    g.atualizar();
  };
  g.atualizar = function(){
    var b = host.querySelector('[data-g="enviar"]');
    if(!b) return;
    var oc = op.ocupado();
    b.disabled = oc;
    b.innerHTML = (oc ? CV_GIRA : cvIc("enviar")) + (g.gravacao && g.gravacao.muda ? " Enviar mesmo assim" : " Enviar");
    host.querySelectorAll('[data-g="descartar"],[data-g="regravar"]').forEach(function(x){ x.disabled = oc; });
  };
  g.destruir = function(){
    g.vivo = false;
    clearInterval(g.relogio);
    if(g.pararOnda) g.pararOnda();
    if(g.rec && g.rec.state === "recording") g.rec.stop();
    if(g.stream) g.stream.getTracks().forEach(function(t){ t.stop(); });
    if(g.med) g.med.parar();
    if(g.previa) g.previa.destruir();
    host.innerHTML = "";
  };
  telaGravando();
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined"){
    host.innerHTML = '<div class="cv-g cv-g--erro">Este navegador não grava áudio. <button class="cv-link" type="button">Fechar</button></div>';
    host.querySelector("button").addEventListener("click", op.aoCancelar);
    return g;
  }
  navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}}).then(function(stream){
    if(!g.vivo){ stream.getTracks().forEach(function(t){ t.stop(); }); return; }
    g.stream = stream;
    var mime = cvFormato("audio"), rec = new MediaRecorder(stream, {mimeType: mime}), pedacos = [];
    desde = performance.now();
    g.med = cvMedidor(stream, redesenhaAvisos);
    g.med.comecar();
    rec.ondataavailable = function(e){ if(e.data.size) pedacos.push(e.data); };
    rec.onstop = function(){
      clearInterval(g.relogio);
      var medida = cvMedirGravacao(g.med, desde);
      stream.getTracks().forEach(function(t){ t.stop(); });
      if(g.pararOnda) g.pararOnda();
      g.med.parar();
      if(!g.vivo) return;
      var tipo = (rec.mimeType || mime).split(";")[0];
      medida.arquivo = new File([new Blob(pedacos, {type: tipo})], "audio-" + Date.now() + "." + cvExtensao(tipo), {type: tipo});
      g.gravacao = medida;
      telaPrevia();
    };
    rec.start(250);
    g.rec = rec;
    host.querySelector(".cv-g__abrindo").remove();
    host.querySelector('[data-g="parar"]').disabled = false;
    g.pararOnda = cvOndaAoVivo(host.querySelector("canvas"), g.med);
    redesenhaAvisos();
    g.relogio = setInterval(function(){
      var t = host.querySelector(".cv-g__tempo");
      if(t) t.textContent = convDuracao((performance.now() - desde) / 1000);
    }, 250);
  }).catch(function(){
    if(!g.vivo) return;
    host.innerHTML = '<div class="cv-g cv-g--erro">O microfone não foi liberado. Libere nas permissões do navegador e tente de novo. <button class="cv-link" type="button">Fechar</button></div>';
    host.querySelector("button").addEventListener("click", op.aoCancelar);
  });
  return g;
}

/* Vídeo redondo: câmera da frente, até 60 s; Parar prepara o MP4 quadrado e mostra para ver antes de mandar.
   Cobre a janela da conversa (host com position:absolute no quadro dela). */
var CV_VOLTA = 2 * Math.PI * 48;
function cvGravadorVideo(host, op){
  var g = {vivo: true, estado: "abrindo", stream: null, rec: null, med: null, relogio: null, pararOnda: null, gravacao: null, previa: null, segundos: 0, enviou: false, erro: null};
  var desde = 0;
  host.innerHTML = '<div class="cv-pv" role="dialog" aria-label="Gravar vídeo redondo"><div class="cv-pv__in">' +
    '<div class="cv-pv__circ"><div class="cv-pv__janela">' +
      '<video class="cv-pv__cam" muted playsinline autoplay></video>' +
      '<video class="cv-pv__prev hidden" playsinline></video>' +
      '<div class="cv-pv__conv hidden">' + CV_GIRA + " Preparando o vídeo</div>" +
      '<button class="cv-pv__ver hidden" type="button" aria-label="Ver o vídeo"><span>' + cvIc("play") + "</span></button>" +
    "</div>" +
    '<svg class="cv-pv__anel hidden" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="' + CV_VOLTA + '" stroke-dashoffset="' + CV_VOLTA + '"/></svg>' +
    "</div>" +
    '<div class="cv-pv__erro"></div>' +
    '<div class="cv-pv__mic hidden"><div class="cv-g__linha"><span class="cv-pv__rot">Microfone</span><span class="cv-g__onda cv-g__onda--esc"><canvas aria-hidden="true"></canvas><span class="cv-g__toque hidden">Toque aqui para ver o som</span></span></div><div class="cv-g__avisos"></div></div>' +
    '<div class="cv-pv__rev hidden"><div class="cv-g__linha cv-g__linha--esc"></div><div class="cv-pv__avisos"></div></div>' +
    '<div class="cv-pv__acoes"></div>' +
    '<p class="cv-pv__nota hidden">O lead vê o vídeo assim, sem o espelho da câmera.</p>' +
    "</div></div>";
  var $h = function(s){ return host.querySelector(s); };
  // clique dentro do gravador não fecha a conversa
  $h(".cv-pv").addEventListener("click", function(e){ e.stopPropagation(); });

  var avisos = function(){
    var av = $h(".cv-pv__mic .cv-g__avisos");
    if(av && g.med) av.innerHTML = g.med.cortado ? cvAvisoGrav(CV_AVISO_CORTADO, true) : g.med.surdo ? cvAvisoGrav(CV_AVISO_SURDO, true) : "";
    var toque = $h(".cv-pv__mic .cv-g__toque");
    if(toque && g.med) toque.classList.toggle("hidden", g.med.ligado);
  };
  var anel = function(fracao, cor){
    var a = $h(".cv-pv__anel");
    a.classList.remove("hidden");
    a.querySelector("circle").setAttribute("stroke-dashoffset", String(CV_VOLTA * (1 - fracao)));
    a.setAttribute("data-cor", cor);
  };
  var acoes = function(){
    var a = $h(".cv-pv__acoes"), oc = op.ocupado();
    if(g.estado === "revendo"){
      var muda = g.gravacao && g.gravacao.muda;
      a.innerHTML = '<button class="cv-pv__bt cv-pv__bt--icone" type="button" data-g="descartar" aria-label="Descartar" title="Descartar"' + (oc ? " disabled" : "") + ">" + cvIc("lixo") + "</button>" +
        '<button class="cv-pv__bt" type="button" data-g="regravar"' + (oc ? " disabled" : "") + ">" + cvIc("regravar") + " Gravar de novo</button>" +
        '<button class="cv-pv__bt ' + (muda ? "" : "cv-pv__bt--cor") + '" type="button" data-g="enviar"' + (oc ? " disabled" : "") + ">" + (oc ? CV_GIRA : cvIc("enviar")) + (muda ? " Enviar mesmo assim" : " Enviar") + "</button>";
    }else{
      a.innerHTML = '<button class="cv-pv__bt" type="button" data-g="cancelar">Cancelar</button>' +
        (g.estado === "pronto" && !g.erro ? '<button class="cv-pv__bt cv-pv__bt--rec" type="button" data-g="gravar">' + cvIc("bola") + " Gravar</button>" : "") +
        (g.estado === "gravando" ? '<button class="cv-pv__bt cv-pv__bt--rec" type="button" data-g="parar">' + cvIc("parar") + " Parar</button>" : "");
    }
    var liga = function(k, f){ var b = a.querySelector('[data-g="' + k + '"]'); if(b) b.addEventListener("click", f); };
    liga("descartar", op.aoCancelar);
    liga("cancelar", op.aoCancelar);
    liga("regravar", op.aoRegravar);
    liga("gravar", gravar);
    liga("parar", parar);
    liga("enviar", function(){
      if(!g.gravacao) return;
      g.previa.parar();
      g.enviou = true;
      op.aoEnviar(g.gravacao.arquivo).then(function(){ if(g.vivo){ acoes(); erroEnvio(); } });
      acoes();
    });
  };
  var erroEnvio = function(){
    var e = op.erroDoEnvio();
    $h(".cv-pv__avisos").innerHTML = (g.gravacao && g.gravacao.muda ? cvAvisoGrav("Este vídeo saiu sem som. Confira o microfone e grave de novo.", true) : "") +
      (g.previa && g.previa.defeito ? cvAvisoGrav("Este aparelho não conseguiu tocar o vídeo. Grave de novo antes de mandar.", true) : "") +
      (g.enviou && !op.ocupado() && e ? cvAvisoGrav(e, true) : "");
  };
  var mostraErro = function(t){
    g.erro = t;
    $h(".cv-pv__circ").classList.add("hidden");
    $h(".cv-pv__mic").classList.add("hidden");
    $h(".cv-pv__erro").innerHTML = cvAvisoGrav(t, true);
    acoes();
  };
  var parar = function(){
    clearInterval(g.relogio);
    if(g.rec && g.rec.state === "recording") g.rec.stop();
  };
  var gravar = function(){
    if(!g.stream) return;
    var stream = g.stream, mime = cvFormato("video"), pedacos = [];
    var rec = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 2000000});
    desde = performance.now();
    g.med.comecar();
    rec.ondataavailable = function(e){ if(e.data.size) pedacos.push(e.data); };
    rec.onstop = function(){
      // guarda a onda antes de soltar o microfone (que limpa o medidor)
      var medida = cvMedirGravacao(g.med, desde);
      g.med.terminar();
      stream.getTracks().forEach(function(t){ t.stop(); });
      if(g.pararOnda) g.pararOnda();
      g.med.parar();
      if(!g.vivo) return;
      g.stream = null;
      g.estado = "convertendo";
      $h(".cv-pv__mic").classList.add("hidden");
      $h(".cv-pv__anel").classList.add("hidden");
      $h(".cv-pv__conv").classList.remove("hidden");
      acoes();
      cvParaVideoRedondo(new Blob(pedacos, {type: (rec.mimeType || mime).split(";")[0]})).then(function(blob){
        if(!g.vivo) return;
        medida.segundos = Math.min(60, medida.segundos);
        medida.arquivo = new File([blob], "redondo-" + Date.now() + ".mp4", {type: "video/mp4"});
        g.gravacao = medida;
        g.estado = "revendo";
        revendo();
      }).catch(function(e){ if(g.vivo) mostraErro(e.message || "Não deu para preparar o vídeo redondo."); });
    };
    rec.start(250);
    g.rec = rec;
    g.segundos = 0;
    g.estado = "gravando";
    $h(".cv-pv__rot").innerHTML = '<span class="cv-g__bola">' + cvIc("bola") + '</span> <span class="cv-pv__t">0:00</span>';
    acoes();
    g.relogio = setInterval(function(){
      g.segundos = (performance.now() - desde) / 1000;
      var t = $h(".cv-pv__t");
      if(t) t.textContent = convDuracao(g.segundos);
      anel(Math.min(1, g.segundos / 60), "rec");
      // o WhatsApp corta o vídeo redondo em 1 minuto: para sozinho ali
      if(g.segundos >= 60) parar();
    }, 250);
  };
  var revendo = function(){
    var gr = g.gravacao;
    $h(".cv-pv__conv").classList.add("hidden");
    $h(".cv-pv__cam").classList.add("hidden");
    var v = $h(".cv-pv__prev");
    v.classList.remove("hidden");
    $h(".cv-pv__rev").classList.remove("hidden");
    $h(".cv-pv__nota").classList.remove("hidden");
    $h(".cv-pv__rev .cv-g__linha").innerHTML = cvOndaGravadaHtml(gr.niveis) + '<span class="cv-g__tempo">' + convDuracao(gr.segundos) + "</span>";
    var ver = $h(".cv-pv__ver");
    g.previa = cvPrevia(gr, v, function(){
      var p = g.previa;
      ver.classList.toggle("hidden", p.tocando);
      $h(".cv-pv__rev .cv-g__tempo").textContent = convDuracao(p.tocando || p.posicao > 0 ? p.posicao : gr.segundos);
      cvAndarOnda($h(".cv-pv__rev"), p.fracao());
      anel(p.fracao(), "cor");
      erroEnvio();
    });
    ver.classList.remove("hidden");
    ver.addEventListener("click", function(){ g.previa.alternar(); });
    v.addEventListener("click", function(){ g.previa.alternar(); });
    cvLigarOnda($h(".cv-pv__rev"), g.previa);
    anel(0, "cor");
    erroEnvio();
    acoes();
  };
  g.atualizar = function(){ if(g.estado === "revendo"){ acoes(); erroEnvio(); } };
  g.destruir = function(){
    g.vivo = false;
    clearInterval(g.relogio);
    if(g.pararOnda) g.pararOnda();
    if(g.rec && g.rec.state === "recording") g.rec.stop();
    if(g.stream) g.stream.getTracks().forEach(function(t){ t.stop(); });
    if(g.med) g.med.parar();
    if(g.previa) g.previa.destruir();
    host.innerHTML = "";
  };
  acoes();
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined"){
    mostraErro("Este navegador não grava vídeo.");
    return g;
  }
  navigator.mediaDevices.getUserMedia({
    video: {facingMode: "user", width: {ideal: 720}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30}},
    audio: {echoCancellation: true, noiseSuppression: true}
  }).then(function(stream){
    if(!g.vivo){ stream.getTracks().forEach(function(t){ t.stop(); }); return; }
    g.stream = stream;
    var cam = $h(".cv-pv__cam");
    cam.srcObject = stream;
    cam.play().catch(function(){});
    g.med = cvMedidor(stream, avisos);
    $h(".cv-pv__mic").classList.remove("hidden");
    g.pararOnda = cvOndaAoVivo($h(".cv-pv__mic canvas"), g.med);
    g.estado = "pronto";
    avisos();
    acoes();
  }).catch(function(){
    if(g.vivo) mostraErro("A câmera não foi liberada. Libere nas permissões do navegador e tente de novo.");
  });
  return g;
}

/* ---------- fluxos ---------- */
function cvAlternarFluxos(){
  if(!cv) return;
  cv.comFluxos = !cv.comFluxos;
  var box = $("#cv-fluxos");
  box.classList.toggle("hidden", !cv.comFluxos);
  if(cv.comFluxos){
    cv.fluxos = {lista: null, erro: null, abertas: {}, fluxo: null, etapas: null, etapa: null, mandando: false};
    cvMostraFluxos();
    var c = cv;
    fnConv("fluxos").then(function(r){
      if(cv !== c || !c.fluxos) return;
      if(r.error) c.fluxos.erro = r.error; else c.fluxos.lista = {flows: r.flows || [], folders: r.folders || []};
      cvMostraFluxos();
    });
  }
  cvAtualiza();
}
function cvMostraFluxos(){
  var f = cv && cv.fluxos, box = $("#cv-fluxos");
  if(!f) return;
  var h = '<div class="cv-fx__top"><strong>' + esc(f.fluxo ? f.fluxo.name : "Mandar um fluxo do iGreen Turbo") + "</strong>" +
    '<button class="cv-link" type="button" data-fx="voltar"' + (f.mandando ? " disabled" : "") + ">" + (f.fluxo ? "Voltar" : "Fechar") + "</button></div>";
  if(f.erro) h += '<p class="cv-fx__erro">' + esc(f.erro) + "</p>";
  if(!f.fluxo){
    if(!f.lista && !f.erro) h += '<p class="cv-vazio">' + CV_GIRA + " Lendo os fluxos</p>";
    if(f.lista){
      var grupos = convGruposDeFluxos(f.lista);
      if(!grupos.length) h += '<p class="cv-vazio">Nenhum fluxo ativo no seu workspace do iGreen Turbo.</p>';
      grupos.forEach(function(g){
        var aberta = !g.pasta || f.abertas[g.chave];
        if(g.pasta){
          h += '<button class="cv-fx__pasta' + (aberta ? " is-aberta" : "") + '" type="button" data-fx-pasta="' + esc(g.chave) + '">' +
            cvIc("seta", "cv-fx__seta") + cvIc("pasta", "cv-ic--cor") + '<span>' + esc(g.pasta.name) + "</span><small>" + g.fluxos.length + "</small></button>";
        }else if(grupos.length > 1){
          h += '<p class="cv-fx__sem">Sem pasta</p>';
        }
        if(aberta){
          h += '<div class="' + (g.pasta ? "cv-fx__dentro" : "") + '">' + g.fluxos.map(function(x){
            return '<button class="cv-fx__item" type="button" data-fx-fluxo="' + esc(x.id) + '">' + cvIc("fluxo") + "<span>" + esc(x.name) + "</span></button>";
          }).join("") + "</div>";
        }
      });
    }
  }else{
    if(!f.etapas && !f.erro) h += '<p class="cv-vazio">' + CV_GIRA + " Lendo as etapas</p>";
    if(f.etapas){
      h += '<div class="cv-fx__etapas" role="radiogroup" aria-label="Por onde o fluxo começa">' +
        [null].concat(f.etapas).map(function(e){
          var marcado = (f.etapa && e && f.etapa.node_id === e.node_id) || (!f.etapa && !e);
          return '<label class="cv-fx__et' + (!e ? " is-inicio" : e.named ? "" : " is-sem-nome") + '"><input type="radio" name="cv-etapa" value="' + esc(e ? e.node_id : "") + '"' + (marcado ? " checked" : "") + ">" +
            "<span>" + esc(e ? e.label : "Do início (fluxo inteiro)") + "</span></label>";
        }).join("") + "</div>";
    }
    var primeiro = String(cv.nome || "").split(" ")[0];
    h += '<button class="btn btn--primary cv-fx__mandar" type="button" data-fx="mandar"' + (!f.etapas || f.mandando ? " disabled" : "") + ">" +
      (f.mandando ? CV_GIRA + " Mandando, pode levar 1 minuto" : cvIc("enviar") + " " + esc("Mandar para " + primeiro + (f.etapa ? ' a partir de "' + f.etapa.label + '"' : ""))) + "</button>";
  }
  box.innerHTML = h;
}
$("#cv-fluxos").addEventListener("click", function(e){
  var f = cv && cv.fluxos;
  if(!f) return;
  var b = e.target.closest("button");
  if(!b) return;
  if(b.getAttribute("data-fx") === "voltar"){
    if(f.fluxo){ f.fluxo = null; f.etapas = null; f.etapa = null; f.erro = null; cvMostraFluxos(); }
    else cvAlternarFluxos();
    return;
  }
  var pasta = b.getAttribute("data-fx-pasta");
  if(pasta){ f.abertas[pasta] = !f.abertas[pasta]; cvMostraFluxos(); return; }
  var id = b.getAttribute("data-fx-fluxo");
  if(id){
    f.fluxo = (f.lista.flows || []).find(function(x){ return x.id === id; }) || null;
    f.etapas = null; f.etapa = null; f.erro = null;
    cvMostraFluxos();
    var c = cv, alvo = f.fluxo;
    fnConv("etapas", {fluxo: id}).then(function(r){
      if(cv !== c || f.fluxo !== alvo) return;
      if(r.error) f.erro = r.error; else f.etapas = Array.isArray(r.steps) ? r.steps : [];
      cvMostraFluxos();
    });
    return;
  }
  if(b.getAttribute("data-fx") === "mandar" && f.fluxo && !f.mandando){
    var c2 = cv, fluxo = f.fluxo, etapa = f.etapa;
    f.mandando = true;
    c2.enviando = "Mandando o fluxo";
    cvErro(null);
    cvMostraFluxos();
    cvAtualiza();
    fnConv("fluxo", {numero: c2.numero, nome: c2.nome, instancia: c2.instancia, fluxo: fluxo.id, etapa: etapa ? etapa.node_id : null}).then(function(r){
      f.mandando = false;
      c2.enviando = null;
      if(!r.error) cvMarcarContatado(c2.lead);
      if(cv !== c2) return;
      if(r.error){ cvErro(r.error); cvMostraFluxos(); cvAtualiza(); return; }
      cvAvisoOk('Fluxo "' + fluxo.name + '" enviado.');
      c2.comFluxos = false;
      $("#cv-fluxos").classList.add("hidden");
      cvAtualiza();
      cvLer();
    });
  }
});
$("#cv-fluxos").addEventListener("change", function(e){
  var f = cv && cv.fluxos;
  if(!f || e.target.name !== "cv-etapa") return;
  var v = e.target.value;
  f.etapa = v ? (f.etapas || []).find(function(x){ return x.node_id === v; }) || null : null;
  cvMostraFluxos();
});

/* ---------- agendar (no iGreen Turbo, só texto) ---------- */
function cvAlternarAgendar(){
  if(!cv) return;
  cv.agendar = !cv.agendar;
  if(cv.agendar && !$("#cv-ag-data").value){
    var sug = Math.ceil((Date.now() + 3600e3) / 300e3) * 300e3;   // daqui a uma hora, de 5 em 5 min
    $("#cv-ag-data").value = diaBR(sug);
    $("#cv-ag-hora").value = horaBR(sug);
  }
  cvAtualiza();
}
function cvQuandoAgendado(){
  var d = $("#cv-ag-data").value, h = $("#cv-ag-hora").value;
  return d && h ? Date.parse(d + "T" + h + ":00-03:00") : NaN;   // Brasília, sem horário de verão
}
function cvAgendar(){
  if(!cv || cvOcupado()) return;
  var c = cv, texto = $("#cv-txt").value.trim(), quando = cvQuandoAgendado();
  if(!texto || isNaN(quando)) return;
  c.enviando = "Agendando no iGreen Turbo";
  cvErro(null);
  cvAtualiza();
  fnConv("agendar", {
    numero: c.numero, nome: c.nome, instancia: c.instancia, texto: cvRender(texto, c.lead, new Date(quando)),
    quando: new Date(quando).toISOString(), cancelar_se_responder: $("#cv-ag-cancela").checked
  }).then(function(r){
    c.enviando = null;
    if(r.item){
      cvAgendadas = cvAgendadas.filter(function(x){ return x.id !== r.item.id; }).concat([r.item]);
      cvRefazSelos();
    }
    if(cv !== c) return;
    if(r.error){ cvErro(r.error); cvAtualiza(); return; }
    c.agendar = false;
    $("#cv-txt").value = "";
    cvAvisoOk("Agendada para " + cvQuando(quando) + ".");
    cvAtualiza();
    cvLerAgendadas();
  });
}
function cvLerAgendadas(){
  if(!cv) return;
  var c = cv;
  fnConv("agendadas", {numero: c.numero}).then(function(r){
    if(cv !== c) return;
    if(r.error){ $("#cv-agendadas").innerHTML = '<p class="cv-agl__erro">Agendadas: ' + esc(r.error) + "</p>"; return; }
    var itens = r.itens || [];
    // a lista de selos passa a valer o que veio do Turbo para este número
    cvAgendadas = cvAgendadas.filter(function(x){ return x.numero !== c.numero; }).concat(itens.filter(function(x){ return x.status === "pending" || x.status === "processing"; }));
    cvRefazSelos();
    c.agendadas = convAgendadasPendentes(itens, Date.now());
    cvMostraAgendadas();
  });
}
function cvMostraAgendadas(){
  var box = $("#cv-agendadas"), it = cv ? cv.agendadas : [];
  if(!it.length){ box.innerHTML = ""; return; }
  box.innerHTML = '<div class="cv-agl"><p class="cv-agl__t">' + cvIc("relogio") + (it.length === 1 ? " Mensagem agendada" : " " + it.length + " mensagens agendadas") + "</p>" +
    it.map(function(x){
      var ms = Date.parse(x.quando);
      return '<div class="cv-agl__i"><div class="cv-agl__c"><b>' + esc(cvQuando(ms)) + "</b>" +
        (x.instancia ? " · pelo " + esc(convCurto(x.instancia)) : "") + (x.cancelar_se_responder ? " · não sai se responder antes" : "") +
        "<span>" + esc(x.texto) + "</span></div>" +
        '<button class="btn btn--sm" type="button" data-cv-cancelar="' + esc(x.id) + '">Cancelar</button></div>';
    }).join("") + "</div>";
}
$("#cv-agendadas").addEventListener("click", function(e){
  var b = e.target.closest("[data-cv-cancelar]");
  if(!b || !cv) return;
  if(!confirm("Cancelar esta mensagem agendada? Ela não vai sair.")) return;
  var c = cv, id = b.getAttribute("data-cv-cancelar");
  b.disabled = true; b.textContent = "Cancelando…";
  fnConv("cancelar_agendada", {id: id}).then(function(r){
    cvAgendadas = cvAgendadas.filter(function(x){ return x.id !== id; });
    cvRefazSelos();
    if(cv !== c) return;
    if(r.error) cvErro(r.error); else cvAvisoOk("Agendamento cancelado.");
    cvLerAgendadas();
  });
});

/* ---------- mensagens prontas ---------- */
function cvCarregarProntas(forcar){
  if(cvProntas && !forcar) return Promise.resolve(cvProntas);
  if(DEMO){ cvProntas = CV_DEMO.prontas; return Promise.resolve(cvProntas); }
  return sb.from("mensagens_prontas").select("*").order("ordem").order("id").then(function(r){
    if(r.error){ if(!cvFaltaTabela(r.error)) console.error(r.error); cvProntas = []; return cvProntas; }
    cvProntas = r.data || [];
    return cvProntas;
  });
}
function cvProntasDoLead(l){
  var para = cvParaDoLead(l);
  return (cvProntas || []).filter(function(p){ return p.para === "todos" || p.para === para; });
}
/* texto final para o lead: {reuniao} com a data da reunião e as variáveis do disparo
   ({primeiro_nome}, {saudacao}...), com a saudação da hora em que a mensagem sai */
function cvRender(modelo, l, agora, sorteio){
  var m = String(modelo || "");
  if(l.agenda_inicio) m = m.replace(/\{\s*reuni[aã]o\s*\}/gi, dataReuniao(l.agenda_inicio));
  if(!TEM_MENSAGEM || !/\{[^{}\n]+\}/.test(m)) return m;
  return renderizar(m, {nome: l.nome, cidade: l.cidade, uf: l.uf}, agora || new Date(), sorteio || Math.random);
}
/* a variação ({Oi|Olá}) fica a mesma enquanto a pronta está na caixa; só a saudação acompanha a hora */
function cvTextoDaPronta(p, l, agora, semente){ return cvRender(p.texto, l, agora, sorteioFixo(semente || 0)); }
/* hora em que a mensagem da caixa vai sair: a agendada, ou agora */
function cvHoraDeSaida(){
  var q = cv && cv.agendar ? cvQuandoAgendado() : NaN;
  return isNaN(q) || q < Date.now() ? new Date() : new Date(q);
}
/* pronta na caixa e sem mudança: acompanha a hora de saída (a saudação muda com o agendamento) */
function cvAcertaPronta(){
  if(!cv || !cv.pronta) return;
  var txt = $("#cv-txt");
  if(txt.value !== cv.pronta.texto){ cv.pronta = null; return; }
  var novo = cvTextoDaPronta(cv.pronta.p, cv.lead, cvHoraDeSaida(), cv.pronta.semente);
  if(novo !== txt.value){ txt.value = novo; cv.pronta.texto = novo; }
}
function cvMostraProntas(){
  var box = $("#cv-prontas");
  if(!cv){ box.innerHTML = ""; return; }
  var gerenciando = !$("#cv-gerenciar").classList.contains("hidden");
  var mostra = !cv.gravando && !cv.anexo && !cv.comFluxos && !gerenciando && !$("#cv-txt").value.trim();
  var ps = cvProntasDoLead(cv.lead);
  box.classList.toggle("hidden", !mostra);
  if(!mostra) return;
  box.innerHTML = ps.map(function(p){
    return '<button class="cv-pronta" type="button" data-pronta="' + esc(p.id) + '" title="' + esc(cvTextoDaPronta(p, cv.lead, new Date(), 0)) + '"' + (cvOcupado() ? " disabled" : "") + ">" +
      cvIc("balao") + " " + esc(p.titulo) + "</button>";
  }).join("") + '<button class="cv-pronta cv-pronta--ed" type="button" data-pronta-ed="1">' + cvIc("lapis") + (ps.length ? " Editar prontas" : " Mensagens prontas") + "</button>";
}
$("#cv-prontas").addEventListener("click", function(e){
  if(!cv) return;
  var b = e.target.closest("button");
  if(!b) return;
  if(b.getAttribute("data-pronta-ed")){ cvAbrirGerenciar(); return; }
  var id = b.getAttribute("data-pronta"), p = (cvProntas || []).find(function(x){ return String(x.id) === id; });
  if(!p) return;
  // o toque só preenche a caixa; quem envia é o botão de sempre, depois de ler
  cvErro(null);
  var semente = Math.floor(Math.random() * 1000);
  var texto = cvTextoDaPronta(p, cv.lead, cvHoraDeSaida(), semente);
  $("#cv-txt").value = texto;
  cv.pronta = {p: p, texto: texto, semente: semente};
  cvAtualiza();
});

/* gerenciar: lista, nova, editar, apagar */
var cvEditando = null;   // pronta em edição ({} = nova)
function cvAbrirGerenciar(){
  $("#cv-gerenciar").classList.remove("hidden");
  cvEditando = null;
  cvMostraGerenciar();
  cvAtualiza();
}
function cvFecharGerenciar(){
  $("#cv-gerenciar").classList.add("hidden");
  cvEditando = null;
  cvAtualiza();
}
function cvMostraGerenciar(msg){
  var box = $("#cv-gerenciar"), ps = cvProntas || [];
  if(cvEditando){
    var p = cvEditando;
    var vars = (TEM_MENSAGEM ? VARIAVEIS : []).concat([{nome: "reuniao", rotulo: "Data da reunião", exemplo: "terça-feira, 18 de novembro às 15:00"}]);
    box.innerHTML = '<div class="cv-ger__top"><strong>' + (p.id ? "Editar mensagem pronta" : "Nova mensagem pronta") + '</strong><button class="cv-link" type="button" data-ger="voltar">Voltar</button></div>' +
      '<div class="cv-ger__form">' +
      '<label class="cv-ger__c"><span>Nome do botão</span><input class="inp" id="cv-ger-tit" maxlength="60" value="' + esc(p.titulo || "") + '" placeholder="Ex.: Convite para a live"></label>' +
      '<label class="cv-ger__c"><span>Aparece para</span><select class="inp" id="cv-ger-para">' +
        Object.keys(CV_PARA).map(function(k){ return '<option value="' + k + '"' + ((p.para || "todos") === k ? " selected" : "") + ">" + esc(CV_PARA[k]) + "</option>"; }).join("") + "</select></label>" +
      '<div class="cv-ger__c"><span>Texto</span><div class="chips cp-vars" id="cv-ger-vars">' +
        vars.map(function(v){ return '<button class="chip" type="button" data-ger-var="' + esc(v.nome) + '" title="' + esc("Ex.: " + v.exemplo) + '">' + esc(v.rotulo) + "</button>"; }).join("") + "</div>" +
        '<textarea class="inp" id="cv-ger-txt" maxlength="4096" placeholder="{saudacao}, {primeiro_nome}! Aqui é o Jimmy…">' + esc(p.texto || "") + "</textarea>" +
        '<span class="dica">As mesmas variáveis do disparo. {reuniao} vira a data da reunião agendada. O texto entra na caixa da conversa para você ler (e mudar) antes de enviar.</span></div>' +
      '<div class="cv-ger__acoes"><button class="btn btn--primary btn--sm" type="button" data-ger="salvar">Salvar</button></div>' +
      (msg ? '<p class="cv-fx__erro">' + esc(msg) + "</p>" : "") + "</div>";
    return;
  }
  box.innerHTML = '<div class="cv-ger__top"><strong>Mensagens prontas</strong><button class="cv-link" type="button" data-ger="fechar">Fechar</button></div>' +
    (ps.length ? ps.map(function(p){
      return '<div class="cv-ger__i"><div class="cv-ger__ic"><b>' + esc(p.titulo) + "</b> <small>" + esc(CV_PARA[p.para] || p.para) + "</small><span>" + esc(p.texto) + "</span></div>" +
        '<button class="btn btn--sm" type="button" data-ger-ed="' + esc(p.id) + '">Editar</button>' +
        '<button class="btn btn--sm" type="button" data-ger-del="' + esc(p.id) + '">Apagar</button></div>';
    }).join("") : '<p class="cv-vazio">Nenhuma mensagem pronta ainda.</p>') +
    '<div class="cv-ger__acoes"><button class="btn btn--sm" type="button" data-ger="nova">Nova mensagem pronta</button></div>' +
    (msg ? '<p class="cv-fx__erro">' + esc(msg) + "</p>" : "");
}
$("#cv-gerenciar").addEventListener("mousedown", function(e){ if(e.target.closest("[data-ger-var]")) e.preventDefault(); });   // não tira o cursor do texto
$("#cv-gerenciar").addEventListener("click", function(e){
  var b = e.target.closest("button");
  if(!b) return;
  var acao = b.getAttribute("data-ger");
  if(acao === "fechar"){ cvFecharGerenciar(); return; }
  if(acao === "voltar"){ cvEditando = null; cvMostraGerenciar(); return; }
  if(acao === "nova"){ cvEditando = {para: cv ? cvParaDoLead(cv.lead) : "todos"}; cvMostraGerenciar(); $("#cv-ger-tit").focus(); return; }
  var v = b.getAttribute("data-ger-var");
  if(v){
    var t = $("#cv-ger-txt"), ini = t.selectionStart, fim = t.selectionEnd, ins = "{" + v + "}";
    t.value = t.value.slice(0, ini) + ins + t.value.slice(fim);
    t.focus(); t.selectionStart = t.selectionEnd = ini + ins.length;
    return;
  }
  var ed = b.getAttribute("data-ger-ed");
  if(ed){ cvEditando = Object.assign({}, (cvProntas || []).find(function(x){ return String(x.id) === ed; })); cvMostraGerenciar(); return; }
  var del = b.getAttribute("data-ger-del");
  if(del){
    var p = (cvProntas || []).find(function(x){ return String(x.id) === del; });
    if(!p || !confirm('Apagar a mensagem pronta "' + p.titulo + '"?')) return;
    cvGravarPronta(null, p.id).then(function(erro){ cvMostraGerenciar(erro); cvAtualiza(); });
    return;
  }
  if(acao === "salvar"){
    var x = {titulo: $("#cv-ger-tit").value.trim(), para: $("#cv-ger-para").value, texto: $("#cv-ger-txt").value.trim()};
    if(!x.titulo || !x.texto){ cvEditando = Object.assign(cvEditando, x); cvMostraGerenciar("Preencha o nome do botão e o texto."); return; }
    b.disabled = true; b.textContent = "Salvando…";
    var id = cvEditando.id;
    if(!id) x.ordem = (cvProntas || []).reduce(function(m, p){ return Math.max(m, p.ordem || 0); }, 0) + 1;
    cvGravarPronta(x, id).then(function(erro){
      if(erro){ cvEditando = Object.assign(cvEditando, x); cvMostraGerenciar(erro); return; }
      cvEditando = null;
      cvMostraGerenciar();
      cvAtualiza();
    });
  }
});
/* grava (x) ou apaga (x = null) e relê a lista; devolve a mensagem de erro ou "" */
function cvGravarPronta(x, id){
  if(DEMO){
    if(!x) CV_DEMO.prontas = CV_DEMO.prontas.filter(function(p){ return p.id !== id; });
    else if(id) CV_DEMO.prontas = CV_DEMO.prontas.map(function(p){ return p.id === id ? Object.assign({}, p, x) : p; });
    else CV_DEMO.prontas = CV_DEMO.prontas.concat([Object.assign({id: Date.now()}, x)]);
    cvProntas = CV_DEMO.prontas;
    return Promise.resolve("");
  }
  var q = !x ? sb.from("mensagens_prontas").delete().eq("id", id).select()
    : id ? sb.from("mensagens_prontas").update(Object.assign({atualizado_em: new Date().toISOString()}, x)).eq("id", id).select()
    : sb.from("mensagens_prontas").insert(x).select();
  return q.then(function(r){
    if(r.error) return cvFaltaTabela(r.error) ? "Falta rodar a migração db/31-conversa.sql." : "Não consegui salvar: " + r.error.message;
    if(!r.data || !r.data.length) return "O banco não gravou nada. Tente de novo.";
    return cvCarregarProntas(true).then(function(){ return ""; });
  });
}

/* ---------- eventos da janela ---------- */
$("#cv-fechar").addEventListener("click", function(){ cvFechar(); });
(function(){
  var noFundo = false;   // só fecha se o toque começou e terminou no fundo
  $("#conv").addEventListener("mousedown", function(e){ noFundo = e.target === this; });
  $("#conv").addEventListener("click", function(e){ if(noFundo && e.target === this) cvFechar(); noFundo = false; });
})();
document.addEventListener("keydown", function(e){ if(e.key === "Escape" && cv && !$("#conv").classList.contains("hidden")) cvFechar(); });
$("#cv-txt").addEventListener("input", function(){ if(cv){ cvAtualiza(); } });
$("#cv-txt").addEventListener("keydown", function(e){
  if(e.key === "Enter" && (e.metaKey || e.ctrlKey)){ e.preventDefault(); cvMandar(); }
});
$("#cv-enviar").addEventListener("click", cvMandar);
$("#cv-b-anexo").addEventListener("click", function(){ $("#cv-arq").click(); });
$("#cv-arq").addEventListener("change", function(e){ cvEscolherArquivo(e.target.files && e.target.files[0]); e.target.value = ""; });
$("#cv-b-fluxo").addEventListener("click", cvAlternarFluxos);
$("#cv-b-video").addEventListener("click", function(){ cvGravar("video"); });
$("#cv-b-audio").addEventListener("click", function(){ cvGravar("audio"); });
$("#cv-b-agendar").addEventListener("click", cvAlternarAgendar);
$("#cv-anexo").addEventListener("click", function(e){
  var b = e.target.closest("button");
  if(!b || !cv) return;
  if(b.id === "cv-redondo") cvTornarRedondo();
  if(b.id === "cv-anexo-x"){ cv.anexo = null; cvAtualiza(); }
  if(b.id === "cv-anexo-regravar"){ cv.anexo = null; cvGravar("video"); }
});
$("#cv-inst").addEventListener("change", function(){ if(cv){ cv.instancia = this.value; cv.escolheu = true; cvAtualiza(); } });
["#cv-ag-data", "#cv-ag-hora"].forEach(function(s){
  $(s).addEventListener("input", cvAtualiza);
  $(s).addEventListener("change", cvAtualiza);
});

/* ---------- LGPD: antes de excluir o lead ---------- */
/* Cancela no Turbo as agendadas que ainda não saíram e apaga o selo e as agendadas do
   número. Se não der para cancelar, nada é apagado (a mensagem sairia para quem pediu
   para ser excluído). Devolve Promise<string>: "" deu certo, ou o motivo. */
function cvAntesDeExcluir(lead){
  if(cv && cv.lead && cv.lead.id === lead.id) cvFechar(true);
  var n = lead && lead.whatsapp_e164;
  if(DEMO || !TEM_CONVERSA || !n) return Promise.resolve("");
  return sb.from("conversa_agendadas").select("id").eq("numero", n).in("status", ["pending", "processing"]).then(function(r){
    if(r.error) return cvFaltaTabela(r.error) ? [] : null;
    return r.data || [];
  }).then(function(pend){
    if(pend === null) return "Não consegui ler as mensagens agendadas deste número.";
    return pend.reduce(function(p, x){
      return p.then(function(erro){
        if(erro) return erro;
        return fnConv("cancelar_agendada", {id: x.id}).then(function(r){
          // já saiu ou já estava cancelada: segue
          return r.error && !/já saiu|cancelada|não existe/i.test(r.error) ? "Não consegui cancelar a mensagem agendada no iGreen Turbo: " + r.error : "";
        });
      });
    }, Promise.resolve("")).then(function(erro){
      if(erro) return erro;
      var ok = function(r){ return !r.error || cvFaltaTabela(r.error); };
      return Promise.all([
        sb.from("conversa_agendadas").delete().eq("numero", n),
        sb.from("conversa_resumo").delete().eq("numero", n)
      ]).then(function(rs){
        if(!rs.every(ok)) return "Não consegui apagar o histórico da conversa deste número.";
        delete cvResumos[n];
        cvAgendadas = cvAgendadas.filter(function(x){ return x.numero !== n; });
        cvRefazSelos();
        return "";
      });
    });
  });
}

/* ---------- modo demonstração ---------- */
var CV_DEMO = {
  msgs: {}, agendadas: [],
  prontas: [
    {id: 1, titulo: "Primeiro contato", para: "integrador", ordem: 1, texto: "Olá {primeiro_nome}! Aqui é o Jimmy. Recebi suas respostas na página para integradores — posso te mostrar como a Conexão Mob se encaixa no seu trabalho?"},
    {id: 2, titulo: "Primeiro contato", para: "quiz", ordem: 2, texto: "Olá {primeiro_nome}! Aqui é o Jimmy, do site A Nova Profissão. Vi que você terminou a avaliação de perfil — posso te explicar como funciona?"},
    {id: 3, titulo: "Primeiro contato", para: "direto", ordem: 3, texto: "Olá {primeiro_nome}! Aqui é o Jimmy, do site A Nova Profissão. Vi que você foi para o cadastro — estou aqui para te ajudar em qualquer passo."},
    {id: 4, titulo: "Sobre a reunião", para: "agendamento", ordem: 4, texto: "Olá {primeiro_nome}! Aqui é o Jimmy. É sobre a nossa reunião de {reuniao}, pelo Google Meet — o link está no convite que foi para o seu e-mail."}
  ]
};
function cvDemoMsgs(n){
  if(!CV_DEMO.msgs[n]){
    var h = function(x){ return new Date(Date.now() - x * 3600e3).toISOString(); };
    var final = parseInt(n.slice(-1), 10) || 0;
    CV_DEMO.msgs[n] = final % 3 === 0 ? [] : [
      {id: n + "1", direction: "out", msg_type: "text", content: "Olá! Aqui é o Jimmy. Recebi suas respostas — posso te mostrar como funciona?", media_url: null, sent_at: h(30), delivery_status: "read", author_type: null, instancia: "pessoal"},
      {id: n + "2", direction: "in", msg_type: "text", content: "Oi Jimmy! Pode sim, me manda mais detalhes.", media_url: null, sent_at: h(29), delivery_status: null, author_type: null, instancia: "pessoal"},
      {id: n + "3", direction: "out", msg_type: "audio", content: null, media_url: null, sent_at: h(28.8), delivery_status: "delivered", author_type: null, instancia: "pessoal"},
      {id: n + "4", direction: "out", msg_type: "text", content: "Vou te mandar o vídeo da apresentação agora.", media_url: null, sent_at: h(2), delivery_status: "delivered", author_type: "automation", instancia: final % 2 ? "carregador" : "pessoal"}
    ];
  }
  return CV_DEMO.msgs[n];
}
function cvDemo(acao, x){
  if(acao === "ler") return {mensagens: cvDemoMsgs(x.numero).slice(), erros: []};
  if(acao === "resumos"){
    var res = {};
    (x.numeros || []).forEach(function(n){ res[n] = convResumir(cvDemoMsgs(n)); });
    return {resumos: res, erros: []};
  }
  if(acao === "enviar" || acao === "fluxo"){
    var tipo = acao === "fluxo" ? "text" : x.tipo;
    cvDemoMsgs(x.numero).push({id: x.numero + Date.now(), direction: "out", msg_type: tipo,
      content: acao === "fluxo" ? "[fluxo da demonstração]" : tipo === "text" ? x.texto : (x.legenda || null),
      media_url: x.media_url || null, sent_at: new Date().toISOString(), delivery_status: "pending", author_type: acao === "fluxo" ? "automation" : null, instancia: x.instancia});
    return {ok: true};
  }
  if(acao === "fluxos") return {flows: [
    {id: "11111111-1111-4111-8111-111111111111", name: "Boas-vindas integrador", status: "active", folder_id: "f1"},
    {id: "22222222-2222-4222-8222-222222222222", name: "Convite para a live", status: "active", folder_id: null},
    {id: "33333333-3333-4333-8333-333333333333", name: "Rascunho", status: "draft", folder_id: "f1"}
  ], folders: [{id: "f1", name: "Quero Vender Carregador"}]};
  if(acao === "etapas") return {steps: [
    {node_id: "44444444-4444-4444-8444-444444444444", label: "Vídeo da apresentação", kind: "media", named: true},
    {node_id: "55555555-5555-4555-8555-555555555555", label: "Pergunta do investimento", kind: "text", named: true}
  ]};
  if(acao === "agendar"){
    var item = {id: "demo-" + Date.now(), numero: x.numero, contato_id: "demo", instancia: x.instancia, texto: x.texto, quando: x.quando,
      status: "pending", cancelar_se_responder: !!x.cancelar_se_responder};
    CV_DEMO.agendadas.push(item);
    return {item: item};
  }
  if(acao === "agendadas") return {itens: CV_DEMO.agendadas.filter(function(a){ return !x.numero || a.numero === x.numero; })};
  if(acao === "cancelar_agendada"){
    CV_DEMO.agendadas = CV_DEMO.agendadas.filter(function(a){ return a.id !== x.id; });
    return {item: {id: x.id, status: "cancelled"}};
  }
  return {error: "Indisponível na demonstração."};
}
