import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cobertosPelaMensagem, fimDoDia, normalizarEncaminhado } from '../supabase/functions/_shared/encaminhar.mjs';

// quinta 12/11/2026 14:35 em Brasília
const AGORA = '2026-11-12T17:35:00Z';
// os dois lembretes abertos do Danilo em 12/11/2026 e outros do mesmo lead
const lembretes = [
  { id: 3, status: 'enviado', quando: '2026-11-05T13:35:00Z' },             // mandar o mapa do Atlas (05/11)
  { id: 9, status: 'pendente', quando: '2026-11-14T13:00:00Z' },            // follow-up sexta 10h
  { id: 20, status: 'pendente', quando: '2026-11-20T13:00:00Z' },           // outra coisa, dia 20
  { id: 21, status: 'pendente', quando: '2026-11-12T22:00:00Z' },           // hoje 19h
  { id: 22, status: 'pendente', quando: null, tipo: 'tarefa' },              // tarefa sem prazo
  { id: 23, status: 'pendente', quando: '2026-11-10T12:00:00Z', repetir: { tipo: 'diario', hora: '09:00' } },
  { id: 24, status: 'feito', quando: '2026-11-10T12:00:00Z' },
  { id: 25, status: 'enviado', quando: '2026-11-11T12:00:00Z', encaminhado: { como: 'manual' } },
];

test('fim do dia em Brasília', () => {
  assert.equal(new Date(fimDoDia('2026-11-16T12:00:00Z')).toISOString(), '2026-11-17T02:59:59.000Z');
  // 23h de Brasília ainda é o mesmo dia (02h UTC do dia seguinte)
  assert.equal(new Date(fimDoDia('2026-11-17T02:00:00Z')).toISOString(), '2026-11-17T02:59:59.000Z');
});

test('mensagem agendada para segunda 16/11 cobre o que vence até lá', () => {
  assert.deepEqual(cobertosPelaMensagem(lembretes, { para: '2026-11-16T12:00:00Z', agora: AGORA }), [3, 9, 21]);
});

test('mensagem mandada agora cobre os vencidos e os de hoje', () => {
  assert.deepEqual(cobertosPelaMensagem(lembretes, { agora: AGORA }), [3, 21]);
  // agendada para o passado (relógio torto) conta como agora
  assert.deepEqual(cobertosPelaMensagem(lembretes, { para: '2026-11-01T12:00:00Z', agora: AGORA }), [3, 21]);
});

test('o lembrete de onde partiu o agendamento entra mesmo sendo depois', () => {
  assert.deepEqual(cobertosPelaMensagem(lembretes, { agora: AGORA, lembreteId: 20 }), [3, 20, 21]);
  assert.deepEqual(cobertosPelaMensagem(lembretes, { agora: AGORA, lembreteId: '20' }), [3, 20, 21]);
  // repetido nunca, nem pelo botão
  assert.deepEqual(cobertosPelaMensagem(lembretes, { agora: AGORA, lembreteId: 23 }), [3, 21]);
});

test('marcação normalizada', () => {
  const e = normalizarEncaminhado({ como: 'agendada', para: '2026-11-16T12:00:00Z', agendada_id: 'f4ea', texto: '  Fala,   Danilão! ', em: AGORA });
  assert.deepEqual(e, { como: 'agendada', em: '2026-11-12T17:35:00.000Z', para: '2026-11-16T12:00:00.000Z', agendada_id: 'f4ea', texto: 'Fala, Danilão!' });
  assert.equal(normalizarEncaminhado(null), null);
  assert.deepEqual(normalizarEncaminhado({ como: 'manual', para: '2026-11-16T12:00:00Z', agendada_id: 'x' }).para, null);
  assert.throws(() => normalizarEncaminhado({ como: 'talvez' }), /inválida/);
  assert.throws(() => normalizarEncaminhado('sim'), /inválida/);
});
