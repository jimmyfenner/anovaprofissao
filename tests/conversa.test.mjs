// Contas da conversa pelo iGreen Turbo (supabase/functions/_shared/conversa.mjs).
// Rodar: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  CONV_NUMEROS, convJuntar, convResumir, convSelo, convSituacao, convListaPorConversa, convGruposDeFluxos,
  convNumeroValido, convTipoDoArquivo, convAceitaLegenda, convTipoValido, convEhUuid, convAgendadasPendentes,
  convNivelDoDb, convDbDasAmostras, convResumirNiveis, convSaiuMuda, convDuracao, convCurto, convEhInstancia,
} from "../supabase/functions/_shared/conversa.mjs";

const ARQ = fileURLToPath(new URL("../supabase/functions/_shared/conversa.mjs", import.meta.url));
const msg = (id, direction, sent_at, x = {}) => ({ id, direction, sent_at, msg_type: "text", content: id, media_url: null, delivery_status: null, author_type: null, ...x });
const AGORA = Date.parse("2026-11-17T20:00:00Z");

test("o número principal do querovender é o pessoal (7007)", () => {
  assert.equal(CONV_NUMEROS[0].instancia, "pessoal");
  assert.equal(convCurto("carregador"), "2413");
  assert.ok(convEhInstancia("pessoal") && !convEhInstancia("quero_carregador"));
});

test("convJuntar: junta os dois números sem repetir, da mais antiga para a mais nova", () => {
  const r = convJuntar({
    carregador: [msg("b", "in", "2026-11-17T10:05:00Z"), msg("a", "out", "2026-11-17T10:00:00Z")],
    pessoal: [msg("c", "out", "2026-11-17T09:00:00Z"), msg("a", "out", "2026-11-17T10:00:00Z")],
    outro: [msg("x", "in", "2026-11-17T11:00:00Z")],
  });
  assert.deepEqual(r.map((m) => m.id + "@" + m.instancia), ["c@pessoal", "a@pessoal", "b@carregador"]);
  assert.deepEqual(convJuntar(null), []);
});

test("convResumir e convSelo: nunca falou, mandou sem resposta, respondeu, mandou a última", () => {
  assert.deepEqual(convSelo(convResumir([]), AGORA), { texto: "Você ainda não mandou mensagem", tom: "nenhuma" });
  const enviou = convResumir([msg("1", "out", "2026-11-17T18:00:00Z")]);
  assert.equal(enviou.enviadas, 1);
  assert.deepEqual(convSelo(enviou, AGORA), { texto: "Você mandou há 2 h · sem resposta", tom: "aguardando" });
  assert.equal(convSituacao(enviou), "sem_resposta");
  const respondeu = convResumir([msg("1", "out", "2026-11-17T18:00:00Z"), msg("2", "in", "2026-11-17T19:30:00Z")]);
  assert.deepEqual(convSelo(respondeu, AGORA), { texto: "Respondeu há 30 min", tom: "respondeu" });
  assert.equal(convSituacao(respondeu), "esperando");
  const ultima = convResumir([msg("2", "in", "2026-11-15T19:30:00Z"), msg("1", "out", "2026-11-17T19:59:30Z")]);
  assert.deepEqual(convSelo(ultima, AGORA), { texto: "Você mandou a última há 1 min", tom: "aguardando" });
  assert.equal(convSituacao(ultima), "aguardando");
  const so = convResumir([msg("2", "in", "2026-11-14T20:00:00Z")]);
  assert.deepEqual(convSelo(so, AGORA), { texto: "Mandou mensagem há 3 d e ainda não recebeu resposta", tom: "recebeu" });
  assert.equal(convSituacao(null), "nenhuma");
});

test("convListaPorConversa: filtra pela situação e ordena pela última mensagem", () => {
  const leads = [
    { n: "5548900000001", c: "2026-11-10T00:00:00Z" },
    { n: "5548900000002", c: "2026-11-12T00:00:00Z" },
    { n: "5548900000003", c: "2026-11-11T00:00:00Z" },
  ];
  const res = {
    "5548900000001": convResumir([msg("1", "out", "2026-11-17T10:00:00Z")]),
    "5548900000002": convResumir([msg("2", "out", "2026-11-16T10:00:00Z"), msg("3", "in", "2026-11-16T11:00:00Z")]),
  };
  const n = (l) => l.n, c = (l) => l.c;
  assert.deepEqual(convListaPorConversa(leads, res, "esperando", false, n, c).map(n), ["5548900000002"]);
  assert.deepEqual(convListaPorConversa(leads, res, "", true, n, c).map(n), ["5548900000001", "5548900000002", "5548900000003"]);
  assert.equal(convListaPorConversa(leads, res, "", false, n, c), leads);
});

