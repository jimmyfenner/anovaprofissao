// Momentos para short (diário de reuniões, nov/2026). Guardados em reunioes.momentos (jsonb):
//   null  a rotina ainda não olhou esta reunião
//   []    olhou e não achou trecho que sirva
//   [{ ini: '00:32:10', fim: '00:32:45', quem: 'Danilo', tipo: 'reacao', fala: '…', porque: '…',
//      cuidado: null, forca: 3, fonte: 'transcricao', usado: null }]
// ini/fim seguem o relógio da gravação: as marcas da transcrição do Gemini batem com o vídeo (±2 s);
// entre uma marca e outra o tempo é estimado, e a edição acerta no áudio. `usado` = em qual short
// o trecho já entrou (ex.: "027"). Puro: testado em tests/momentos.test.mjs; o painel e o Mac usam
// os mesmos nomes de tipo.

export var TIPOS_MOMENTO = {
  reacao: 'reação',
  pergunta: 'pergunta e resposta',
  objecao: 'objeção respondida',
  depoimento: 'depoimento',
  explicacao: 'explicação curta',
  humor: 'descontração',
};
var MAXIMO = 8;
var DURACAO_MAXIMA = 300;

// "1:02:03", "01:02:03", "02:03" → segundos; o resto → NaN
export function segundos(v) {
  var m = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/.exec(String(v == null ? '' : v).trim());
  if (!m) return NaN;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
export function hms(s) {
  var d = function (n) { return (n < 10 ? '0' : '') + n; };
  return d(Math.floor(s / 3600)) + ':' + d(Math.floor((s % 3600) / 60)) + ':' + d(s % 60);
}
function texto(v, max) {
  if (v == null) return null;
  var t = String(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

// Confere a lista. O que não serve (sem tempo, tempo ao contrário, tipo desconhecido, sem fala nem
// motivo, acima de 8) sai e conta em `descartados`; quem chama decide se isso é erro.
export function normalizarMomentos(lista) {
  if (lista === null || lista === undefined) return { momentos: null, descartados: 0 };
  if (!Array.isArray(lista)) throw new Error('Momentos precisam vir numa lista.');
  var out = [];
  var descartados = 0;
  for (var i = 0; i < lista.length; i++) {
    var m = lista[i] || {};
    var ini = segundos(m.ini);
    var fim = segundos(m.fim);
    var tipo = String(m.tipo || '');
    var fala = texto(m.fala, 400);
    var porque = texto(m.porque, 300);
    var ok = ini >= 0 && fim > ini && fim - ini <= DURACAO_MAXIMA && Object.prototype.hasOwnProperty.call(TIPOS_MOMENTO, tipo) && (fala || porque);
    if (!ok || out.length >= MAXIMO) {
      descartados++;
      continue;
    }
    var forca = Number(m.forca);
    out.push({
      ini: hms(ini),
      fim: hms(fim),
      quem: texto(m.quem, 80),
      tipo: tipo,
      fala: fala,
      porque: porque,
      cuidado: texto(m.cuidado, 300),
      forca: forca === 1 || forca === 2 || forca === 3 ? forca : 2,
      fonte: m.fonte === 'anotacoes' ? 'anotacoes' : 'transcricao',
      usado: texto(m.usado, 80),
    });
  }
  out.sort(function (a, b) { return a.ini.localeCompare(b.ini); });
  return { momentos: out, descartados: descartados };
}

// id de arquivo do Drive (gravação); qualquer outra coisa vira null
export function idDrive(v) {
  var s = String(v == null ? '' : v).trim();
  var m = /\/d\/([A-Za-z0-9_-]{10,200})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,200})/.exec(s);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : null;
}
