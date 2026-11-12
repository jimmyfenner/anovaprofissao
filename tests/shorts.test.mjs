import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  faltaAutorizar, faltaParaAprovar, macPode, marcarUsados, montarTrechos, normalizarDestinos,
  normalizarPublicacao, normalizarTitulo, rotuloUsado, segundosDosTrechos,
} from '../supabase/functions/_shared/shorts.mjs';

const momentos = [
  { ini: '00:12:40', fim: '00:13:05', quem: 'Carla', tipo: 'reacao', fala: 'Café?', porque: 'p', cuidado: null, forca: 3, fonte: 'transcricao', usado: null },
  { ini: '00:21:10', fim: '00:21:48', quem: 'Carla e Jimmy', tipo: 'pergunta', fala: 'Franquia?', porque: 'q', cuidado: 'Slide com valores', forca: 2, fonte: 'transcricao', usado: null },
];
const reunioes = [
  { chave: 'doc:a', lead_id: 'L1', data: '2026-11-12', hora: '10:02', titulo: 'Reunião com Carla', gravacao_id: 'GRAV12345678', doc_id: 'DOC1', momentos },
  { chave: 'doc:b', lead_id: 'L2', data: '2026-11-10', titulo: 'Sem gravação', gravacao_id: null, momentos },
  { chave: 'doc:c', lead_id: null, data: '2026-11-09', titulo: 'Parceiro', gravacao_id: 'GRAV87654321', momentos },
];
const leads = [{ id: 'L1', nome: '[exemplo] Carla Menezes', short_ok: 'sim' }, { id: 'L2', nome: 'Rogério', short_ok: 'pedido' }];

test('cópia dos trechos guarda o que o Mac precisa', () => {
  const t = montarTrechos([{ chave: 'doc:a', i: 1, ini: '00:21:10' }], reunioes, leads);
  assert.equal(t.length, 1);
  assert.equal(t[0].gravacao_id, 'GRAV12345678');
  assert.equal(t[0].lead, '[exemplo] Carla Menezes');
  assert.equal(t[0].cuidado, 'Slide com valores');
  assert.equal(t[0].fim, '00:21:48');
});

test('recusa trecho repetido, lista mudada, reunião sem gravação e pedido vazio', () => {
  assert.throws(() => montarTrechos([], reunioes, leads), /pelo menos um/);
  assert.throws(() => montarTrechos([{ chave: 'doc:a', i: 0 }, { chave: 'doc:a', i: 0 }], reunioes, leads), /duas vezes/);
  assert.throws(() => montarTrechos([{ chave: 'doc:a', i: 0, ini: '00:99:00' }], reunioes, leads), /mudaram/);
  assert.throws(() => montarTrechos([{ chave: 'doc:a', i: 5 }], reunioes, leads), /mudaram/);
  assert.throws(() => montarTrechos([{ chave: 'doc:b', i: 0 }], reunioes, leads), /sem a gravação/);
  assert.throws(() => montarTrechos([{ chave: 'doc:z', i: 0 }], reunioes, leads), /não existe/);
  assert.throws(() => montarTrechos(Array.from({ length: 13 }, (_, i) => ({ chave: 'doc:a', i })), reunioes, leads), /No máximo 12/);
});

test('quem falta autorizar: lead sem "sim" e reunião sem lead, sem repetir', () => {
  const t = [
    ...montarTrechos([{ chave: 'doc:a', i: 0 }, { chave: 'doc:a', i: 1 }], reunioes, leads),
    ...montarTrechos([{ chave: 'doc:c', i: 0 }], reunioes, leads),
  ];
  assert.deepEqual(faltaAutorizar(t, leads), ['reunião de 09/11 (sem lead para autorizar)']);
  const t2 = [{ lead_id: 'L2', data: '2026-11-10' }, { lead_id: 'L2', data: '2026-11-10' }];
  assert.deepEqual(faltaAutorizar(t2, leads), ['Rogério']);
});

test('título de abertura: até 3 linhas de 40 letras', () => {
  assert.equal(normalizarTitulo(' Reuniões reais / com quem quer / ter um eletroposto '), 'Reuniões reais\ncom quem quer\nter um eletroposto');
  assert.equal(normalizarTitulo('  '), null);
  assert.equal(normalizarTitulo(null), null);
  assert.throws(() => normalizarTitulo('a\nb\nc\nd'), /3 linhas/);
  assert.throws(() => normalizarTitulo('x'.repeat(41)), /40 letras/);
});

test('texto da publicação e destinos', () => {
  const p = normalizarPublicacao({ titulo: '  É franquia?   Reuniões reais ', descricao: 'linha 1\r\nlinha 2', legenda: '' });
  assert.equal(p.titulo, 'É franquia? Reuniões reais');
  assert.equal(p.descricao, 'linha 1\nlinha 2');
  assert.equal(p.legenda, null);
  assert.throws(() => normalizarPublicacao({ titulo: 'x'.repeat(101) }), /título do YouTube/);
  assert.deepEqual(normalizarDestinos({ youtube: 1 }), { youtube: true, instagram: false });
});

test('para aprovar: pronto, destino, textos e ok de todos', () => {
  const trechos = montarTrechos([{ chave: 'doc:a', i: 0 }], reunioes, leads);
  const base = { status: 'pronto', trechos, destinos: { youtube: true, instagram: true }, publicacao: { titulo: 'T', legenda: 'L' } };
  assert.deepEqual(faltaParaAprovar(base, leads), []);
  assert.match(faltaParaAprovar({ ...base, status: 'montando' }, leads)[0], /não está pronto/);
  assert.deepEqual(faltaParaAprovar({ ...base, destinos: {} }, leads), ['Escolha onde publicar.']);
  assert.deepEqual(faltaParaAprovar({ ...base, publicacao: { titulo: 'T' } }, leads), ['Falta a legenda do Reels.']);
  const semOk = leads.map((l) => ({ ...l, short_ok: l.id === 'L1' ? 'pedido' : l.short_ok }));
  assert.deepEqual(faltaParaAprovar(base, semOk), ['Falta o ok para aparecer: Carla Menezes.']);
});

test('passos do Mac', () => {
  assert.ok(macPode('fila', 'montando'));
  assert.ok(macPode('ajustar', 'montando'));
  assert.ok(macPode('montando', 'pronto'));
  assert.ok(macPode('aprovado', 'publicando'));
  assert.ok(macPode('publicando', 'publicado'));
  assert.ok(macPode('montando', 'erro'));
  assert.ok(!macPode('fila', 'pronto'));
  assert.ok(!macPode('pronto', 'publicando'));
  assert.ok(!macPode('descartado', 'montando'));
  assert.ok(!macPode('pronto', 'aprovado'));
});

test('duração somada e trechos usados depois de publicar', () => {
  assert.equal(segundosDosTrechos(momentos), 25 + 38);
  assert.equal(rotuloUsado({ criado_em: '2026-11-12T13:00:00Z' }), 'painel 12/11');
  const mudada = [momentos[1], momentos[0]];
  const r = marcarUsados(mudada, [{ ini: '00:12:40', tipo: 'reacao' }], 'painel 12/11');
  assert.equal(r.marcados, 1);
  assert.equal(r.momentos[1].usado, 'painel 12/11');
  assert.equal(r.momentos[0].usado, null);
  assert.equal(mudada[1].usado, null, 'não mexe na lista original');
});
