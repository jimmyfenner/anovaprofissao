// Lembrete que se repete (diário de reuniões, nov/2026). Regra guardada em reunioes_lembretes.repetir:
//   { tipo: 'diario', hora: '09:00' }
//   { tipo: 'uteis', hora: '08:00' }                 segunda a sexta
//   { tipo: 'semanal', dias: [1, 4], hora: '10:00' } 0 = domingo ... 6 = sábado
//   { tipo: 'mensal', dia: 10, hora: '09:00' }       dia 31 em mês curto cai no último dia
// Horário de Brasília (sem horário de verão desde 2019). Puro: testado em tests/repeticao.test.mjs.

var OFF = 3 * 3600000;
var DIA = 86400000;
var TIPOS = ['diario', 'uteis', 'semanal', 'mensal'];

function partesBrt(ms) {
  var x = new Date(ms - OFF);
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: x.getUTCDate(), dow: x.getUTCDay(), hora: x.getUTCHours(), min: x.getUTCMinutes() };
}
function montarBrt(ano, mes, dia, hora, min) {
  return Date.UTC(ano, mes - 1, dia, hora, min) + OFF;
}
function ultimoDia(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}
function dois(n) {
  return (n < 10 ? '0' : '') + n;
}

// Confere e completa a regra. `base` (Date ou ISO) dá hora, dia da semana e dia do mês que faltarem.
export function normalizarRepeticao(regra, base) {
  if (!regra || typeof regra !== 'object') return null;
  var tipo = String(regra.tipo || '');
  if (TIPOS.indexOf(tipo) < 0) throw new Error('Repetição inválida.');
  var b = base ? partesBrt(new Date(base).getTime()) : null;
  var hora = regra.hora || (b ? dois(b.hora) + ':' + dois(b.min) : null);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora || ''))) throw new Error('Repetição sem hora válida.');
  var out = { tipo: tipo, hora: hora };
  if (tipo === 'semanal') {
    var dias = Array.isArray(regra.dias) && regra.dias.length ? regra.dias : b ? [b.dow] : [];
    dias = dias.map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    dias = dias.filter(function (d, i) { return dias.indexOf(d) === i; }).sort();
    if (!dias.length) throw new Error('Repetição semanal sem dia.');
    out.dias = dias;
  }
  if (tipo === 'mensal') {
    var dia = Number(regra.dia || (b ? b.dia : 0));
    if (!(dia >= 1 && dia <= 31)) throw new Error('Repetição mensal sem dia válido.');
    out.dia = dia;
  }
  return out;
}

// Próxima vez estritamente depois de `depois` (Date ou ISO). Devolve Date.
export function proximaOcorrencia(regra, depois) {
  var r = normalizarRepeticao(regra);
  var lim = new Date(depois).getTime();
  var hm = r.hora.split(':');
  var h = Number(hm[0]);
  var m = Number(hm[1]);
  var p = partesBrt(lim);
  var dia0 = montarBrt(p.ano, p.mes, p.dia, 12, 0);
  for (var i = 0; i < 400; i++) {
    var d = partesBrt(dia0 + i * DIA);
    var vale =
      r.tipo === 'diario' ||
      (r.tipo === 'uteis' && d.dow >= 1 && d.dow <= 5) ||
      (r.tipo === 'semanal' && r.dias.indexOf(d.dow) >= 0) ||
      (r.tipo === 'mensal' && d.dia === Math.min(r.dia, ultimoDia(d.ano, d.mes)));
    if (!vale) continue;
    var t = montarBrt(d.ano, d.mes, d.dia, h, m);
    if (t > lim) return new Date(t);
  }
  throw new Error('Sem próxima ocorrência.');
}

var NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// "todo dia 09:00", "dias úteis 08:00", "toda segunda 10:00", "seg e qui 10:00", "todo dia 10 do mês 09:00"
export function descreverRepeticao(regra) {
  if (!regra) return '';
  if (regra.tipo === 'diario') return 'todo dia ' + regra.hora;
  if (regra.tipo === 'uteis') return 'dias úteis ' + regra.hora;
  if (regra.tipo === 'mensal') return 'todo dia ' + regra.dia + ' do mês ' + regra.hora;
  var dias = (regra.dias || []).map(function (d) { return NOMES[d]; });
  if (dias.length === 1) return (regra.dias[0] === 0 || regra.dias[0] === 6 ? 'todo ' : 'toda ') + dias[0] + ' ' + regra.hora;
  return dias.slice(0, -1).join(', ') + ' e ' + dias[dias.length - 1] + ' ' + regra.hora;
}
