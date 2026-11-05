// A NOVA PROFISSÃO — função "reunioes" (nov/2026)
// Diário de reuniões do Jimmy: leads das chamadas do Meet, status das reuniões,
// lembretes, comentários e envio de mensagem ao lead. Tabelas em db/21-reunioes.sql.
//
// Publicar: supabase functions deploy reunioes --project-ref buapklmgdjcoyzrmhhcd --use-api --no-verify-jwt
// verify_jwt DESLIGADO porque o assistente do Mac entra com o próprio token
// (cabeçalho x-assistente-token, comparado com o sha256 em reunioes_config);
// o painel /reunioes entra com o login do Supabase (o mesmo do /admin).
// A chave da Evolution vive nos Secrets (EVOLUTION_URL, EVOLUTION_APIKEY).

import { normalizarNumero } from "../_shared/mensagem.mjs";

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-assistente-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

class Recusa extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

const SITUACOES = ["aberto", "ganho", "perdido", "pausado"];
const TEMPERATURAS = ["quente", "morno", "frio"];
const STATUS_REUNIAO = ["realizada", "curta", "sem_gravacao", "nao_compareceu", "remarcada", "agendada"];
const STATUS_LEMBRETE = ["pendente", "enviado", "feito", "apagado"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── banco (service role) ─────────────────────────────────────
async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const txt = await r.text();
  let body: any = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!r.ok) {
    console.error("reunioes rest", r.status, path.split("?")[0], typeof body === "string" ? body.slice(0, 200) : body?.message);
    throw new Recusa("Não consegui gravar agora. Tente de novo em instantes.", 500);
  }
  return body;
}
const enc = encodeURIComponent;

// ── quem está chamando ───────────────────────────────────────
async function sha256(t: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function ehAssistente(req: Request): Promise<boolean> {
  const t = (req.headers.get("x-assistente-token") ?? "").trim();
  if (t.length < 32) return false;
  const cfg = await rest("reunioes_config?id=eq.1&select=token_hash");
  const hash = Array.isArray(cfg) ? cfg[0]?.token_hash : null;
  return Boolean(hash) && iguais(await sha256(t), hash);
}
// login do painel: qualquer usuário válido do Supabase deste projeto (o mesmo critério do /admin)
async function usuario(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

// ── utilidades ───────────────────────────────────────────────
const normalizar = (t: unknown) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const digitos = (t: unknown) => String(t ?? "").replace(/\D/g, "");
// celular brasileiro com e sem o nono dígito (o WhatsApp grava muitos sem)
function variantes(tel: string): string[] {
  const n = digitos(tel);
  if (!n) return [];
  const v = new Set([n]);
  if (/^55\d{2}9\d{8}$/.test(n)) v.add(n.slice(0, 4) + n.slice(5));
  if (/^55\d{2}[6-9]\d{7}$/.test(n)) v.add(`${n.slice(0, 4)}9${n.slice(4)}`);
  return [...v];
}
const texto = (v: unknown, max: number) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
};
function quandoValido(v: unknown): string {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new Recusa("Data e hora inválidas.");
  return d.toISOString();
}
function idLembrete(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Recusa("Lembrete inválido.");
  return n;
}
function idLead(v: unknown): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Recusa("Lead inválido.");
  return s;
}

// ── leitura ──────────────────────────────────────────────────
async function estado() {
  const [leads, reunioes, lembretes, comentarios, envios] = await Promise.all([
    rest("reunioes_leads?select=*&order=atualizado_em.desc"),
    rest("reunioes?select=*&order=data.desc,hora.desc"),
    rest("reunioes_lembretes?select=*&order=quando.asc&limit=2000"),
    rest("reunioes_comentarios?select=*&order=criado_em.desc&limit=2000"),
    rest("reunioes_envios?select=*&order=criado_em.desc&limit=500"),
  ]);
  const porId = new Map(leads.map((l: any) => [l.id, l]));
  // o assistente do Mac usa `lead` dentro da reunião (nome, telefone…)
  for (const r of reunioes) {
    const l: any = porId.get(r.lead_id);
    r.lead = l ? { id: l.id, nome: l.nome, telefone: l.telefone, cidade: l.cidade, empresa: l.empresa, situacao: l.situacao } : null;
  }
  return { leads, reunioes, lembretes, comentarios, envios };
}

