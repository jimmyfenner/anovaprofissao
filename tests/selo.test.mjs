// Selo "mensagem agendada" na lista de leads (painel/selo.mjs).
// Rodar: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { selosMensagem, seloDoNumero, quandoSelo, dataCompletaSelo } from "../painel/selo.mjs";

const ARQ = fileURLToPath(new URL("../painel/selo.mjs", import.meta.url));
// horário de Brasília (UTC-3); 03/11/2026 é uma terça-feira
const BRT = (dia, hhmm) => new Date(`2026-11-${dia}T${hhmm}:00-03:00`);
const AGORA = BRT("03", "15:00");
const NUM = "5548991067007";

const disparo = (x = {}) => ({ id: "d1", status: "ativo", inicio: BRT("03", "10:00").toISOString(), total: 20, motivo: null, ...x });
const envio = (x = {}) => ({ disparo_id: "d1", numero: NUM, status: "pendente", agendado_para: null, ordem: 1, ...x });
const umSelo = (e, d, agora = AGORA) => selosMensagem([envio(e)], [disparo(d)], agora)[NUM];

test("quandoSelo: hoje, amanhã e dd/mm no fuso de Brasília", () => {
  assert.equal(quandoSelo(BRT("03", "18:00"), AGORA), "hoje 18:00");
  assert.equal(quandoSelo(BRT("04", "09:30"), AGORA), "amanhã 09:30");
  assert.equal(quandoSelo(BRT("05", "14:00"), AGORA), "05/11 14:00");
  assert.equal(quandoSelo(BRT("12", "08:05"), AGORA), "12/11 08:05");
  // 22:00 em Brasília já é dia 4 em UTC: o "hoje" segue Brasília
  const noite = BRT("03", "22:00");
  assert.equal(quandoSelo(BRT("03", "23:30"), noite), "hoje 23:30");
  assert.equal(quandoSelo(BRT("04", "00:10"), noite), "amanhã 00:10");
  assert.equal(quandoSelo("2026-11-04T02:30:00Z", noite), "hoje 23:30");   // ISO em UTC
  assert.equal(quandoSelo(Date.parse("2026-11-04T12:30:00Z"), noite), "amanhã 09:30");
  // virada de mês
  assert.equal(quandoSelo(new Date("2026-12-01T09:00:00-03:00"), new Date("2026-11-30T20:00:00-03:00")), "amanhã 09:00");
  assert.equal(quandoSelo(null, AGORA), "");
  assert.equal(quandoSelo("lixo", AGORA), "");
});

test("dataCompletaSelo: dia da semana, data e hora de Brasília", () => {
  assert.equal(dataCompletaSelo(BRT("05", "14:00")), "quinta-feira, 05/11 às 14:00");
  assert.equal(dataCompletaSelo(BRT("03", "18:00")), "terça-feira, 03/11 às 18:00");
  assert.equal(dataCompletaSelo("2026-11-04T02:30:00Z"), "terça-feira, 03/11 às 23:30");
  assert.equal(dataCompletaSelo("2026-11-08T12:00:00Z"), "domingo, 08/11 às 09:00");
  assert.equal(dataCompletaSelo(""), "");
});

test("enviando: 'Enviando agora', mesmo com o disparo pausado", () => {
  for (const status of ["ativo", "pausado"]) {
    const s = umSelo({ status: "enviando" }, { status });
    assert.equal(s.tipo, "enviando");
    assert.equal(s.curto, "Enviando");
    assert.equal(s.texto, "Enviando agora");
    assert.equal(s.titulo, "Enviando agora (disparo para 20 pessoas)");
  }
});

