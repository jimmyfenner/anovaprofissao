// A NOVA PROFISSÃO — função "disparos" (nov/2026)
// Mensagem de WhatsApp pelo painel para um lead ou para vários, com espera
// aleatória entre uma e outra. A fila mora no banco (db/18-disparos.sql); esta
// função manda uma mensagem por vez pela Evolution e devolve o resultado.
//
// Publicar: supabase functions deploy disparos --project-ref buapklmgdjcoyzrmhhcd --use-api --no-verify-jwt
// verify_jwt fica DESLIGADO: o pg_cron chama "processar" sem chave (só anda o
// que já está na fila e no horário) e as outras ações conferem o login aqui.
// A chave da Evolution vive nos Secrets (EVOLUTION_URL, EVOLUTION_APIKEY) e
// nunca vai para o navegador nem para o log; o token das instâncias também não.

import { normalizarNumero, renderizar } from "../_shared/mensagem.mjs";

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const NUMERO_TESTE_PADRAO = "5548991067007";
const MAX_DESTINATARIOS = 500;
const JANELA_MS = 55_000;          // quanto tempo cada chamada de "processar" anda a fila
const TIMEOUT_ENVIO_MS = 75_000;   // a Evolution já levou ~50 s para um envio (out/2026)
const INCERTO = "Sem confirmação da Evolution (pode ter saído)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^[A-Za-z0-9_-]{8,64}$/;

// O limite de parede vale para o worker, não para cada chamada: o Supabase
// reaproveita o mesmo worker para as chamadas seguintes. No plano Free ele é
// encerrado aos 150 s e para de receber chamadas novas aos 75 s; nos pagos,
// 400 s e 200 s. Um envio nunca espera a Evolution além do fim do worker: se
// ela demorar mais, vira "Sem confirmação" na hora e a fila segue, em vez de o
// worker morrer no meio e a linha ficar "enviando" por 4 min. (Parar de
// reservar cedo deixaria a fila parada quase um minuto a cada dois.)
const NASCEU = Date.now();
let vidaWorkerMs = 150_000;
let encerrando = false;
addEventListener("beforeunload", () => { encerrando = true; });
// chamada nova num worker com mais de 80 s só acontece nos planos pagos
function notarChamada() { if (Date.now() - NASCEU > 80_000) vidaWorkerMs = 400_000; }
const restaDoWorker = () => NASCEU + vidaWorkerMs - 5_000 - Date.now();
const timeoutEnvio = () => Math.max(15_000, Math.min(TIMEOUT_ENVIO_MS, restaDoWorker()));

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

class Recusa extends Error {
  constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); }
}

type Resposta = { ok: boolean; status: number; body: any };
type Instancia = { nome: string; estado: string; numero: string; perfil: string | null };
type Reservado = {
  id: string; disparo_id: string; numero: string; nome: string | null; cidade: string | null;
  uf: string | null; refs: unknown; instancia: string; modelo: string;
};
type Envio = { tipo: "ok" | "numero" | "instancia" | "incerto"; erro: string };

function lerCorpo(txt: string): unknown {
  try { return JSON.parse(txt); } catch { return txt; }
}

async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Resposta> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  return { ok: r.ok, status: r.status, body: lerCorpo(await r.text()) };
}