// ── leads: achar ou criar pelo telefone, senão pelo nome ─────
async function acharOuCriarLead(dados: any, produto: string | null): Promise<string | null> {
  const nome = texto(dados?.nome, 200);
  if (!nome) return null;
  const tel = digitos(dados?.telefone) || null;
  let lead: any = null;
  if (tel) {
    const v = variantes(tel);
    const r = await rest(`reunioes_leads?select=*&telefone=in.(${v.map(enc).join(",")})&limit=1`);
    lead = r[0] ?? null;
  }
  if (!lead) {
    // pelo nome: só se o lead achado não tiver outro telefone
    const todos = await rest("reunioes_leads?select=id,nome,telefone,cidade,empresa,produto");
    lead = todos.find((l: any) => normalizar(l.nome) === normalizar(nome) && (!tel || !l.telefone || variantes(tel).includes(l.telefone))) ?? null;
  }
  if (!lead) {
    const novo = await rest("reunioes_leads", {
      method: "POST",
      body: JSON.stringify({
        nome, telefone: tel, cidade: texto(dados?.cidade, 120), empresa: texto(dados?.empresa, 200), produto,
      }),
    });
    return novo[0].id;
  }
  const campos: Record<string, unknown> = {};
  if (tel && !lead.telefone) campos.telefone = tel;
  if (!lead.cidade && dados?.cidade) campos.cidade = texto(dados.cidade, 120);
  if (!lead.empresa && dados?.empresa) campos.empresa = texto(dados.empresa, 200);
  if (!lead.produto && produto) campos.produto = produto;
  if (Object.keys(campos).length) {
    campos.atualizado_em = new Date().toISOString();
    await rest(`reunioes_leads?id=eq.${lead.id}`, { method: "PATCH", body: JSON.stringify(campos) });
  }
  return lead.id;
}

// temperatura do lead acompanha a reunião mais recente, salvo se o Jimmy trocou no painel
async function atualizarTemperaturaDoLead(leadId: string) {
  const [lead] = await rest(`reunioes_leads?id=eq.${leadId}&select=temperatura_por`);
  if (!lead || lead.temperatura_por === "jimmy") return;
  const ult = await rest(`reunioes?lead_id=eq.${leadId}&temperatura=not.is.null&select=temperatura&order=data.desc,hora.desc&limit=1`);
  if (ult[0]) {
    await rest(`reunioes_leads?id=eq.${leadId}`, {
      method: "PATCH", body: JSON.stringify({ temperatura: ult[0].temperatura, atualizado_em: new Date().toISOString() }),
    });
  }
}

// ── gravação pelo assistente do Mac ──────────────────────────
const CAMPOS_REUNIAO = [
  "doc_id", "event_id", "data", "hora", "inicio", "fim", "duracao_min", "titulo", "tipo", "produto", "status",
  "status_por", "status_em", "temperatura", "temperatura_porque", "resumo", "objecoes", "proximos_passos", "nota",
  "perguntado_em", "remarcada_para",
];
function soCampos(obj: any, campos: string[]) {
  const o: Record<string, unknown> = {};
  for (const c of campos) if (obj && obj[c] !== undefined) o[c] = obj[c];
  return o;
}

async function gravarReunioes(lista: any[]) {
  let n = 0;
  for (const r of lista ?? []) {
    const chave = String(r?.chave ?? (r?.doc_id ? `doc:${r.doc_id}` : r?.event_id ? `evt:${r.event_id}` : ""));
    if (!/^(doc|evt):[A-Za-z0-9_-]{6,200}$/.test(chave)) throw new Recusa(`Reunião sem chave válida: ${r?.titulo ?? ""}`);
    let [antes] = await rest(`reunioes?chave=eq.${enc(chave)}&select=*`);
    // documento novo de um evento já registrado sem gravação: fica com a chave do documento
    if (!antes && r.event_id) {
      const [velha] = await rest(`reunioes?event_id=eq.${enc(r.event_id)}&chave=neq.${enc(chave)}&select=*`);
      if (velha) {
        antes = velha;
        await rest(`reunioes?chave=eq.${enc(velha.chave)}`, { method: "DELETE" });
      }
    }
    const campos: any = { ...soCampos(antes, CAMPOS_REUNIAO), ...soCampos(r, CAMPOS_REUNIAO) };
    if (antes?.status_por === "jimmy" && !(antes.status === "sem_gravacao" && r.status === "realizada")) {
      campos.status = antes.status;
      campos.status_por = "jimmy";
      campos.status_em = antes.status_em;
    }
    if (antes?.perguntado_em) campos.perguntado_em = antes.perguntado_em;
    const leadId = r.lead ? await acharOuCriarLead(r.lead, r.produto ?? null) : antes?.lead_id ?? null;
    const linha = { chave, lead_id: leadId, ...campos, atualizado_em: new Date().toISOString() };
    await rest("reunioes?on_conflict=chave", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linha),
    });
    if (leadId) await atualizarTemperaturaDoLead(leadId);
    n++;
  }
  return n;
}