test("disparo pausado: 'Envio pausado' com o motivo, mesmo com hora marcada", () => {
  const s = umSelo({ agendado_para: BRT("03", "18:00").toISOString() },
    { status: "pausado", motivo: "A instância jimmy não respondeu: Connection Closed." });
  assert.equal(s.tipo, "pausado");
  assert.equal(s.curto, "Pausada");
  assert.equal(s.texto, "Envio pausado");
  assert.equal(s.titulo, "Envio pausado (disparo para 20 pessoas). Motivo: A instância jimmy não respondeu: Connection Closed");
  assert.equal(umSelo({}, { status: "pausado" }).titulo, "Envio pausado (disparo para 20 pessoas)");
});

test("hora marcada no futuro: 'Mensagem agendada · <quando>'", () => {
  const s = umSelo({ agendado_para: "2026-11-03T21:00:00+00:00" });
  assert.equal(s.tipo, "agendada");
  assert.equal(s.curto, "Agendada hoje 18:00");
  assert.equal(s.texto, "Mensagem agendada · hoje 18:00");
  assert.equal(s.titulo, "Mensagem agendada · hoje 18:00 (terça-feira, 03/11 às 18:00, disparo para 20 pessoas)");
  assert.equal(s.quando, Date.parse("2026-11-03T21:00:00Z"));
  assert.equal(s.disparo_id, "d1");
  // Postgres devolve microssegundos
  assert.equal(umSelo({ agendado_para: "2026-11-05T17:00:00.123456+00:00" }).curto, "Agendada 05/11 14:00");
  assert.equal(umSelo({ agendado_para: BRT("04", "09:30").toISOString() }).texto, "Mensagem agendada · amanhã 09:30");
});

test("sem hora e o disparo começa depois: 'a partir de <quando>'", () => {
  const s = umSelo({ agendado_para: null, ordem: 7 }, { inicio: "2026-11-04T12:30:00Z" });
  assert.equal(s.tipo, "apartir");
  assert.equal(s.curto, "A partir de amanhã 09:30");
  assert.equal(s.texto, "Mensagem agendada · a partir de amanhã 09:30");
  assert.equal(s.titulo, "Mensagem agendada · a partir de amanhã 09:30 (quarta-feira, 04/11 às 09:30, disparo para 20 pessoas)");
});

test("sem hora futura, em disparo que já começou: 'Na fila de envio'", () => {
  const semHora = umSelo({ agendado_para: null });
  assert.equal(semHora.tipo, "fila");
  assert.equal(semHora.curto, "Na fila");
  assert.equal(semHora.texto, "Na fila de envio");
  assert.equal(semHora.titulo, "Na fila de envio (disparo para 20 pessoas)");
  assert.equal(semHora.quando, null);
  // hora já passou (está na vez, esperando o próximo minuto da fila)
  assert.equal(umSelo({ agendado_para: BRT("03", "14:59").toISOString() }).tipo, "fila");
  assert.equal(umSelo({ agendado_para: AGORA.toISOString() }).tipo, "fila");
  // a primeira do disparo agendado tem hora; as outras esperam o início
  const ds = [disparo({ inicio: BRT("03", "18:00").toISOString() })];
  const m = selosMensagem([
    envio({ agendado_para: BRT("03", "18:00").toISOString() }),
    envio({ numero: "5547990000001", ordem: 2 }),
  ], ds, AGORA);
  assert.equal(m[NUM].curto, "Agendada hoje 18:00");
  assert.equal(m["5547990000001"].curto, "A partir de hoje 18:00");
});

