// Lembrete "encaminhado" (migração 30, reunioes_lembretes.encaminhado): o Jimmy já agiu (agendou mensagem no
// Turbo, mandou mensagem pelo painel ou marcou "Já encaminhei") e o lembrete sai da fila do que fazer, para a
// seção "Encaminhados" do painel; o assistente do Mac não manda mais e a agenda das 06:30 não repete.
// Pedido de 12/11/2026: "agendei mensagem para o Danilo e ele continua no topo dos lembretes".
// Puro: testado em tests/encaminhar.test.mjs (o painel /reunioes repete a mesma conta para o Turbo).

var COMO = ['agendada', 'enviada', 'manual'];

// 23:59:59 do dia (em Brasília, UTC−3) de uma data
export function fimDoDia(d) {
  var t = new Date(d).getTime() - 3 * 3600e3;
  var p = new Date(t);
  return Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate(), 23, 59, 59) + 3 * 3600e3;
}

// Que lembretes abertos de UM lead a mensagem cobre: os que vencem até o fim do dia da mensagem (agendada:
// o dia em que ela sai; mandada agora: hoje), mais o lembrete de onde o Jimmy partiu (botão "Agendar msg").
// Fora: os que se repetem, as tarefas sem prazo e os que já estão encaminhados.
export function cobertosPelaMensagem(lembretes, opts) {
  opts = opts || {};
  var agora = opts.agora ? new Date(opts.agora) : new Date();
  var para = opts.para ? new Date(opts.para) : null;
  var limite = fimDoDia(para && para.getTime() > agora.getTime() ? para : agora);
  return (lembretes || []).filter(function (l) {
    if (l.status !== 'pendente' && l.status !== 'enviado') return false;
    if (l.repetir || l.encaminhado) return false;
    if (opts.lembreteId != null && Number(l.id) === Number(opts.lembreteId)) return true;
    return Boolean(l.quando) && Date.parse(l.quando) <= limite;
  }).map(function (l) { return l.id; });
}

export function normalizarEncaminhado(v) {
  if (v == null) return null;
  if (typeof v !== 'object' || COMO.indexOf(v.como) < 0) throw new Error('Marcação de encaminhado inválida.');
  var data = function (x) { var d = x ? new Date(x) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
  var t = v.texto == null ? '' : String(v.texto).replace(/\s+/g, ' ').trim();
  return {
    como: v.como,
    em: data(v.em) || new Date().toISOString(),
    para: v.como === 'agendada' ? data(v.para) : null,
    agendada_id: v.como === 'agendada' && v.agendada_id ? String(v.agendada_id).slice(0, 80) : null,
    texto: t ? t.slice(0, 160) : null,
  };
}