async function leadDaReuniao(chave: string | null): Promise<string | null> {
  if (!chave) return null;
  const [r] = await rest(`reunioes?chave=eq.${enc(chave)}&select=lead_id`);
  return r?.lead_id ?? null;
}

async function criarLembrete(l: any) {
  const linha = {
    texto: texto(l?.texto, 1000),
    quando: quandoValido(l?.quando),
    reuniao: l?.reuniao ? String(l.reuniao) : null,
    lead_id: l?.lead_id && UUID.test(String(l.lead_id)) ? l.lead_id : await leadDaReuniao(l?.reuniao ?? null),
    lead: texto(l?.lead, 200),
    telefone: digitos(l?.telefone) || null,
    origem: texto(l?.origem, 40),
    origem_texto: texto(l?.origem_texto, 300),
  };
  if (!linha.texto) throw new Recusa("Lembrete sem texto.");
  if (linha.reuniao) {
    const [existe] = await rest(`reunioes?chave=eq.${enc(linha.reuniao)}&select=chave`);
    if (!existe) linha.reuniao = null;
  }
  const [novo] = await rest("reunioes_lembretes", { method: "POST", body: JSON.stringify(linha) });
  return novo;
}

async function gravarLembretes(lista: any[]) {
  const criados: any[] = [];
  for (const l of lista ?? []) {
    // mesmo texto para a mesma reunião: não repete
    if (l?.reuniao) {
      const iguais = await rest(`reunioes_lembretes?reuniao=eq.${enc(String(l.reuniao))}&select=texto`);
      if (iguais.some((x: any) => normalizar(x.texto) === normalizar(l.texto))) continue;
    }
    criados.push(await criarLembrete(l));
  }
  return criados;
}

// alterações pontuais do ciclo (status, envio, adiamento, pergunta respondida)
const PATCH_LEMBRETE = ["texto", "quando", "status", "enviado_em", "feito_em", "apagado_em", "adiamentos"];
const PATCH_REUNIAO = ["status", "status_por", "status_em", "perguntado_em", "remarcada_para", "temperatura", "resumo"];
async function patchLembrete(id: number, campos: any) {
  const c = soCampos(campos, PATCH_LEMBRETE);
  if (c.status !== undefined && !STATUS_LEMBRETE.includes(String(c.status))) throw new Recusa("Status de lembrete inválido.");
  if (c.quando !== undefined) c.quando = quandoValido(c.quando);
  const [l] = await rest(`reunioes_lembretes?id=eq.${id}`, {
    method: "PATCH", body: JSON.stringify({ ...c, atualizado_em: new Date().toISOString() }),
  });
  if (!l) throw new Recusa("Lembrete não encontrado.", 404);
  return l;
}
async function patchReuniao(chave: string, campos: any) {
  const c = soCampos(campos, PATCH_REUNIAO);
  if (c.status !== undefined && !STATUS_REUNIAO.includes(String(c.status))) throw new Recusa("Status de reunião inválido.");
  if (c.temperatura !== undefined && c.temperatura !== null && !TEMPERATURAS.includes(String(c.temperatura))) throw new Recusa("Temperatura inválida.");
  const [r] = await rest(`reunioes?chave=eq.${enc(chave)}`, {
    method: "PATCH", body: JSON.stringify({ ...c, atualizado_em: new Date().toISOString() }),
  });
  if (!r) throw new Recusa("Reunião não encontrada.", 404);
  if (c.temperatura !== undefined && r.lead_id) await atualizarTemperaturaDoLead(r.lead_id);
  return r;
}