test("convGruposDeFluxos: pastas por nome, só ativos, sem pasta no fim", () => {
  const g = convGruposDeFluxos({
    flows: [
      { id: "1", name: "Zeta", status: "active", folder_id: null },
      { id: "2", name: "Etapa 2", status: "active", folder_id: "p1" },
      { id: "3", name: "Etapa 1", status: "active", folder_id: "p1" },
      { id: "4", name: "Rascunho", status: "draft", folder_id: "p1" },
      { id: "5", name: "Órfão", status: "active", folder_id: "sumiu" },
      { id: "6", name: "Só rascunho", status: "draft", folder_id: "p2" },
    ],
    folders: [{ id: "p2", name: "Antiga" }, { id: "p1", name: "Portabilidade" }],
  });
  assert.deepEqual(g.map((x) => [x.chave, x.fluxos.map((f) => f.name)]), [
    ["p1", ["Etapa 1", "Etapa 2"]],
    ["sem-pasta", ["Órfão", "Zeta"]],
  ]);
  assert.deepEqual(convGruposDeFluxos(null), []);
});

test("validações: número, tipo, uuid e legenda", () => {
  assert.ok(convNumeroValido("5548991067007") && convNumeroValido("554891067007"));
  assert.ok(!convNumeroValido("48991067007") && !convNumeroValido("5500991067007") && !convNumeroValido(5548991067007));
  assert.equal(convTipoDoArquivo("image/jpeg"), "image");
  assert.equal(convTipoDoArquivo("video/quicktime"), "video");
  assert.equal(convTipoDoArquivo("audio/mpeg"), "audio");
  assert.equal(convTipoDoArquivo("application/pdf"), "document");
  assert.equal(convTipoDoArquivo(""), "document");
  assert.ok(convTipoValido("ptv") && !convTipoValido("sticker"));
  assert.ok(convAceitaLegenda("video") && !convAceitaLegenda("ptv") && !convAceitaLegenda("audio"));
  assert.ok(convEhUuid("d3fb266c-54b1-41df-a572-f6e8f291412b") && !convEhUuid("x"));
});

test("convAgendadasPendentes: só as que ainda vão sair, da mais próxima para a mais longe", () => {
  const it = [
    { id: "b", status: "pending", quando: "2026-11-18T12:00:00Z" },
    { id: "a", status: "pending", quando: "2026-11-17T21:00:00Z" },
    { id: "c", status: "sent", quando: "2026-11-17T21:00:00Z" },
    { id: "d", status: "pending", quando: "2026-11-17T19:00:00Z" },   // 1 h atrás
    { id: "e", status: "processing", quando: "2026-11-17T19:55:00Z" },
  ];
  assert.deepEqual(convAgendadasPendentes(it, AGORA).map((x) => x.id), ["e", "a", "b"]);
});

test("onda: dB, nível, barras e gravação muda", () => {
  assert.equal(convNivelDoDb(-60), 0);
  assert.equal(convNivelDoDb(-10), 1);
  assert.equal(convNivelDoDb(-35), 0.5);
  assert.equal(convNivelDoDb(-Infinity), 0);
  assert.equal(convDbDasAmostras([]), -Infinity);
  assert.equal(convDbDasAmostras([0, 0]), -Infinity);
  assert.ok(Math.abs(convDbDasAmostras([0.5, -0.5]) - -6.0206) < 1e-3);
  assert.deepEqual(convResumirNiveis([0.1, 0.9, 0.2, 0.3], 2), [0.9, 0.3]);
  assert.deepEqual(convResumirNiveis([0.4], 3), [0.4, 0.4, 0.4]);
  assert.deepEqual(convResumirNiveis([], 3), []);
  assert.equal(convSaiuMuda(true, -65), true);
  assert.equal(convSaiuMuda(true, -30), false);
  assert.equal(convSaiuMuda(false, -65), null);
  assert.equal(convDuracao(75.4), "1:15");
  assert.equal(convDuracao(0), "0:00");
});

test("o arquivo roda colado no painel: ES5, sem export, sem marcador", () => {
  const fonte = readFileSync(ARQ, "utf8");
  const semExport = fonte.replace(/^export\s+/gm, "");
  assert.doesNotMatch(semExport, /\bexport\s/);
  assert.ok(!fonte.includes("@@"), "sem marcador do build dentro do arquivo");
  assert.doesNotMatch(fonte, /=>|\blet\s|\bconst\s|`/, "ES5: sem arrow, let, const ou template");
  const api = vm.runInContext('(function(){"use strict";\n' + semExport + "\nreturn {convSelo: convSelo, convResumir: convResumir};})()", vm.createContext({}));
  assert.equal(api.convSelo(api.convResumir([]), AGORA).tom, "nenhuma");
});
