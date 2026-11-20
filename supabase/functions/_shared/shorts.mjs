// Pedidos de short feitos no painel /reunioes (tabela reunioes_shorts, migração 29). Sem esperar autorização
// de quem aparece (só quem recusou fica de fora: ver `recusaram`).
// O Jimmy escolhe trechos já marcados pela rotina do diário (reunioes.momentos) e aperta "Gerar short";
// o pedido guarda uma CÓPIA de cada trecho, para que editar a reunião depois não mude o que o Mac monta.
// A rotina shorts-do-painel do Mac (studio/tools/shorts-painel) anda com o status; o painel aprova,
// pede ajuste ou descarta. Puro: testado em tests/shorts.test.mjs; a função "reunioes" e o painel usam
// as mesmas regras.

export var STATUS_SHORT = ['fila', 'montando', 'orcamento', 'pronto', 'ajustar', 'aprovado', 'publicando', 'publicado', 'erro', 'descartado'];
export var MAX_TRECHOS = 12;
var LINHAS_TITULO = 3;
var LETRAS_LINHA = 40;

function texto(v, max) {
  if (v == null) return null;
  var t = String(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}
function ddmm(data) {
  var p = String(data || '').slice(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : 'sem data';
}

// [{chave, i, ini}] do painel + reuniões e leads do banco → cópia dos trechos. Erra com o motivo em português.
export function montarTrechos(itens, reunioes, leads) {
  if (!Array.isArray(itens) || !itens.length) throw new Error('Escolha pelo menos um trecho.');
  if (itens.length > MAX_TRECHOS) throw new Error('No máximo ' + MAX_TRECHOS + ' trechos por short.');
  var vistos = {};
  return itens.map(function (it) {
    var chave = String((it && it.chave) || '');
    var i = Number(it && it.i);
    if (!Number.isInteger(i) || i < 0) throw new Error('Trecho inválido.');
    if (vistos[chave + '#' + i]) throw new Error('O mesmo trecho entrou duas vezes.');
    vistos[chave + '#' + i] = true;
    var r = (reunioes || []).find(function (x) { return x.chave === chave; });
    if (!r) throw new Error('Uma das reuniões não existe mais. Atualize a página.');
    var m = Array.isArray(r.momentos) ? r.momentos[i] : null;
    if (!m || (it.ini !== undefined && m.ini !== it.ini)) throw new Error('Os trechos da reunião de ' + ddmm(r.data) + ' mudaram. Atualize a página.');
    if (!r.gravacao_id) throw new Error('A reunião de ' + ddmm(r.data) + ' está sem a gravação do Meet ligada: sem ela o Mac não monta o vídeo.');
    var lead = (leads || []).find(function (l) { return l.id === r.lead_id; });
    if (lead && lead.short_ok === 'nao') throw new Error(String(lead.nome || '').replace('[exemplo] ', '') + ' recusou aparecer em short: tire o trecho.');
    return {
      chave: chave, i: i, data: r.data || null, hora: r.hora || null, reuniao: texto(r.titulo, 200),
      lead_id: r.lead_id || null, lead: lead ? lead.nome : null,
      gravacao_id: r.gravacao_id, doc_id: r.doc_id || null,
      ini: m.ini, fim: m.fim, quem: m.quem || null, tipo: m.tipo, fala: m.fala || null, porque: m.porque || null,
      cuidado: m.cuidado || null, fonte: m.fonte || 'transcricao',
    };
  });
}

// Autorização (14/11/2026, ordem do Jimmy: "remova a necessidade de aprovação expressa das reuniões para os
// shorts, produza-os sempre"): o short sai sem esperar o "sim" de quem aparece. Só fica de fora quem RECUSOU
// (short_ok = 'nao'): esta lista diz quem, sem repetir.
export function recusaram(trechos, leads) {
  var out = [];
  (trechos || []).forEach(function (t) {
    var l = (leads || []).find(function (x) { return x.id === t.lead_id; });
    var nome = l ? String(l.nome || '').replace('[exemplo] ', '') : '';
    if (l && l.short_ok === 'nao' && out.indexOf(nome) < 0) out.push(nome);
  });
  return out;
}

// título de abertura: até 3 linhas curtas (separadas por quebra de linha ou " / "); vazio = o Mac escolhe
export function normalizarTitulo(v) {
  if (v == null) return null;
  var linhas = String(v).split(/\n|\s\/\s/).map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  if (!linhas.length) return null;
  if (linhas.length > LINHAS_TITULO) throw new Error('O título de abertura tem no máximo ' + LINHAS_TITULO + ' linhas.');
  if (linhas.some(function (l) { return l.length > LETRAS_LINHA; })) throw new Error('Cada linha do título cabe até ' + LETRAS_LINHA + ' letras.');
  return linhas.join('\n');
}

// texto da publicação: título do YouTube (até 100), descrição (até 4500), legenda do Reels (até 2100)
export function normalizarPublicacao(v) {
  v = v || {};
  var lim = { titulo: 100, descricao: 4500, legenda: 2100 };
  var out = {};
  Object.keys(lim).forEach(function (k) {
    var s = v[k] == null ? '' : String(v[k]).replace(/\r/g, '').trim();
    if (k === 'titulo') s = s.replace(/\s+/g, ' ');
    if (s.length > lim[k]) throw new Error({ titulo: 'O título do YouTube', descricao: 'A descrição', legenda: 'A legenda do Reels' }[k] + ' passa de ' + lim[k] + ' letras.');
    out[k] = s || null;
  });
  return out;
}

// youtube = Shorts do @jimmyfenner · instagram = Reels do @minerandoosol · stories = Stories do @minerandoosol
export function normalizarDestinos(v) {
  return { youtube: Boolean(v && v.youtube), instagram: Boolean(v && v.instagram), stories: Boolean(v && v.stories) };
}
export var DESTINOS_PADRAO = { youtube: true, instagram: true, stories: false };

// Orçamento de geração paga (19/11/2026, migração 32): num ajuste ou no recado o Jimmy pode pedir coisa que
// precisa ser gerada (imagem/vídeo na Higgsfield; música, efeito ou voz na ElevenLabs). O Mac nunca gera sem
// o ok dele: propõe o orçamento (status "orcamento") e o painel aprova ("Gerar") ou recusa ("Fazer sem gerar").
// Créditos de cada plataforma são moedas diferentes: os totais ficam separados; usd é só uma referência.
export var PLATAFORMAS_GASTO = ['higgsfield', 'elevenlabs'];
var MAX_CREDITOS = 1000000;
function numero(v, max) {
  var n = Number(v);
  return isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
}
export function normalizarOrcamento(v) {
  if (!v || typeof v !== 'object') throw new Error('Orçamento inválido.');
  var itens = Array.isArray(v.itens) ? v.itens : [];
  if (!itens.length || itens.length > 10) throw new Error('O orçamento precisa ter de 1 a 10 itens.');
  var tot = { higgsfield: 0, elevenlabs: 0 };
  var usd = 0, temUsd = true;
  var lista = itens.map(function (it) {
    it = it || {};
    var p = String(it.plataforma || '').toLowerCase().trim();
    if (PLATAFORMAS_GASTO.indexOf(p) < 0) throw new Error('Plataforma fora do orçamento: ' + (p || 'vazia') + '.');
    var o = texto(it.o_que, 200);
    if (!o) throw new Error('Diga o que cada item do orçamento gera.');
    var c = numero(it.creditos, MAX_CREDITOS);
    if (!c) throw new Error('Créditos inválidos em "' + o + '".');
    var u = numero(it.usd, 1000);
    if (u == null) temUsd = false; else usd += u;
    tot[p] = Math.round((tot[p] + c) * 100) / 100;
    return { plataforma: p, o_que: o, modelo: texto(it.modelo, 80), creditos: c, usd: u };
  });
  var saldo = {};
  PLATAFORMAS_GASTO.forEach(function (p) {
    var n = v.saldo ? numero(v.saldo[p], 100 * MAX_CREDITOS) : null;
    if (n != null) saldo[p] = n;
  });
  return {
    itens: lista,
    higgsfield: tot.higgsfield,
    elevenlabs: tot.elevenlabs,
    usd: temUsd ? Math.round(usd * 100) / 100 : null,
    saldo: saldo,
    nota: texto(v.nota, 400),
    decisao: null,
    decidido_em: null,
    gasto: null,
  };
}
// o que o Mac gastou de fato (créditos por plataforma), gravado junto da prévia
export function normalizarGasto(v) {
  if (!v || typeof v !== 'object') return null;
  var out = {}, algum = false;
  PLATAFORMAS_GASTO.forEach(function (p) {
    var n = numero(v[p], MAX_CREDITOS);
    out[p] = n || 0;
    if (n) algum = true;
  });
  return algum ? out : null;
}
// soma o que já foi gasto em orçamentos anteriores do mesmo pedido (para o painel mostrar o total)
export function somarGasto(orc) {
  var out = { higgsfield: 0, elevenlabs: 0 };
  if (!orc) return out;
  [orc.gasto, orc.gasto_antes].forEach(function (g) {
    PLATAFORMAS_GASTO.forEach(function (p) { out[p] = Math.round((out[p] + (g && Number(g[p]) || 0)) * 100) / 100; });
  });
  return out;
}
// para onde o pedido volta depois que o Jimmy decide o orçamento: o ajuste (se houver) ou a fila
export function voltaDoOrcamento(short) {
  return short && short.ajuste ? 'ajustar' : 'fila';
}

// Pedidos automáticos (17/11/2026, ordem do Jimmy: "gere todos os shorts, os que eu não gostar eu removo;
// melhor do que colocar na fila, coisa que eu vou esquecer"). Um short por reunião que tem gravação e
// trechos marcados e que nunca entrou em pedido nenhum (nem descartado: descartar é a resposta dele).
// Escolhe os trechos mais fortes até ~105 s brutos (uns 85 s depois de tirar as pausas); o mais forte abre
// e o resto segue a ordem da conversa. Devolve [{itens, chave}] no formato que montarTrechos aceita.
export var SEGUNDOS_AUTO = 105;
export function pedidosAutomaticos(reunioes, leads, shorts) {
  var usadas = {};
  (shorts || []).forEach(function (s) { (s.trechos || []).forEach(function (t) { usadas[t.chave] = true; }); });
  var out = [];
  (reunioes || []).forEach(function (r) {
    if (!r || !r.gravacao_id || usadas[r.chave] || !Array.isArray(r.momentos) || !r.momentos.length) return;
    var lead = (leads || []).find(function (l) { return l.id === r.lead_id; });
    if (lead && lead.short_ok === 'nao') return;
    var cand = r.momentos.map(function (m, i) { return { m: m, i: i }; }).filter(function (x) {
      return x.m && !x.m.usado && seg(x.m.fim) > seg(x.m.ini);
    });
    if (!cand.length) return;
    cand.sort(function (a, b) { return (b.m.forca || 2) - (a.m.forca || 2) || seg(a.m.ini) - seg(b.m.ini); });
    var escolha = [], total = 0;
    cand.forEach(function (x) {
      var d = seg(x.m.fim) - seg(x.m.ini);
      if (escolha.length >= MAX_TRECHOS || (escolha.length && total + d > SEGUNDOS_AUTO)) return;
      escolha.push(x);
      total += d;
    });
    var abre = escolha[0];
    var resto = escolha.slice(1).sort(function (a, b) { return seg(a.m.ini) - seg(b.m.ini); });
    out.push({ chave: r.chave, itens: [abre].concat(resto).map(function (x) { return { chave: r.chave, i: x.i, ini: x.m.ini }; }) });
  });
  return out;
}

// o que falta para aprovar (lista vazia = pode)
export function faltaParaAprovar(short, leads) {
  var f = [];
  if (!short || short.status !== 'pronto') return ['O short ainda não está pronto para revisar.'];
  var d = normalizarDestinos(short.destinos);
  var p = short.publicacao || {};
  if (!d.youtube && !d.instagram && !d.stories) f.push('Escolha onde publicar.');
  if (d.youtube && !p.titulo) f.push('Falta o título do YouTube.');
  if (d.instagram && !p.legenda) f.push('Falta a legenda do Reels.');
  var nomes = recusaram(short.trechos, leads);
  if (nomes.length) f.push('Recusou aparecer em short: ' + nomes.join(', ') + '. Peça ajuste tirando o trecho.');
  return f;
}

// passos que o Mac pode dar (de → para); o painel tem os dele na função
var MAC = {
  montando: ['fila', 'ajustar', 'montando'],
  orcamento: ['montando'],
  pronto: ['montando'],
  publicando: ['aprovado', 'publicando'],
  publicado: ['publicando'],
  erro: ['montando', 'publicando'],
};
export function macPode(de, para) {
  return Boolean(MAC[para] && MAC[para].indexOf(de) >= 0);
}

// segundos somados dos trechos (antes de tirar as pausas: o vídeo sai uns 20% menor)
export function segundosDosTrechos(trechos) {
  return (trechos || []).reduce(function (s, t) {
    var a = seg(t.ini), b = seg(t.fim);
    return s + (b > a ? b - a : 0);
  }, 0);
}
function seg(v) {
  var m = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/.exec(String(v || '').trim());
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// rótulo que marca o trecho como usado depois de publicado, ex. "painel 12/11"
export function rotuloUsado(short) {
  return 'painel ' + ddmm(String(short && short.criado_em || '').slice(0, 10));
}

// marca como usados, nos momentos de UMA reunião, os trechos publicados dela (acha pelo início e pelo tipo,
// porque a posição na lista pode ter mudado). Devolve a lista nova e quantos marcou.
export function marcarUsados(momentos, trechos, rotulo) {
  var lista = (momentos || []).map(function (m) { return Object.assign({}, m); });
  var n = 0;
  (trechos || []).forEach(function (t) {
    var m = lista.find(function (x) { return x.ini === t.ini && x.tipo === t.tipo && !x.usado; });
    if (m) {
      m.usado = rotulo;
      n++;
    }
  });
  return { momentos: lista, marcados: n };
}