// ── painel ───────────────────────────────────────────────────
async function salvarLead(b: any) {
  const id = idLead(b.id);
  const c: Record<string, unknown> = {};
  if (b.nome !== undefined) {
    const n = texto(b.nome, 200);
    if (!n) throw new Recusa("O nome não pode ficar vazio.");
    c.nome = n;
  }
  if (b.telefone !== undefined) {
    if (!String(b.telefone ?? "").trim()) c.telefone = null;
    else {
      const t = normalizarNumero(b.telefone);
      if (!t.numero) throw new Recusa(t.motivo || "Telefone inválido.");
      c.telefone = t.numero;
    }
  }
  if (b.cidade !== undefined) c.cidade = texto(b.cidade, 120);
  if (b.empresa !== undefined) c.empresa = texto(b.empresa, 200);
  if (b.produto !== undefined) c.produto = texto(b.produto, 40);
  if (b.instancia !== undefined) c.instancia = texto(b.instancia, 80);
  if (b.situacao !== undefined) {
    if (!SITUACOES.includes(String(b.situacao))) throw new Recusa("Situação inválida.");
    c.situacao = b.situacao;
  }
  if (b.temperatura !== undefined) {
    if (b.temperatura !== null && !TEMPERATURAS.includes(String(b.temperatura))) throw new Recusa("Temperatura inválida.");
    c.temperatura = b.temperatura;
    c.temperatura_por = "jimmy";
  }
  c.atualizado_em = new Date().toISOString();
  const [l] = await rest(`reunioes_leads?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(c) });
  if (!l) throw new Recusa("Lead não encontrado.", 404);
  return l;
}

// só nome, estado e número — o token da instância nunca sai daqui
async function evo(path: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${EVO_URL}${path}`, {
      ...init, signal: ctrl.signal, headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    });
    const txt = await r.text();
    let body: any = null;
    try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
    return { ok: r.ok, status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}
async function instancias() {
  if (!EVO_URL || !EVO_KEY) throw new Recusa("A Evolution não está configurada nesta função.", 500);
  let r;
  try { r = await evo("/instance/fetchInstances", { method: "GET" }); } catch {
    throw new Recusa("Não consegui falar com a Evolution agora. Tente de novo em instantes.", 502);
  }
  if (!r.ok || !Array.isArray(r.body)) throw new Recusa(`A Evolution não devolveu as instâncias (erro ${r.status}).`, 502);
  return r.body.map((x: any) => ({
    nome: String(x?.name ?? ""),
    estado: String(x?.connectionStatus ?? "desconhecido"),
    numero: String(x?.ownerJid ?? "").split("@")[0].replace(/\D/g, ""),
    perfil: x?.profileName || null,
  })).filter((i: any) => i.nome && i.nome !== "1575")   // o 1575 é o canal do assistente com o Jimmy
    .sort((a: any, b: any) => Number(b.estado === "open") - Number(a.estado === "open") || a.nome.localeCompare(b.nome));
}

function resumoErro(body: any): string {
  let m: any = body?.response?.message ?? body?.message ?? body?.error ?? body;
  if (Array.isArray(m)) m = m.map((x: any) => typeof x === "string" ? x : x?.exists === false ? "número sem WhatsApp" : JSON.stringify(x)).join("; ");
  if (typeof m !== "string") m = JSON.stringify(m ?? "");
  return String(m).replace(/\s+/g, " ").trim().slice(0, 160) || "sem detalhe";
}

async function enviar(b: any) {
  const leadId = idLead(b.lead_id);
  const msg = texto(b.texto, 4096);
  if (!msg) throw new Recusa("Escreva a mensagem.");
  const inst = texto(b.instancia, 80);
  if (!inst) throw new Recusa("Escolha de qual WhatsApp sai a mensagem.");
  const [lead] = await rest(`reunioes_leads?id=eq.${leadId}&select=id,telefone`);
  if (!lead) throw new Recusa("Lead não encontrado.", 404);
  const t = normalizarNumero(lead.telefone);
  if (!t.numero) throw new Recusa("Este lead não tem telefone. Edite o lead e coloque o WhatsApp.");
  let status = "ok";
  let erro: string | null = null;
  try {
    const r = await evo(`/message/sendText/${enc(inst)}`, {
      method: "POST", body: JSON.stringify({ number: t.numero, text: msg, delay: 1200, linkPreview: true }),
    }, 60_000);
    if (!r.ok) {
      status = "erro";
      const semWhats = Array.isArray(r.body?.response?.message) && r.body.response.message.some((x: any) => x?.exists === false);
      erro = semWhats ? "Este número não tem WhatsApp" : r.status === 404 ? "Essa instância não existe na Evolution" : resumoErro(r.body);
    }
  } catch {
    status = "incerto";
    erro = "Sem confirmação da Evolution (pode ter saído)";
  }
  await rest("reunioes_envios", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ lead_id: leadId, telefone: t.numero, instancia: inst, texto: msg, status, erro }),
  });
  if (status === "ok") {
    await rest(`reunioes_leads?id=eq.${leadId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ instancia: inst, atualizado_em: new Date().toISOString() }),
    });
  }
  return { status, erro };
}

// ── roteamento ───────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { /* vazio */ }
  const acao = String(b?.action ?? "");

  try {
    const maquina = await ehAssistente(req);
    const uid = maquina ? null : await usuario(req);
    if (!maquina && !uid) return json({ error: "Sua sessão expirou. Entre de novo no painel." }, 401);

    if (acao === "estado") return json(await estado());

    // assistente do Mac (transcrições e ciclo do WhatsApp)
    if (maquina) {
      if (acao === "gravar") {
        const reunioes = await gravarReunioes(b.reunioes ?? []);
        const lembretes = await gravarLembretes(b.lembretes ?? []);
        return json({ reunioes, lembretes });
      }
      if (acao === "lembrete_criar") return json({ lembrete: await criarLembrete(b.lembrete) });
      if (acao === "lembrete_patch") return json({ lembrete: await patchLembrete(idLembrete(b.id), b.campos ?? {}) });
      if (acao === "reuniao_patch") return json({ reuniao: await patchReuniao(String(b.chave ?? ""), b.campos ?? {}) });
      return json({ error: "Ação inválida." }, 400);
    }

    // painel /reunioes
    if (acao === "lead_salvar") return json({ lead: await salvarLead(b) });
    if (acao === "lead_remover") {
      const id = idLead(b.id);
      const r = await rest(`reunioes_leads?id=eq.${id}`, { method: "DELETE" });
      if (!r?.length) throw new Recusa("Lead não encontrado.", 404);
      return json({ ok: true });
    }
    if (acao === "reuniao_salvar") {
      const campos: any = {};
      if (b.status !== undefined) Object.assign(campos, { status: b.status, status_por: "jimmy", status_em: new Date().toISOString() });
      if (b.temperatura !== undefined) campos.temperatura = b.temperatura;
      if (b.resumo !== undefined) campos.resumo = texto(b.resumo, 4000);
      return json({ reuniao: await patchReuniao(String(b.chave ?? ""), campos) });
    }
    if (acao === "reuniao_remover") {
      const r = await rest(`reunioes?chave=eq.${enc(String(b.chave ?? ""))}`, { method: "DELETE" });
      if (!r?.length) throw new Recusa("Reunião não encontrada.", 404);
      return json({ ok: true });
    }
    if (acao === "lembrete_criar") return json({ lembrete: await criarLembrete({ ...b, origem: "painel" }) });
    if (acao === "lembrete_salvar") {
      const id = idLembrete(b.id);
      const campos: any = {};
      const agora = new Date().toISOString();
      if (b.texto !== undefined) campos.texto = texto(b.texto, 1000);
      if (b.quando !== undefined) {
        const [l] = await rest(`reunioes_lembretes?id=eq.${id}&select=quando,adiamentos`);
        if (!l) throw new Recusa("Lembrete não encontrado.", 404);
        campos.quando = quandoValido(b.quando);
        campos.status = "pendente";
        campos.enviado_em = null;
        campos.adiamentos = [...(l.adiamentos ?? []), { de: l.quando, em: agora, por: "painel" }];
      }
      if (b.status === "feito") Object.assign(campos, { status: "feito", feito_em: agora });
      if (b.status === "apagado") Object.assign(campos, { status: "apagado", apagado_em: agora });
      if (b.status === "pendente") Object.assign(campos, { status: "pendente", feito_em: null, apagado_em: null });
      return json({ lembrete: await patchLembrete(id, campos) });
    }
    if (acao === "comentar") {
      const t = texto(b.texto, 4000);
      if (!t) throw new Recusa("Escreva o comentário.");
      const [c] = await rest("reunioes_comentarios", { method: "POST", body: JSON.stringify({ lead_id: idLead(b.lead_id), texto: t }) });
      return json({ comentario: c });
    }
    if (acao === "comentario_remover") {
      const id = idLembrete(b.id);
      await rest(`reunioes_comentarios?id=eq.${id}`, { method: "DELETE" });
      return json({ ok: true });
    }
    if (acao === "instancias") return json({ instancias: await instancias() });
    if (acao === "enviar") return json(await enviar(b));
    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    console.error("reunioes:", acao, e instanceof Error ? e.message : e);
    return json({ error: "Não deu certo agora. Tente de novo em instantes." }, 500);
  }
});