test("disparo agendado retomado antes da hora já começou: as outras ficam 'Na fila'", () => {
  // retomar dá à primeira pessoa a hora de agora (antes do início marcado) e a fila anda
  const ds = [disparo({ inicio: BRT("04", "09:30").toISOString() })];
  const outra = envio({ numero: "5547990000001", ordem: 2 });
  const retomado = selosMensagem([envio({ agendado_para: AGORA.toISOString() }), outra], ds, AGORA);
  assert.equal(retomado[NUM].tipo, "fila");
  assert.equal(retomado["5547990000001"].tipo, "fila");
  // primeira saindo agora: idem
  const saindo = selosMensagem([envio({ status: "enviando" }), outra], ds, AGORA);
  assert.equal(saindo[NUM].tipo, "enviando");
  assert.equal(saindo["5547990000001"].tipo, "fila");
  // enquanto não começou, a primeira tem a hora do início e as outras "a partir de"
  const esperando = selosMensagem([envio({ agendado_para: BRT("04", "09:30").toISOString() }), outra], ds, AGORA);
  assert.equal(esperando[NUM].curto, "Agendada amanhã 09:30");
  assert.equal(esperando["5547990000001"].curto, "A partir de amanhã 09:30");
});

test("origem: uma pessoa só, várias, total desconhecido", () => {
  assert.match(umSelo({}, { total: 1 }).titulo, /\(mensagem só para esta pessoa\)$/);
  assert.match(umSelo({}, { total: 2 }).titulo, /\(disparo para 2 pessoas\)$/);
  assert.match(umSelo({}, { total: null }).titulo, /\(disparo pelo painel\)$/);
});

test("assim que a mensagem sai o selo some; disparo encerrado não conta", () => {
  for (const status of ["enviado", "falhou", "incerto", "cancelado"]) {
    assert.equal(umSelo({ status }), undefined, status);
  }
  for (const status of ["cancelado", "concluido"]) {
    assert.equal(umSelo({}, { status }), undefined, status);
  }
  // envio de disparo que não veio na lista, número inválido, entradas vazias
  assert.deepEqual(selosMensagem([envio({ disparo_id: "outro" })], [disparo()], AGORA), {});
  assert.deepEqual(selosMensagem([envio({ numero: "123" }), null], [disparo(), null], AGORA), {});
  assert.deepEqual(selosMensagem(null, null, AGORA), {});
  assert.deepEqual(selosMensagem([], [], AGORA), {});
});

test("um selo por número: vale o mais próximo", () => {
  const ds = [
    disparo({ id: "hoje" }), disparo({ id: "amanha" }), disparo({ id: "fila" }),
    disparo({ id: "pausa", status: "pausado" }), disparo({ id: "sai", total: 3 }),
  ];
  const e = {
    hoje: envio({ disparo_id: "hoje", agendado_para: BRT("03", "18:00").toISOString() }),
    amanha: envio({ disparo_id: "amanha", agendado_para: BRT("04", "09:00").toISOString() }),
    fila: envio({ disparo_id: "fila" }),
    pausa: envio({ disparo_id: "pausa" }),
    sai: envio({ disparo_id: "sai", status: "enviando" }),
  };
  const de = (...ks) => selosMensagem(ks.map((k) => e[k]), ds, AGORA)[NUM];
  assert.equal(de("amanha", "hoje").curto, "Agendada hoje 18:00");
  assert.equal(de("hoje", "amanha").curto, "Agendada hoje 18:00");
  assert.equal(de("pausa", "amanha").curto, "Agendada amanhã 09:00");
  assert.equal(de("hoje", "fila").tipo, "fila");
  assert.equal(de("pausa", "hoje", "fila", "sai").tipo, "enviando");
  // quantos envios a mais o número tem vai no texto completo
  const s = de("amanha", "hoje", "pausa");
  assert.equal(s.outras, 2);
  assert.match(s.titulo, /\. Este número tem mais 2 mensagens na fila$/);
  assert.match(de("amanha", "hoje").titulo, /\. Este número tem mais 1 mensagem na fila$/);
  assert.equal(de("hoje").outras, 0);
});

test("número comparado normalizado: só dígitos, 10/11 dígitos ganham 55", () => {
  const m = selosMensagem([envio({ numero: "48991067007" })], [disparo()], AGORA);
  assert.deepEqual(Object.keys(m), [NUM]);
  for (const n of [NUM, "+55 (48) 99106-7007", "(48) 99106-7007", "48991067007"]) {
    assert.equal(seloDoNumero(m, n), m[NUM], n);
  }
  assert.equal(seloDoNumero(m, "5548999990000"), null);
  assert.equal(seloDoNumero(m, ""), null);
  assert.equal(seloDoNumero(m, null), null);
  assert.equal(seloDoNumero(null, NUM), null);
  assert.equal(seloDoNumero({}, "toString"), null);
});