async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`rpc ${fn} HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

async function evo(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Resposta> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${EVO_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    });
    return { ok: r.ok, status: r.status, body: lerCorpo(await r.text()) };
  } finally {
    clearTimeout(t);
  }
}

// login do painel: qualquer usuário válido do Supabase deste projeto
async function usuario(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

// só nome, estado, número e perfil — o token da instância nunca sai daqui
async function listarInstancias(): Promise<Instancia[]> {
  if (!EVO_URL || !EVO_KEY) throw new Recusa("A Evolution não está configurada nesta função.", 500);
  let r: Resposta;
  try {
    r = await evo("/instance/fetchInstances", { method: "GET" });
  } catch {
    throw new Recusa("Não consegui falar com a Evolution agora. Tente de novo em instantes.", 502);
  }
  if (!r.ok || !Array.isArray(r.body)) {
    throw new Recusa(`A Evolution não devolveu as instâncias (erro ${r.status}).`, 502);
  }
  return r.body.map((x: any) => ({
    nome: String(x?.name ?? x?.instance?.instanceName ?? ""),
    estado: String(x?.connectionStatus ?? x?.instance?.status ?? "desconhecido"),
    numero: String(x?.ownerJid ?? x?.number ?? x?.instance?.owner ?? "").split("@")[0].replace(/\D/g, ""),
    perfil: (x?.profileName ?? x?.instance?.profileName ?? null) || null,
  })).filter((i: Instancia) => i.nome)
    .sort((a: Instancia, b: Instancia) =>
      Number(b.estado === "open") - Number(a.estado === "open") || a.nome.localeCompare(b.nome));
}

async function lerConfig(): Promise<{ padrao: string | null; numero_teste: string; instancia_avisos: string | null }> {
  const [c, w] = await Promise.all([
    rest("disparo_config?id=eq.1&select=instancia,numero_teste"),
    rest("whatsapp_config?id=eq.1&select=instancia"),
  ]);
  const cfg = Array.isArray(c.body) ? c.body[0] : null;
  const wa = Array.isArray(w.body) ? w.body[0] : null;
  return {
    padrao: cfg?.instancia || null,
    numero_teste: normalizarNumero(cfg?.numero_teste).numero ?? NUMERO_TESTE_PADRAO,
    instancia_avisos: wa?.instancia || null,
  };
}

// erro curto e legível da Evolution, sem nada além do que ela mesma respondeu
function resumoErro(body: unknown): string {
  const b: any = body;
  let m: any = b?.response?.message ?? b?.message ?? b?.error ?? b;
  if (Array.isArray(m)) {
    m = m.map((x: any) => typeof x === "string" ? x : x?.exists === false ? "número sem WhatsApp" : JSON.stringify(x)).join("; ");
  }
  if (typeof m !== "string") m = JSON.stringify(m ?? "");
  return String(m).replace(/\s+/g, " ").trim().slice(0, 160) || "sem detalhe";
}

async function enviarTexto(instancia: string, numero: string, texto: string): Promise<Envio> {
  const delay = 1200 + Math.floor(Math.random() * 1801);   // "digitando…" de 1,2 a 3 s
  let r: Resposta;
  try {
    r = await evo(`/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      body: JSON.stringify({ number: numero, text: texto, delay, linkPreview: true }),
    }, timeoutEnvio());
  } catch {
    return { tipo: "incerto", erro: INCERTO };   // tempo esgotado ou rede: pode ter saído
  }
  if (r.ok) return { tipo: "ok", erro: "" };
  const b: any = r.body;
  const msg = resumoErro(b);
  const semWhats = Array.isArray(b?.response?.message) && b.response.message.some((x: any) => x?.exists === false);
  if (semWhats) return { tipo: "numero", erro: "Este número não tem WhatsApp" };
  if (r.status === 404) return { tipo: "instancia", erro: "a instância não existe mais na Evolution" };
  if (r.status === 401 || r.status === 403) return { tipo: "instancia", erro: `acesso recusado (erro ${r.status})` };
  if (/connection closed|not connected|disconnected|connection.*(lost|close)|timed out/i.test(msg) || r.status >= 500) {
    return { tipo: "instancia", erro: msg };
  }
  return { tipo: "numero", erro: msg };   // 400 e afins: número recusado
}

