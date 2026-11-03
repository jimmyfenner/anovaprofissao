// Renderizador das mensagens do disparo (supabase/functions/_shared/mensagem.mjs).
// Rodar: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  renderizar, variaveisDesconhecidas, analisarModelo, formatarNome, saudacaoPara,
  normalizarNumero, VARIAVEIS,
} from "../supabase/functions/_shared/mensagem.mjs";

const ARQ = fileURLToPath(new URL("../supabase/functions/_shared/mensagem.mjs", import.meta.url));
const JOAO = { nome: "João da Silva", cidade: "Florianópolis", uf: "sc" };
// horário de Brasília (UTC-3) escrito em UTC, como o servidor recebe
const BRT = (hhmm) => new Date(`2026-11-03T${hhmm}:00-03:00`);

test("saudação nas três faixas, nos limites, com agora em UTC", () => {
  const casos = [
    ["2026-11-03T08:00:00Z", "bom dia"],    // 05:00 em Brasília
    ["2026-11-03T14:59:00Z", "bom dia"],    // 11:59
    ["2026-11-03T15:00:00Z", "boa tarde"],  // 12:00
    ["2026-11-03T20:59:00Z", "boa tarde"],  // 17:59
    ["2026-11-03T21:00:00Z", "boa noite"],  // 18:00
    ["2026-11-03T07:59:00Z", "boa noite"],  // 04:59
    ["2026-11-03T03:00:00Z", "boa noite"],  // 00:00
  ];
  for (const [iso, esperado] of casos) assert.equal(saudacaoPara(new Date(iso)), esperado, iso);
  assert.equal(saudacaoPara("2026-11-03T15:00:00Z"), "boa tarde");          // ISO em texto
  assert.equal(saudacaoPara(Date.parse("2026-11-03T21:00:00Z")), "boa noite"); // número
});

test("{saudacao}, {primeiro_nome}! abre frase em maiúscula", () => {
  const m = "{saudacao}, {primeiro_nome}!";
  assert.equal(renderizar(m, JOAO, BRT("05:00")), "Bom dia, João!");
  assert.equal(renderizar(m, JOAO, BRT("11:59")), "Bom dia, João!");
  assert.equal(renderizar(m, JOAO, BRT("12:00")), "Boa tarde, João!");
  assert.equal(renderizar(m, JOAO, BRT("17:59")), "Boa tarde, João!");
  assert.equal(renderizar(m, JOAO, BRT("18:00")), "Boa noite, João!");
  assert.equal(renderizar(m, JOAO, BRT("04:59")), "Boa noite, João!");
});

test("Oi {primeiro_nome}, {saudacao}! fica em minúscula no meio da frase", () => {
  const m = "Oi {primeiro_nome}, {saudacao}!";
  assert.equal(renderizar(m, JOAO, BRT("09:00")), "Oi João, bom dia!");
  assert.equal(renderizar(m, JOAO, BRT("11:59")), "Oi João, bom dia!");
  assert.equal(renderizar(m, JOAO, BRT("12:00")), "Oi João, boa tarde!");
  assert.equal(renderizar(m, JOAO, BRT("17:59")), "Oi João, boa tarde!");
  assert.equal(renderizar(m, JOAO, BRT("18:00")), "Oi João, boa noite!");
  assert.equal(renderizar(m, JOAO, BRT("04:59")), "Oi João, boa noite!");
  assert.equal(renderizar(m, JOAO, BRT("05:00")), "Oi João, bom dia!");
});

test("maiúscula depois de . ! ? e de quebra de linha", () => {
  assert.equal(renderizar("Oi. {saudacao}", {}, BRT("09:00")), "Oi. Bom dia");
  assert.equal(renderizar("Oi!\n{saudacao}", {}, BRT("09:00")), "Oi!\nBom dia");
  assert.equal(renderizar("Tudo bem?  {saudacao}", {}, BRT("09:00")), "Tudo bem?  Bom dia");
  assert.equal(renderizar("Oi, {saudacao}", {}, BRT("09:00")), "Oi, bom dia");
});

test("*{saudacao}* no começo vira *Bom dia*", () => {
  assert.equal(renderizar("*{saudacao}*, {primeiro_nome}", JOAO, BRT("08:00")), "*Bom dia*, João");
  assert.equal(renderizar("_~{saudacao}~_", JOAO, BRT("20:00")), "_~Boa noite~_");
});