test("agora aceita Date, número e ISO; sem agora usa o relógio", () => {
  const e = [envio({ agendado_para: BRT("03", "18:00").toISOString() })], d = [disparo()];
  for (const ag of [AGORA, AGORA.getTime(), AGORA.toISOString()]) {
    assert.equal(selosMensagem(e, d, ag)[NUM].curto, "Agendada hoje 18:00");
  }
  const futuro = [envio({ agendado_para: new Date(Date.now() + 3600e3).toISOString() })];
  assert.equal(selosMensagem(futuro, d)[NUM].tipo, "agendada");
  assert.equal(selosMensagem(futuro, d, "lixo")[NUM].tipo, "agendada");
});

test("o texto do pill é curto: até 24 caracteres (no máximo duas linhas embaixo do nome, a 360 px)", () => {
  let maior = "";
  const d = [disparo({ inicio: BRT("28", "23:59").toISOString() })];
  for (let dia = 0; dia < 40; dia++) {
    for (const hora of [0, 9.5, 23.99]) {
      const t = new Date(AGORA.getTime() + dia * 864e5 + hora * 3600e3).toISOString();
      for (const e of [envio({ agendado_para: t }), envio({ agendado_para: null })]) {
        const dd = e.agendado_para ? d : [disparo({ inicio: t })];
        const s = selosMensagem([e], dd, AGORA)[NUM];
        if (s && s.curto.length > maior.length) maior = s.curto;
      }
    }
  }
  assert.match(maior, /^A partir de amanhã \d\d:\d\d$/);   // o mais comprido possível
  assert.ok(maior.length <= 24, maior);
});

test("o arquivo é ES5 e roda colado numa função com use strict (como no painel), com e sem Intl", () => {
  const fonte = readFileSync(ARQ, "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /=>/, "sem arrow function");
  assert.doesNotMatch(codigo, /`/, "sem template literal");
  assert.doesNotMatch(codigo, /\b(const|let|class)\s/, "sem const/let/class");
  assert.doesNotMatch(codigo, /\.\.\./, "sem espalhamento");
  const semExport = fonte.replace(/^export\s+/gm, "");
  assert.doesNotMatch(semExport, /\bexport\s/);
  assert.ok(!fonte.includes("@@"), "sem marcador do build dentro do arquivo");
  const roda = (ctx) => vm.runInContext('(function(){"use strict";\n' + semExport +
    '\nreturn {selosMensagem: selosMensagem, seloDoNumero: seloDoNumero, dataCompletaSelo: dataCompletaSelo};})()', vm.createContext(ctx));
  const env = [{ disparo_id: "d1", numero: "48991067007", status: "pendente", agendado_para: "2026-11-04T02:30:00Z", ordem: 1 }];
  const dsp = [{ id: "d1", status: "ativo", inicio: "2026-11-03T13:00:00Z", total: 2 }];
  for (const ctx of [{}, { Intl: undefined }]) {   // sem Intl: cai no UTC-3 fixo
    const api = roda(ctx);
    const s = api.seloDoNumero(api.selosMensagem(env, dsp, "2026-11-03T18:00:00Z"), "(48) 99106-7007");
    assert.equal(s.curto, "Agendada hoje 23:30");
    assert.equal(s.titulo, "Mensagem agendada · hoje 23:30 (terça-feira, 03/11 às 23:30, disparo para 2 pessoas)");
    assert.equal(api.dataCompletaSelo("2026-11-08T12:00:00Z"), "domingo, 08/11 às 09:00");
  }
});
