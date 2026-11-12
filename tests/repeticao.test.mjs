import assert from 'node:assert/strict';
import { test } from 'node:test';
import { descreverRepeticao, normalizarRepeticao, proximaOcorrencia } from '../supabase/functions/_shared/repeticao.mjs';

// quarta 11/11/2026 15:00 em Brasília
const QUA = new Date('2026-11-11T18:00:00Z');
const iso = (d) => d.toISOString();

test('todo dia: hoje se ainda não passou, senão amanhã', () => {
  assert.equal(iso(proximaOcorrencia({ tipo: 'diario', hora: '16:00' }, QUA)), '2026-11-11T19:00:00.000Z');
  assert.equal(iso(proximaOcorrencia({ tipo: 'diario', hora: '09:00' }, QUA)), '2026-11-12T12:00:00.000Z');
  // exatamente no horário não conta: é a vez que acabou de sair
  assert.equal(iso(proximaOcorrencia({ tipo: 'diario', hora: '15:00' }, QUA)), '2026-11-12T18:00:00.000Z');
});

test('dias úteis pulam o fim de semana', () => {
  const sex = new Date('2026-11-13T20:00:00Z'); // sexta 17:00
  assert.equal(iso(proximaOcorrencia({ tipo: 'uteis', hora: '08:00' }, sex)), '2026-11-16T11:00:00.000Z'); // segunda
});

test('semanal com um ou mais dias', () => {
  assert.equal(iso(proximaOcorrencia({ tipo: 'semanal', dias: [1], hora: '10:00' }, QUA)), '2026-11-16T13:00:00.000Z');
  assert.equal(iso(proximaOcorrencia({ tipo: 'semanal', dias: [1, 4], hora: '10:00' }, QUA)), '2026-11-12T13:00:00.000Z');
  assert.equal(iso(proximaOcorrencia({ tipo: 'semanal', dias: [3], hora: '18:00' }, QUA)), '2026-11-11T21:00:00.000Z');
});

test('mensal, com dia 31 caindo no último dia do mês curto', () => {
  assert.equal(iso(proximaOcorrencia({ tipo: 'mensal', dia: 10, hora: '09:00' }, QUA)), '2026-12-10T12:00:00.000Z');
  assert.equal(iso(proximaOcorrencia({ tipo: 'mensal', dia: 31, hora: '09:00' }, QUA)), '2026-11-30T12:00:00.000Z');
  assert.equal(iso(proximaOcorrencia({ tipo: 'mensal', dia: 30, hora: '09:00' }, new Date('2027-02-01T12:00:00Z'))), '2027-02-28T12:00:00.000Z');
});

test('normalizar completa pela data base e recusa o inválido', () => {
  assert.deepEqual(normalizarRepeticao({ tipo: 'semanal' }, '2026-11-16T13:00:00Z'), { tipo: 'semanal', hora: '10:00', dias: [1] });
  assert.deepEqual(normalizarRepeticao({ tipo: 'mensal' }, '2026-11-16T13:00:00Z'), { tipo: 'mensal', hora: '10:00', dia: 16 });
  assert.deepEqual(normalizarRepeticao({ tipo: 'semanal', dias: [4, 1, 1], hora: '07:30' }), { tipo: 'semanal', hora: '07:30', dias: [1, 4] });
  assert.equal(normalizarRepeticao(null), null);
  assert.throws(() => normalizarRepeticao({ tipo: 'anual', hora: '09:00' }));
  assert.throws(() => normalizarRepeticao({ tipo: 'diario', hora: '25:00' }));
  assert.throws(() => normalizarRepeticao({ tipo: 'semanal', dias: [9], hora: '09:00' }));
});

test('descrição curta', () => {
  assert.equal(descreverRepeticao({ tipo: 'diario', hora: '09:00' }), 'todo dia 09:00');
  assert.equal(descreverRepeticao({ tipo: 'uteis', hora: '08:00' }), 'dias úteis 08:00');
  assert.equal(descreverRepeticao({ tipo: 'semanal', dias: [1], hora: '10:00' }), 'toda segunda 10:00');
  assert.equal(descreverRepeticao({ tipo: 'semanal', dias: [6], hora: '10:00' }), 'todo sábado 10:00');
  assert.equal(descreverRepeticao({ tipo: 'semanal', dias: [1, 3, 5], hora: '10:00' }), 'segunda, quarta e sexta 10:00');
  assert.equal(descreverRepeticao({ tipo: 'mensal', dia: 10, hora: '09:00' }), 'todo dia 10 do mês 09:00');
});