test("nome em CAIXA ALTA vira Título", () => {
  const d = { nome: "JOÃO DA SILVA", cidade: "SÃO JOSÉ DOS CAMPOS", uf: "sp" };
  assert.equal(renderizar("{nome} | {primeiro_nome} | {cidade} | {uf}", d, BRT("10:00")),
    "João da Silva | João | São José dos Campos | SP");
  assert.equal(formatarNome("JOÃO DA SILVA"), "João da Silva");
});

test("maria da silva (tudo minúsculo) vira Maria da Silva", () => {
  assert.equal(formatarNome("maria da silva"), "Maria da Silva");
  assert.equal(renderizar("Oi {primeiro_nome}", { nome: "maria da silva" }, BRT("10:00")), "Oi Maria");
});

test("formatarNome: espaços, conectivos, hífen e texto misto", () => {
  assert.equal(formatarNome("  ana   paula  "), "Ana Paula");
  assert.equal(formatarNome("DE SOUZA E SILVA"), "De Souza e Silva");   // primeira palavra sempre maiúscula
  assert.equal(formatarNome("ana-maria dos santos"), "Ana-Maria dos Santos");
  assert.equal(formatarNome("McDonald da Costa"), "McDonald da Costa"); // misto: fica como veio
  assert.equal(formatarNome("joão DA silva"), "joão DA silva");         // misto: fica como veio
  assert.equal(formatarNome(null), "");
  assert.equal(formatarNome(""), "");
});

test("cidade vazia sem plano B: limpa espaço e pontuação", () => {
  const sem = { nome: "João", cidade: "", uf: "" };
  assert.equal(renderizar("Oi {primeiro_nome}, tudo bem em {cidade}?", sem, BRT("10:00")), "Oi João, tudo bem em?");
  assert.equal(renderizar("Oi {primeiro_nome}, {cidade} está na lista.", sem, BRT("10:00")), "Oi João, está na lista.");
  assert.equal(renderizar("Oi {primeiro_nome} de {cidade} {uf}!", { nome: "João" }, BRT("10:00")), "Oi João de!");
  assert.equal(renderizar("Live em {cidade}, {uf}, hoje", sem, BRT("10:00")), "Live em, hoje");
});

test("cidade vazia com plano B usa o texto depois do |", () => {
  const sem = { nome: "João", cidade: null };
  assert.equal(renderizar("Novidade para {cidade|a sua região}.", sem, BRT("10:00")), "Novidade para a sua região.");
  assert.equal(renderizar("{cidade|sua cidade} recebe a live", sem, BRT("10:00")), "Sua cidade recebe a live");
  assert.equal(renderizar("Novidade para {cidade|a sua região}.", JOAO, BRT("10:00")), "Novidade para Florianópolis.");
});

test("valor vazio no meio de vírgulas não deixa vírgula dupla", () => {
  const sem = { nome: "" };
  assert.equal(renderizar("{saudacao}, {primeiro_nome}!", sem, BRT("10:00")), "Bom dia!");
  assert.equal(renderizar("{saudacao}, {primeiro_nome}, tudo bem?", sem, BRT("10:00")), "Bom dia, tudo bem?");
  assert.equal(renderizar("Oi  {primeiro_nome}  tudo bem", sem, BRT("10:00")), "Oi tudo bem");
  // o resto da mensagem não é mexido
  assert.equal(renderizar("A  B , C\n{primeiro_nome}", JOAO, BRT("10:00")), "A  B , C\nJoão");
});

test("variação {Oi|Olá|E aí} com sorteio fixo", () => {
  const m = "{Oi|Olá|E aí}, {primeiro_nome}!";
  assert.equal(renderizar(m, JOAO, BRT("10:00"), () => 0), "Oi, João!");
  assert.equal(renderizar(m, JOAO, BRT("10:00"), () => 0.5), "Olá, João!");
  assert.equal(renderizar(m, JOAO, BRT("10:00"), () => 0.999), "E aí, João!");
  assert.equal(renderizar("{a | b}", {}, BRT("10:00"), () => 0.9), "B");
  // a opção sorteada também ganha maiúscula quando abre frase (como no querocarregador)
  assert.equal(renderizar("{oi|olá}, {primeiro_nome}!", JOAO, BRT("10:00"), () => 0), "Oi, João!");
  assert.equal(renderizar("{oi|olá}, {primeiro_nome}!", JOAO, BRT("10:00"), () => 0.9), "Olá, João!");
  assert.equal(renderizar("oi. {oi|olá}", {}, BRT("10:00"), () => 0), "oi. Oi");
  assert.equal(renderizar("Tudo certo, {oi|olá}", {}, BRT("10:00"), () => 0), "Tudo certo, oi");
  assert.equal(renderizar("{e aí, PESSOAL|x}", {}, BRT("10:00"), () => 0), "E aí, PESSOAL");
  // sem sorteio, uma das opções
  assert.ok(["Oi", "Olá", "E aí"].includes(renderizar("{Oi|Olá|E aí}", {}, BRT("10:00"))));
});