async function enviarUm(e: Reservado) {
  let texto = "";
  try {
    texto = renderizar(e.modelo, { nome: e.nome, cidade: e.cidade, uf: e.uf }, new Date());
  } catch (err) {
    console.error("disparos: renderizar", err instanceof Error ? err.message : err);
  }
  if (!texto) {
    await rpc("disparo_concluir", { p_id: e.id, p_status: "falhou", p_texto: null, p_erro: "A mensagem ficou vazia para esta pessoa" });
    return;
  }
  const r = await enviarTexto(e.instancia, e.numero, texto);
  if (r.tipo === "ok") {
    await rpc("disparo_concluir", { p_id: e.id, p_status: "enviado", p_texto: texto, p_erro: null });
  } else if (r.tipo === "numero") {
    await rpc("disparo_concluir", { p_id: e.id, p_status: "falhou", p_texto: texto, p_erro: r.erro });
  } else if (r.tipo === "instancia") {
    await rpc("disparo_devolver", { p_id: e.id, p_motivo: `A instância ${e.instancia} não respondeu: ${r.erro}` });
  } else {
    await rpc("disparo_concluir", { p_id: e.id, p_status: "incerto", p_texto: texto, p_erro: INCERTO });
  }
}

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// Anda a fila por até 55 s: um envio por vez, e nenhum começa quando o worker
// já não tem 15 s de vida para esperar a Evolution. Sem nada na hora, dorme até
// o próximo marcado (em passos de até 5 s, para pegar disparo novo) ou sai.
async function processar() {
  const ini = Date.now();
  const fim = () => Math.min(ini + JANELA_MS, NASCEU + vidaWorkerMs - 20_000);   // 20 = 15 de envio + 5 de folga
  while (!encerrando && Date.now() < fim()) {
    const linhas = await rpc("disparo_reservar");
    const e: Reservado | undefined = Array.isArray(linhas) ? linhas[0] : undefined;
    if (e) { await enviarUm(e); continue; }
    const prox = await rpc("disparo_proximo");
    if (!prox) return;
    const falta = Date.parse(String(prox)) - Date.now();
    const resta = fim() - Date.now();
    if (!(falta < resta)) return;
    // já está na hora mas a instância está ocupada com outro disparo: espera um pouco
    await dormir(falta <= 0 ? 2000 : Math.min(falta + 50, 5000, resta));
  }
}

function emSegundoPlano(p: Promise<unknown>) {
  const seguro = p.catch((err) => console.error("disparos: fila", err instanceof Error ? err.message : err));
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(seguro);
}

