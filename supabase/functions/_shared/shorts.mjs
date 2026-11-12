// Pedidos de short feitos no painel /reunioes (tabela reunioes_shorts, migração 29).
// O Jimmy escolhe trechos já marcados pela rotina do diário (reunioes.momentos) e aperta "Gerar short";
// o pedido guarda uma CÓPIA de cada trecho, para que editar a reunião depois não mude o que o Mac monta.
// A rotina shorts-do-painel do Mac (studio/tools/shorts-painel) anda com o status; o painel aprova,
// pede ajuste ou descarta. Puro: testado em tests/shorts.test.mjs; a função "reunioes" e o painel usam
// as mesmas regras.

export var STATUS_SHORT = ['fila', 'montando', 'pronto', 'ajustar', 'aprovado', 'publicando', 'publicado', 'erro', 'descartado'];
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
    return {
      chave: chave, i: i, data: r.data || null, hora: r.hora || null, reuniao: texto(r.titulo, 200),
      lead_id: r.lead_id || null, lead: lead ? lead.nome : null,
      gravacao_id: r.gravacao_id, doc_id: r.doc_id || null,
      ini: m.ini, fim: m.fim, quem: m.quem || null, tipo: m.tipo, fala: m.fala || null, porque: m.porque || null,
      cuidado: m.cuidado || null, fonte: m.fonte || 'transcricao',
    };
  });
}

// quem aparece e ainda não disse "sim" (lead da reunião de cada trecho), sem repetir
export function faltaAutorizar(trechos, leads) {
  var out = [];
  (trechos || []).forEach(function (t) {
    var l = (leads || []).find(function (x) { return x.id === t.lead_id; });
    var nome = l ? String(l.nome || '').replace('[exemplo] ', '') : 'reunião de ' + ddmm(t.data) + ' (sem lead para autorizar)';
    if ((!l || l.short_ok !== 'sim') && out.indexOf(nome) < 0) out.push(nome);
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

export function normalizarDestinos(v) {
  return { youtube: Boolean(v && v.youtube), instagram: Boolean(v && v.instagram) };
}

// o que falta para aprovar (lista vazia = pode)
export function faltaParaAprovar(short, leads) {
  var f = [];
  if (!short || short.status !== 'pronto') return ['O short ainda não está pronto para revisar.'];
  var d = normalizarDestinos(short.destinos);
  var p = short.publicacao || {};
  if (!d.youtube && !d.instagram) f.push('Escolha onde publicar.');
  if (d.youtube && !p.titulo) f.push('Falta o título do YouTube.');
  if (d.instagram && !p.legenda) f.push('Falta a legenda do Reels.');
  var nomes = faltaAutorizar(short.trechos, leads);
  if (nomes.length) f.push('Falta o ok para aparecer: ' + nomes.join(', ') + '.');
  return f;
}

// passos que o Mac pode dar (de → para); o painel tem os dele na função
var MAC = {
  montando: ['fila', 'ajustar', 'montando'],
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