test("variável desconhecida fica como está e é listada", () => {
  assert.equal(renderizar("Oi {apelido}, {primeiro_nome}", JOAO, BRT("10:00")), "Oi {apelido}, João");
  assert.deepEqual(variaveisDesconhecidas("Oi {apelido} {apelido} {cidade} {Oi|Olá} {xpto}"), ["apelido", "xpto"]);
  assert.deepEqual(variaveisDesconhecidas("{saudacao} {Primeiro Nome} {estado}"), []);
  assert.equal(renderizar("chaves {} vazias", {}, BRT("10:00")), "chaves {} vazias");
});

test("{Primeiro Nome} com espaço, acento e hífen valem igual", () => {
  for (const v of ["{Primeiro Nome}", "{primeiro_nome}", "{primeironome}", "{PRIMEIRO-NOME}", "{ primeiro nome }"]) {
    assert.equal(renderizar("Oi " + v, JOAO, BRT("10:00")), "Oi João", v);
  }
  assert.equal(renderizar("{Saudação}", {}, BRT("13:00")), "Boa tarde");
  assert.equal(renderizar("{estado} e {UF}", JOAO, BRT("13:00")), "SC e SC");
});

test("analisarModelo aponta cidade usada sem plano B", () => {
  const a = analisarModelo("{saudacao} {cidade} {cidade|aí} {Oi|Olá} {x}");
  assert.deepEqual(a.usadas, [
    { chave: "saudacao", planoB: false }, { chave: "cidade", planoB: false }, { chave: "cidade", planoB: true },
  ]);
  assert.equal(a.variacoes, 1);
  assert.deepEqual(a.desconhecidas, ["x"]);
});

test("resultado sem espaço nas pontas e no máximo 4096 caracteres", () => {
  assert.equal(renderizar("  \n Oi {primeiro_nome} \n ", JOAO, BRT("10:00")), "Oi João");
  assert.equal(renderizar("a".repeat(5000), {}, BRT("10:00")).length, 4096);
  assert.equal(renderizar(null, null, BRT("10:00")), "");
});

test("normalizarNumero: 55 na frente, recusa o que não é do Brasil", () => {
  assert.deepEqual(normalizarNumero("(48) 99106-7007"), { numero: "5548991067007", motivo: null });
  assert.deepEqual(normalizarNumero("4832221234"), { numero: "554832221234", motivo: null });
  assert.deepEqual(normalizarNumero("+55 48 99106-7007"), { numero: "5548991067007", motivo: null });
  assert.equal(normalizarNumero("55991234567").numero, "5555991234567");   // DDD 55 (Santa Maria)
  assert.equal(normalizarNumero("1234").numero, null);
  assert.equal(normalizarNumero("14155552671234").numero, null);
  assert.equal(normalizarNumero("").motivo, "Sem número de WhatsApp");
});

test("VARIAVEIS lista as cinco do painel", () => {
  assert.deepEqual(VARIAVEIS.map((v) => v.nome), ["primeiro_nome", "nome", "cidade", "uf", "saudacao"]);
});

test("o arquivo é ES5 e roda dentro de uma função com use strict (como no painel)", () => {
  const fonte = readFileSync(ARQ, "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /=>/, "sem arrow function");
  assert.doesNotMatch(codigo, /`/, "sem template literal");
  assert.doesNotMatch(codigo, /\b(const|let|class)\s/, "sem const/let/class");
  assert.doesNotMatch(codigo, /\.\.\./, "sem espalhamento");
  const semExport = fonte.replace(/^export\s+/gm, "");
  assert.doesNotMatch(semExport, /\bexport\s/);
  const ctx = vm.createContext({ Intl, Date, Math, String, RegExp, parseInt, isNaN });
  const api = vm.runInContext('(function(){"use strict";\n' + semExport +
    '\nreturn {renderizar: renderizar, saudacaoPara: saudacaoPara};})()', ctx);
  assert.equal(api.renderizar("{saudacao}, {primeiro_nome}!", JOAO, new Date("2026-11-03T21:00:00Z")), "Boa noite, João!");
});