function curto(v: unknown, max: number): string | null {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function idValido(v: unknown): string {
  const id = String(v ?? "");
  if (!UUID.test(id)) throw new Recusa("Disparo inválido.");
  return id;
}

// o mesmo pedido já gravou um disparo? (a resposta anterior se perdeu no caminho)
async function disparoDaChave(chave: string | null) {
  if (!chave) return null;
  const r = await rest(`disparos?chave=eq.${encodeURIComponent(chave)}&select=id,total`);
  const d = Array.isArray(r.body) ? r.body[0] : null;
  return d?.id ? { id: String(d.id), total: Number(d.total) || 0, ignorados: [], repetido: true } : null;
}

async function criar(body: any, uid: string) {
  const chave = CHAVE.test(String(body.chave ?? "")) ? String(body.chave) : null;
  const ja = await disparoDaChave(chave);
  if (ja) return ja;
  const modelo = String(body.modelo ?? "");
  if (!modelo.trim() || modelo.length > 4096) throw new Recusa("Escreva a mensagem (até 4.096 caracteres).");
  const min = body.intervalo_min == null ? 40 : Math.round(Number(body.intervalo_min));
  const max = body.intervalo_max == null ? 90 : Math.round(Number(body.intervalo_max));
  if (!(min >= 5 && max >= min && max <= 3600)) {
    throw new Recusa("A espera precisa ficar entre 5 e 3.600 segundos, com o primeiro número menor ou igual ao segundo.");
  }
  const instancia = String(body.instancia ?? "").trim();
  if (!instancia) throw new Recusa("Escolha a instância que vai enviar.");
  const inst = (await listarInstancias()).find((i) => i.nome === instancia);
  if (!inst) throw new Recusa(`A instância ${instancia} não existe mais na Evolution.`);
  if (inst.estado !== "open") throw new Recusa(`A instância ${instancia} está desconectada. Conecte o número ou escolha outra.`);

  const agora = Date.now();
  let inicio = body.inicio ? Date.parse(String(body.inicio)) : agora;
  if (isNaN(inicio) || inicio < agora) inicio = agora;
  if (inicio > agora + 31 * 86400e3) throw new Recusa("Agende para no máximo 30 dias à frente.");

  const lista: any[] = Array.isArray(body.destinatarios) ? body.destinatarios : [];
  if (!lista.length) throw new Recusa("Escolha pelo menos uma pessoa.");
  if (lista.length > MAX_DESTINATARIOS * 3) throw new Recusa(`No máximo ${MAX_DESTINATARIOS} pessoas por disparo.`);

  type Dest = { numero: string; nome: string | null; cidade: string | null; uf: string | null; refs: string[] };
  const porNumero = new Map<string, Dest>();
  const ignorados: { numero: string; nome: string | null; motivo: string }[] = [];
  for (const d of lista) {
    const nome = curto(d?.nome, 120);
    const n = normalizarNumero(d?.numero);
    if (!n.numero) { ignorados.push({ numero: String(d?.numero ?? "").slice(0, 30), nome, motivo: n.motivo ?? "Número inválido" }); continue; }
    const refs = (Array.isArray(d?.refs) ? d.refs : []).map((r: any) => String(r?.id ?? "")).filter((id: string) => UUID.test(id));
    const ja = porNumero.get(n.numero);
    if (ja) {   // o mesmo número em dois leads sai uma vez só, e marca os dois
      for (const id of refs) if (!ja.refs.includes(id)) ja.refs.push(id);
      continue;
    }
    porNumero.set(n.numero, {
      numero: n.numero, nome, cidade: curto(d?.cidade, 120), uf: curto(d?.uf, 30), refs,
    });
  }

  // espelho de licenciado: o aviso disse que só o licenciado chama — nunca por aqui
  const ids = [...new Set([...porNumero.values()].flatMap((d) => d.refs))];
  const achados = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const r = await rest(`leads?select=id,licenciado&id=in.(${ids.slice(i, i + 100).join(",")})`);
    if (!r.ok || !Array.isArray(r.body)) throw new Error(`leads HTTP ${r.status}`);
    for (const l of r.body) achados.set(String(l.id), l.licenciado ?? null);
  }
  const destinatarios: Dest[] = [];
  for (const d of porNumero.values()) {
    if (d.refs.some((id) => achados.get(id))) { ignorados.push({ numero: d.numero, nome: d.nome, motivo: "lead de licenciado" }); continue; }
    if (d.refs.length && !d.refs.some((id) => achados.has(id))) {
      ignorados.push({ numero: d.numero, nome: d.nome, motivo: "lead excluído do painel" });
      continue;
    }
    d.refs = d.refs.filter((id) => achados.has(id));
    destinatarios.push(d);
  }
  if (!destinatarios.length) throw new Recusa("Ninguém da lista pode receber esta mensagem.", 400, { ignorados });
  if (destinatarios.length > MAX_DESTINATARIOS) {
    throw new Recusa(`No máximo ${MAX_DESTINATARIOS} pessoas por disparo (a lista tem ${destinatarios.length}).`);
  }

  const novo = await rest("disparos", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      criado_por: uid, instancia, modelo, intervalo_min: min, intervalo_max: max,
      marcar_contatado: body.marcar_contatado !== false, total: destinatarios.length,
      inicio: new Date(inicio).toISOString(), chave,
    }),
  });
  if (novo.status === 409 && chave) {   // dois pedidos iguais ao mesmo tempo: vale o primeiro
    const outro = await disparoDaChave(chave);
    if (outro) return outro;
  }
  const id = Array.isArray(novo.body) ? novo.body[0]?.id : null;
  if (!novo.ok || !id) throw new Error(`insert disparos HTTP ${novo.status}: ${JSON.stringify(novo.body).slice(0, 300)}`);

  const envios = destinatarios.map((d, i) => ({
    disparo_id: id, ordem: i + 1, numero: d.numero, nome: d.nome, cidade: d.cidade, uf: d.uf,
    refs: d.refs.map((r) => ({ id: r })),
    espera_s: i === 0 ? 0 : min + Math.floor(Math.random() * (max - min + 1)),
    agendado_para: i === 0 ? new Date(inicio).toISOString() : null,
  }));
  const ins = await rest("disparo_envios", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(envios) });
  if (!ins.ok) {
    await rest(`disparos?id=eq.${id}`, { method: "DELETE" });
    throw new Error(`insert disparo_envios HTTP ${ins.status}: ${JSON.stringify(ins.body).slice(0, 300)}`);
  }

  if (body.salvar_padrao) {
    await rest("disparo_config?id=eq.1", {
      method: "PATCH", body: JSON.stringify({ instancia, atualizado_em: new Date().toISOString() }),
    });
  }
  if (inicio - Date.now() < JANELA_MS) emSegundoPlano(processar());
  return { id, total: destinatarios.length, ignorados };
}

