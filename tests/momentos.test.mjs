import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hms, idDrive, normalizarMomentos, segundos } from '../supabase/functions/_shared/momentos.mjs';

test('tempo: lê h:mm:ss e mm:ss, recusa o resto', () => {
  assert.equal(segundos('00:32:10'), 1930);
  assert.equal(segundos('1:02:03'), 3723);
  assert.equal(segundos('32:10'), 1930);
  assert.ok(Number.isNaN(segundos('32')));
  assert.ok(Number.isNaN(segundos('00:61:00')));
  assert.equal(hms(3723), '01:02:03');
});

test('normaliza, ordena e completa os padrões', () => {
  const { momentos, descartados } = normalizarMomentos([
    { ini: '40:00', fim: '40:20', tipo: 'pergunta', fala: '  É franquia?  ', quem: 'Raul', forca: 3 },
    { ini: '00:10:05', fim: '00:10:30', tipo: 'reacao', porque: 'Riu quando viu o preço da recarga', forca: 9, fonte: 'anotacoes' },
  ]);
  assert.equal(descartados, 0);
  assert.deepEqual(momentos.map((m) => m.ini), ['00:10:05', '00:40:00']);
  assert.equal(momentos[1].fala, 'É franquia?');
  assert.equal(momentos[0].forca, 2);
  assert.equal(momentos[0].fonte, 'anotacoes');
  assert.equal(momentos[1].fonte, 'transcricao');
  assert.equal(momentos[1].usado, null);
});

test('descarta o que não serve, sem perder o resto', () => {
  const { momentos, descartados } = normalizarMomentos([
    { ini: '00:10:00', fim: '00:09:00', tipo: 'reacao', fala: 'ao contrário' },
    { ini: '00:10:00', fim: '00:20:00', tipo: 'reacao', fala: 'longo demais' },
    { ini: '00:10:00', fim: '00:10:20', tipo: 'venda', fala: 'tipo desconhecido' },
    { ini: '00:10:00', fim: '00:10:20', tipo: 'humor' },
    { ini: '00:11:00', fim: '00:11:20', tipo: 'humor', fala: 'vale' },
  ]);
  assert.equal(descartados, 4);
  assert.equal(momentos.length, 1);
});

test('null fica null (ainda não olhou); lista vazia é "olhou e não achou"', () => {
  assert.deepEqual(normalizarMomentos(null), { momentos: null, descartados: 0 });
  assert.deepEqual(normalizarMomentos([]), { momentos: [], descartados: 0 });
  assert.throws(() => normalizarMomentos({ ini: '1:00' }));
});

test('no máximo 8 por reunião', () => {
  const lista = Array.from({ length: 10 }, (_, i) => ({ ini: `00:0${i}:00`, fim: `00:0${i}:20`, tipo: 'reacao', fala: String(i) }));
  const { momentos, descartados } = normalizarMomentos(lista);
  assert.equal(momentos.length, 8);
  assert.equal(descartados, 2);
});

test('id do Drive a partir do link ou do id', () => {
  assert.equal(idDrive('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view'), '1AbCdEfGhIjKlMnOp');
  assert.equal(idDrive('https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download'), '1AbCdEfGhIjKlMnOp');
  assert.equal(idDrive('1AbCdEfGhIjKlMnOp'), '1AbCdEfGhIjKlMnOp');
  assert.equal(idDrive('curto'), null);
  assert.equal(idDrive(null), null);
});