async function teste(body: any) {
  const instancia = String(body.instancia ?? "").trim();
  if (!instancia) throw new Recusa("Escolha a instância que vai enviar.");
  const modelo = String(body.modelo ?? "");
  if (!modelo.trim() || modelo.length > 4096) throw new Recusa("Escreva a mensagem (até 4.096 caracteres).");
  let numero: string | null = null;
  if (body.numero) {
    numero = normalizarNumero(body.numero).numero;
    if (!numero) throw new Recusa("O número de teste precisa ter DDD e número.");
  } else {
    numero = (await lerConfig()).numero_teste;
  }
  const d = body.dados ?? {};
  const msg = renderizar(modelo, { nome: d.nome, cidade: d.cidade, uf: d.uf }, new Date());
  if (!msg) return { ok: false, texto: msg, numero, erro: "A mensagem ficou vazia para esta pessoa." };
  const r = await enviarTexto(instancia, numero, msg);
  const erro = r.tipo === "ok" ? null
    : r.tipo === "instancia" ? `A instância ${instancia} não respondeu: ${r.erro}`
    : r.erro;
  return { ok: r.tipo === "ok", texto: msg, numero, erro };
}

async function salvarConfig(body: any) {
  const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
  if ("instancia" in body) patch.instancia = curto(body.instancia, 120);
  if ("numero_teste" in body) {
    const bruto = String(body.numero_teste ?? "").trim();
    const n = normalizarNumero(bruto).numero;
    if (bruto && !n) throw new Recusa("O número de teste precisa ter DDD e número, como 48 99106-7007.");
    patch.numero_teste = n;
  }
  const r = await rest("disparo_config?id=eq.1", { method: "PATCH", body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`disparo_config HTTP ${r.status}`);
  return { ok: true, ...(await lerConfig()) };
}

Deno.serve(async (req) => {
  notarChamada();
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const acao = String(body?.action ?? "");

  try {
    // pública e inofensiva: só envia o que já está na fila e no horário
    if (acao === "processar") {
      emSegundoPlano(processar());
      return json({ ok: true });
    }

    const uid = await usuario(req);
    if (!uid) return json({ error: "Sua sessão expirou. Entre de novo no painel." }, 401);

    if (acao === "instancias") {
      const cfg = await lerConfig();
      try {
        return json({ instancias: await listarInstancias(), ...cfg });
      } catch (e) {
        if (e instanceof Recusa) return json({ error: e.message, instancias: [], ...cfg }, e.status);
        throw e;
      }
    }
    if (acao === "config") return json(await salvarConfig(body));
    if (acao === "criar") return json(await criar(body, uid));
    if (acao === "teste") return json(await teste(body));
    if (acao === "lista") {
      const id = body.disparo_id ? idValido(body.disparo_id) : null;
      return json(await rpc("disparo_painel", { p_disparo: id }));
    }
    if (acao === "pausar") {
      await rpc("disparo_pausar", { p_disparo: idValido(body.id), p_motivo: null });
      return json({ ok: true });
    }
    if (acao === "retomar") {
      await rpc("disparo_retomar", { p_disparo: idValido(body.id) });
      emSegundoPlano(processar());
      return json({ ok: true });
    }
    if (acao === "cancelar") {
      await rpc("disparo_cancelar", { p_disparo: idValido(body.id) });
      return json({ ok: true });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message, ...e.extra }, e.status);
    console.error("disparos:", acao, e instanceof Error ? e.message : e);
    return json({ error: "Não deu certo agora. Tente de novo em instantes." }, 500);
  }
});
