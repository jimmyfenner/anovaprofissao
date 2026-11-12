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
import { normalizarRepeticao, proximaOcorrencia } from "../_shared/repeticao.mjs";
import { idDrive, normalizarMomentos } from "../_shared/momentos.mjs";
import { cobertosPelaMensagem, normalizarEncaminhado } from "../_shared/encaminhar.mjs";
import {
  faltaAutorizar, faltaParaAprovar, macPode, marcarUsados, montarTrechos, normalizarDestinos,
  normalizarPublicacao, normalizarTitulo, rotuloUsado,
} from "../_shared/shorts.mjs";

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// token do iGreen Turbo (Configurações > Gerar token, workspace do Jimmy): agenda a mensagem de
// follow-up lá, no contato do lead, e o Turbo é quem manda (rota /api/public/extension/schedule)
const TURBO = "https://igreenturbo.com.br";
const TURBO_TOKEN = Deno.env.get("TURBO_TOKEN") ?? "";

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
const SHORT_OK = ["pedido", "sim", "nao"];
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
// link da conversa no iGreen Turbo: só https://igreenturbo.com.br/..., sem o www
function linkTurbo(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new Recusa("Link do Turbo inválido. Cole o endereço da conversa aberta no Turbo.");
  }
  if (!/^(www\.)?igreenturbo\.com\.br$/i.test(u.hostname)) {
    throw new Recusa("O link precisa ser do iGreen Turbo (igreenturbo.com.br).");
  }
  if (u.pathname.length < 2) throw new Recusa("Esse é o endereço do site. Abra a conversa com o lead no Turbo e copie o endereço dela.");
  const final = `https://igreenturbo.com.br${u.pathname}${u.search}`;
  if (final.length > 520 || /\s/.test(final)) throw new Recusa("Link do Turbo inválido.");
  return final;
}
function linkTurboOuNada(v: unknown): string | null {
  try {
    return linkTurbo(v);
  } catch {
    return null;
  }
}
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
async function estado(comLinks = false) {
  const [leads, reunioes, lembretes, comentarios, envios, shorts] = await Promise.all([
    rest("reunioes_leads?select=*&order=atualizado_em.desc"),
    rest("reunioes?select=*&order=data.desc,hora.desc"),
    rest("reunioes_lembretes?select=*&order=quando.asc&limit=2000"),
    rest("reunioes_comentarios?select=*&order=criado_em.desc&limit=2000"),
    rest("reunioes_envios?select=*&order=criado_em.desc&limit=500"),
    rest("reunioes_shorts?select=*&order=criado_em.desc&limit=60"),
  ]);
  const porId = new Map(leads.map((l: any) => [l.id, l]));
  // o assistente do Mac usa `lead` dentro da reunião (nome, telefone…)
  for (const r of reunioes) {
    const l: any = porId.get(r.lead_id);
    r.lead = l ? { id: l.id, nome: l.nome, telefone: l.telefone, turbo_url: l.turbo_url ?? null, cidade: l.cidade, empresa: l.empresa, situacao: l.situacao, short_ok: l.short_ok ?? null } : null;
  }
  // prévia dos shorts: link assinado de 2 h só para o painel (o bucket é privado)
  if (comLinks) {
    await Promise.all(shorts.filter((s: any) => s.video && s.status !== "descartado").slice(0, 12).map(async (s: any) => {
      s.video_url = await linkVideo(s.video).catch(() => null);
    }));
  }
  return { leads, reunioes, lembretes, comentarios, envios, shorts };
}

// ── shorts pedidos no painel (migração 29, regras em _shared/shorts.mjs) ──
const BUCKET_SHORTS = "reunioes-shorts";
async function storage(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/storage/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const txt = await r.text();
  let body: any = txt;
  try { body = JSON.parse(txt); } catch { /* texto */ }
  return { ok: r.ok, status: r.status, body };
}
async function linkVideo(path: string): Promise<string | null> {
  const r = await storage(`object/sign/${BUCKET_SHORTS}/${path}`, { method: "POST", body: JSON.stringify({ expiresIn: 7200 }) });
  return r.ok && r.body?.signedURL ? `${SB_URL}/storage/v1${r.body.signedURL}` : null;
}
async function videosDo(id: string): Promise<string[]> {
  const r = await storage(`object/list/${BUCKET_SHORTS}`, { method: "POST", body: JSON.stringify({ prefix: id, limit: 100, offset: 0 }) });
  return Array.isArray(r.body) ? r.body.map((o: any) => `${id}/${o?.name}`).filter((p: string) => /\/v\d{1,3}\.mp4$/.test(p)) : [];
}
async function videoNoAr(path: string): Promise<boolean> {
  return (await videosDo(path.split("/")[0])).includes(path);
}
// as regras puras erram com Error comum; aqui viram recusa com a mensagem para o painel
function pura<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new Recusa(e instanceof Error ? e.message : "Dados inválidos.");
  }
}
function idShort(v: unknown): string {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Recusa("Short inválido.");
  return s;
}
async function lerShort(id: string) {
  const [s] = await rest(`reunioes_shorts?id=eq.${id}&select=*`);
  if (!s) throw new Recusa("Short não encontrado.", 404);
  return s;
}
// muda só se o status ainda for um dos esperados (o Mac e o painel podem mexer ao mesmo tempo)
async function patchShort(id: string, campos: Record<string, unknown>, deStatus: string[]) {
  const agora = new Date().toISOString();
  if (campos.status) campos.status_em = agora;
  const [s] = await rest(`reunioes_shorts?id=eq.${id}&status=in.(${deStatus.join(",")})`, {
    method: "PATCH", body: JSON.stringify({ ...campos, atualizado_em: agora }),
  });
  if (!s) throw new Recusa("Este short mudou enquanto isso. Atualize a página.", 409);
  return s;
}
const leadsCurtos = () => rest("reunioes_leads?select=id,nome,short_ok");

async function criarShort(b: any) {
  const [reunioes, leads] = await Promise.all([
    rest("reunioes?momentos=not.is.null&select=chave,lead_id,data,hora,titulo,gravacao_id,doc_id,momentos"),
    leadsCurtos(),
  ]);
  const trechos = pura(() => montarTrechos(b.itens, reunioes, leads));
  const titulo = pura(() => normalizarTitulo(b.titulo));
  const [s] = await rest("reunioes_shorts", {
    method: "POST",
    body: JSON.stringify({ trechos, titulo, pedido: texto(b.pedido, 1000), destinos: { youtube: true, instagram: true } }),
  });
  return s;
}
async function aprovarShort(b: any) {
  const id = idShort(b.id);
  const [s, leads] = await Promise.all([lerShort(id), leadsCurtos()]);
  const publicacao = pura(() => normalizarPublicacao(b.publicacao ?? s.publicacao));
  const destinos = normalizarDestinos(b.destinos ?? s.destinos);
  const falta = faltaParaAprovar({ ...s, publicacao, destinos }, leads);
  if (falta.length) throw new Recusa(falta.join(" "));
  return patchShort(id, { status: "aprovado", publicacao, destinos, aprovado_em: new Date().toISOString(), erro: null }, ["pronto"]);
}
async function apagarVideos(id: string) {
  const nomes = await videosDo(id);
  if (nomes.length) await storage(`object/${BUCKET_SHORTS}`, { method: "DELETE", body: JSON.stringify({ prefixes: nomes }) });
}

// passos do Mac: montando → pronto (com a prévia no bucket) · aprovado → publicando → publicado · erro
async function marcarShort(b: any) {
  const id = idShort(b.id);
  const s = await lerShort(id);
  const para = String(b.status ?? "");
  if (!macPode(s.status, para)) throw new Recusa(`Passo inválido: ${s.status} → ${para}.`, 409);
  const c: Record<string, unknown> = { status: para };
  if (para === "montando") c.erro = null;
  if (para === "pronto") {
    const v = String(b.video ?? "");
    const m = new RegExp(`^${id}/v(\\d{1,3})\\.mp4$`).exec(v);
    if (!m || !(await videoNoAr(v))) throw new Recusa("A prévia não está no bucket: suba antes de marcar pronto.");
    c.video = v;
    c.versao = Number(m[1]);
    const d = Number(b.duracao);
    c.duracao = Number.isFinite(d) && d > 0 && d < 600 ? Math.round(d * 10) / 10 : null;
    if (Array.isArray(b.roteiro)) c.roteiro = b.roteiro.slice(0, 30);
    if (b.publicacao !== undefined) c.publicacao = pura(() => normalizarPublicacao(b.publicacao));
  }
  if (para === "publicando") {
    // confere de novo na hora de publicar: alguém pode ter mudado a autorização depois da aprovação
    const falta = faltaAutorizar(s.trechos, await leadsCurtos());
    if (falta.length) throw new Recusa(`Falta o ok para aparecer: ${falta.join(", ")}.`, 409);
    if (!s.aprovado_em) throw new Recusa("O short não foi aprovado no painel.", 409);
  }
  if (para === "publicado") {
    const link = (v: unknown) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be|instagram\.com)\/\S{3,300}$/.test(String(v ?? "")) ? String(v) : null;
    c.publicado = { youtube: link(b.publicado?.youtube), instagram: link(b.publicado?.instagram) };
    c.erro = null;
  }
  if (para === "erro") c.erro = texto(b.erro, 1000) ?? "Falhou sem detalhe.";
  const novo = await patchShort(id, c, [s.status]);
  if (para === "publicado") await marcarTrechosUsados(novo);
  return novo;
}
async function marcarTrechosUsados(s: any) {
  const rotulo = rotuloUsado(s);
  const porReuniao = new Map<string, any[]>();
  for (const t of s.trechos ?? []) porReuniao.set(t.chave, [...(porReuniao.get(t.chave) ?? []), t]);
  for (const [chave, ts] of porReuniao) {
    const [r] = await rest(`reunioes?chave=eq.${enc(chave)}&select=momentos`);
    if (!r?.momentos) continue;
    const m = marcarUsados(r.momentos, ts, rotulo);
    if (m.marcados) await patchReuniao(chave, { momentos: m.momentos });
  }
}
async function linkDeUpload(id: string) {
  const s = await lerShort(id);
  if (s.status !== "montando") throw new Recusa("A prévia só sobe durante a montagem.", 409);
  const path = `${id}/v${Number(s.versao ?? 0) + 1}.mp4`;
  const r = await storage(`object/upload/sign/${BUCKET_SHORTS}/${path}`, { method: "POST", body: "{}", headers: { "x-upsert": "true" } });
  if (!r.ok || !r.body?.url) throw new Recusa(`Não consegui preparar o envio da prévia (${r.status}).`, 502);
  return { path, upload: `${SB_URL}/storage/v1${r.body.url}` };
}

// ── leads: achar ou criar pelo telefone, senão pelo nome ─────
async function acharOuCriarLead(dados: any, produto: string | null): Promise<string | null> {
  const nome = texto(dados?.nome, 200);
  if (!nome) return null;
  const tel = digitos(dados?.telefone) || null;
  const turbo = linkTurboOuNada(dados?.turbo_url);
  let lead: any = null;
  if (tel) {
    const v = variantes(tel);
    const r = await rest(`reunioes_leads?select=*&telefone=in.(${v.map(enc).join(",")})&limit=1`);
    lead = r[0] ?? null;
  }
  if (!lead) {
    // pelo nome: só se o lead achado não tiver outro telefone
    const todos = await rest("reunioes_leads?select=id,nome,telefone,turbo_url,cidade,empresa,produto");
    lead = todos.find((l: any) => normalizar(l.nome) === normalizar(nome) && (!tel || !l.telefone || variantes(tel).includes(l.telefone))) ?? null;
  }
  if (!lead) {
    const novo = await rest("reunioes_leads", {
      method: "POST",
      body: JSON.stringify({
        nome, telefone: tel, turbo_url: turbo, cidade: texto(dados?.cidade, 120), empresa: texto(dados?.empresa, 200), produto,
      }),
    });
    return novo[0].id;
  }
  const campos: Record<string, unknown> = {};
  if (tel && !lead.telefone) campos.telefone = tel;
  if (turbo && !lead.turbo_url) campos.turbo_url = turbo;
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
  "perguntado_em", "remarcada_para", "gravacao_id",
];
function soCampos(obj: any, campos: string[]) {
  const o: Record<string, unknown> = {};
  for (const c of campos) if (obj && obj[c] !== undefined) o[c] = obj[c];
  return o;
}

// Momentos para short: a rotina só preenche reunião que ainda não tem (null). Depois disso quem mexe é
// o Jimmy (painel) ou a sessão dos shorts (marca "usado"), e uma nova leitura não apaga o que fizeram.
function momentosOuRecusa(v: unknown) {
  try {
    return normalizarMomentos(v);
  } catch (e) {
    throw new Recusa(e instanceof Error ? e.message : "Momentos inválidos.");
  }
}

async function gravarReunioes(lista: any[]) {
  let n = 0;
  let descartados = 0;
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
    if (r.gravacao_id !== undefined) campos.gravacao_id = idDrive(r.gravacao_id) ?? antes?.gravacao_id ?? null;
    if (antes?.momentos != null) campos.momentos = antes.momentos;
    else if (r.momentos !== undefined) {
      const m = momentosOuRecusa(r.momentos);
      campos.momentos = m.momentos;
      descartados += m.descartados;
    }
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
  return { n, descartados };
}

async function leadDaReuniao(chave: string | null): Promise<string | null> {
  if (!chave) return null;
  const [r] = await rest(`reunioes?chave=eq.${enc(chave)}&select=lead_id`);
  return r?.lead_id ?? null;
}

// Lembrete (sempre com hora, pode se repetir) ou tarefa (lista do que fazer; prazo opcional).
// Repetido sem "quando": a primeira vez sai da regra. Tarefa só avisa na hora se pedir (avisar).
function regraOuRecusa(regra: unknown, base: unknown) {
  try {
    return normalizarRepeticao(regra, base ?? undefined);
  } catch (e) {
    throw new Recusa(e instanceof Error ? e.message : "Repetição inválida.");
  }
}
async function criarLembrete(l: any) {
  const tipo = l?.tipo === "tarefa" ? "tarefa" : "lembrete";
  const regra = tipo === "lembrete" && l?.repetir ? regraOuRecusa(l.repetir, l?.quando) : null;
  let quando: string | null = null;
  if (l?.quando) quando = quandoValido(l.quando);
  else if (regra) quando = proximaOcorrencia(regra, new Date()).toISOString();
  else if (tipo === "lembrete") throw new Recusa("Diga quando lembrar.");
  const linha = {
    tipo,
    repetir: regra,
    avisar: tipo === "lembrete" ? true : Boolean(l?.avisar === true && quando),
    texto: texto(l?.texto, 1000),
    quando,
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
const PATCH_LEMBRETE = ["texto", "quando", "status", "enviado_em", "feito_em", "apagado_em", "adiamentos", "tipo", "avisar", "repetir", "encaminhado"];
const PATCH_REUNIAO = ["status", "status_por", "status_em", "perguntado_em", "remarcada_para", "temperatura", "resumo", "momentos", "gravacao_id"];
async function patchLembrete(id: number, campos: any) {
  const c = soCampos(campos, PATCH_LEMBRETE);
  if (c.status !== undefined && !STATUS_LEMBRETE.includes(String(c.status))) throw new Recusa("Status de lembrete inválido.");
  if (c.quando !== undefined && c.quando !== null) c.quando = quandoValido(c.quando);
  if (c.tipo !== undefined && !["lembrete", "tarefa"].includes(String(c.tipo))) throw new Recusa("Tipo inválido.");
  if (c.repetir !== undefined && c.repetir !== null) c.repetir = regraOuRecusa(c.repetir, c.quando);
  if (c.avisar !== undefined) c.avisar = c.avisar === true;
  if (c.encaminhado !== undefined) c.encaminhado = pura(() => normalizarEncaminhado(c.encaminhado));
  // voltou a pendente (adiado, reaberto, repetido que passou para a próxima vez): volta para a fila do que fazer
  else if (c.status === "pendente") c.encaminhado = null;
  const [l] = await rest(`reunioes_lembretes?id=eq.${id}`, {
    method: "PATCH", body: JSON.stringify({ ...c, atualizado_em: new Date().toISOString() }),
  });
  if (!l) throw new Recusa("Lembrete não encontrado.", 404);
  return l;
}
async function lerLembrete(id: number) {
  const [l] = await rest(`reunioes_lembretes?id=eq.${id}&select=*`);
  if (!l) throw new Recusa("Lembrete não encontrado.", 404);
  return l;
}
// Mandou no WhatsApp: o que se repete vai para a próxima vez e continua pendente; o resto fica "enviado".
async function lembreteEnviado(id: number) {
  const l = await lerLembrete(id);
  const agora = new Date();
  if (l.repetir) {
    const base = l.quando && Date.parse(l.quando) > agora.getTime() ? new Date(l.quando) : agora;
    return patchLembrete(id, { quando: proximaOcorrencia(l.repetir, base).toISOString(), enviado_em: agora.toISOString(), status: "pendente" });
  }
  return patchLembrete(id, { status: "enviado", enviado_em: agora.toISOString() });
}
// Pula a próxima vez de um lembrete que se repete (o painel e o "pular" do WhatsApp).
async function lembretePular(id: number) {
  const l = await lerLembrete(id);
  if (!l.repetir) throw new Recusa("Esse lembrete não se repete.");
  const agora = new Date();
  const base = l.quando && Date.parse(l.quando) > agora.getTime() ? new Date(l.quando) : agora;
  return patchLembrete(id, { quando: proximaOcorrencia(l.repetir, base).toISOString(), status: "pendente", enviado_em: null });
}
async function patchReuniao(chave: string, campos: any) {
  const c = soCampos(campos, PATCH_REUNIAO);
  if (c.status !== undefined && !STATUS_REUNIAO.includes(String(c.status))) throw new Recusa("Status de reunião inválido.");
  if (c.temperatura !== undefined && c.temperatura !== null && !TEMPERATURAS.includes(String(c.temperatura))) throw new Recusa("Temperatura inválida.");
  if (c.momentos !== undefined) {
    // edição à mão (painel, sessão dos shorts): nada some calado
    const m = momentosOuRecusa(c.momentos);
    if (m.descartados) throw new Recusa("Algum momento ficou sem tempo, tipo ou texto válido.");
    c.momentos = m.momentos;
  }
  if (c.gravacao_id !== undefined) {
    if (c.gravacao_id !== null && c.gravacao_id !== "" && !idDrive(c.gravacao_id)) throw new Recusa("Link da gravação inválido.");
    c.gravacao_id = idDrive(c.gravacao_id);
  }
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
  if (b.turbo_url !== undefined) c.turbo_url = linkTurbo(b.turbo_url);
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
  if (b.short_ok !== undefined) {
    const v = b.short_ok === "" ? null : b.short_ok;
    if (v !== null && !SHORT_OK.includes(String(v))) throw new Recusa("Autorização inválida.");
    c.short_ok = v;
    c.short_ok_em = v ? new Date().toISOString() : null;
  }
  c.atualizado_em = new Date().toISOString();
  const [l] = await rest(`reunioes_leads?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(c) });
  if (!l) throw new Recusa("Lead não encontrado.", 404);
  return l;
}

// ── follow-up agendado no iGreen Turbo ───────────────────────
const ERROS_TURBO: Record<string, string> = {
  contact_not_found: "Esse lead não está no Turbo (ou o link é de outro workspace). Confira o link da conversa.",
  no_instance: "A conversa desse lead no Turbo está sem número de WhatsApp ligado.",
  unauthorized: "O token do Turbo foi recusado. Gere outro em Configurações no Turbo.",
};
async function turbo(path: string, corpo?: unknown) {
  if (!TURBO_TOKEN) throw new Recusa("Falta ligar o Turbo: o token ainda não foi gravado nesta função.", 503);
  let r: Response;
  try {
    r = await fetch(`${TURBO}${path}`, {
      method: corpo === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TURBO_TOKEN}` },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Recusa("O Turbo não respondeu. Tente de novo em instantes.", 502);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const cod = r.status === 401 ? "unauthorized" : String(j.error ?? "");
    throw new Recusa(ERROS_TURBO[cod] ?? j.message ?? `O Turbo recusou (${r.status}).`, r.status >= 500 ? 502 : 400);
  }
  return j;
}
const contatoDoTurbo = (url: unknown) => {
  const m = String(url ?? "").match(/[?&]contact=([0-9a-f-]{36})\b/i);
  return m && UUID.test(m[1]) ? m[1] : null;
};

async function agendar(b: any) {
  const id = idLead(b.lead_id);
  const [lead] = await rest(`reunioes_leads?id=eq.${id}&select=id,telefone,turbo_url,instancia`);
  if (!lead) throw new Recusa("Lead não encontrado.", 404);
  const contato = contatoDoTurbo(lead.turbo_url);
  if (!contato && !lead.telefone) throw new Recusa("Ponha o telefone ou o link da conversa no Turbo antes de agendar.");
  const msg = texto(b.texto, 4000);
  if (!msg) throw new Recusa("Escreva a mensagem.");
  const j = await turbo("/api/public/extension/schedule", {
    action: "create",
    ...(contato ? { contact_id: contato } : { phone: lead.telefone, instance_name: lead.instancia ?? null }),
    message: msg,
    scheduled_at: quandoValido(b.quando),
    cancel_on_inbound: b.cancelar_se_responder === true,
  });
  // achou a conversa pelo telefone: guarda o link, para a próxima já ir direto
  if (!contato && j.item?.contact_id) {
    await rest(`reunioes_leads?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ turbo_url: `${TURBO}/app/inbox?contact=${j.item.contact_id}`, atualizado_em: new Date().toISOString() }),
    });
  }
  const encaminhados = await encaminhar(id, {
    como: "agendada", para: j.item?.scheduled_at ?? b.quando, agendada_id: j.item?.id ?? null, texto: msg, lembrete_id: b.lembrete_id,
  }).catch((e) => { console.error("reunioes encaminhar", e instanceof Error ? e.message : e); return []; });
  return { item: { ...j.item, lead_id: id }, encaminhados };
}

// O Jimmy agiu sobre o lead (agendou ou mandou mensagem): os lembretes abertos dele que a mensagem cobre
// saem da fila do que fazer (regra em _shared/encaminhar.mjs). Devolve os ids marcados.
async function encaminhar(leadId: string, info: { como: string; para?: unknown; agendada_id?: unknown; texto?: string | null; lembrete_id?: unknown }) {
  const lista = await rest(`reunioes_lembretes?lead_id=eq.${leadId}&status=in.(pendente,enviado)&select=id,status,quando,repetir,encaminhado`);
  const lid = Number(info.lembrete_id);
  const ids = cobertosPelaMensagem(lista, { para: info.para ? String(info.para) : null, lembreteId: Number.isInteger(lid) && lid > 0 ? lid : null });
  if (!ids.length) return [];
  const encaminhado = normalizarEncaminhado({ como: info.como, para: info.para, agendada_id: info.agendada_id, texto: info.texto, em: new Date().toISOString() });
  await rest(`reunioes_lembretes?id=in.(${ids.join(",")})`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ encaminhado, atualizado_em: new Date().toISOString() }),
  });
  return ids;
}

// as agendadas de todos os leads com link do Turbo, numa chamada só
async function agendados() {
  if (!TURBO_TOKEN) return { items: [], aviso: "Turbo não ligado" };
  const leads = await rest("reunioes_leads?select=id,turbo_url&turbo_url=not.is.null");
  const porContato = new Map<string, string>();
  for (const l of leads) {
    const c = contatoDoTurbo(l.turbo_url);
    if (c) porContato.set(c, l.id);
  }
  if (!porContato.size) return { items: [] };
  const j = await turbo(`/api/public/extension/schedule?contact_ids=${[...porContato.keys()].join(",")}`);
  return { items: (j.items ?? []).map((i: any) => ({ ...i, lead_id: porContato.get(i.contact_id) ?? null })) };
}

// ── reunião nova (ou remarcada) direto no Google Agenda ───────
// Mesma agenda e mesma credencial do /agendar (contato@, GOOGLE_* nos segredos do projeto).
// O evento sai no formato dos que o Turbo cria ("(55…)" e o link da conversa na descrição),
// para o assistente do Mac ler telefone e Turbo dele, e a reunião entra no diário como
// "agendada". Quando a transcrição do Meet chegar, a rotina junta pelo event_id.
const AGENDA = () => Deno.env.get("AGENDA_CALENDAR_ID") ?? "primary";
const TZ = "America/Sao_Paulo";
let googleToken: { valor: string; ate: number } | null = null;
async function google(path: string, init: RequestInit = {}) {
  if (!googleToken || googleToken.ate < Date.now() + 60_000) {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
        refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN") ?? "",
        grant_type: "refresh_token",
      }),
    });
    if (!r.ok) throw new Recusa("O Google Agenda recusou o acesso. Avise o Claude.", 502);
    const j = await r.json();
    googleToken = { valor: j.access_token, ate: Date.now() + j.expires_in * 1000 };
  }
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${googleToken.valor}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
function diaHora(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}
const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}$/i;

async function marcarReuniao(b: any) {
  const id = idLead(b.lead_id);
  const [lead] = await rest(`reunioes_leads?id=eq.${id}&select=id,nome,telefone,turbo_url,instancia,produto`);
  if (!lead) throw new Recusa("Lead não encontrado.", 404);
  const inicio = new Date(quandoValido(b.inicio));
  if (inicio.getTime() < Date.now() - 5 * 60_000) throw new Recusa("Esse horário já passou.");
  const dur = Math.round(Number(b.duracao_min ?? 30));
  if (!Number.isFinite(dur) || dur < 15 || dur > 240) throw new Recusa("Duração entre 15 minutos e 4 horas.");
  const fim = new Date(inicio.getTime() + dur * 60_000);

  // a reunião que está sendo remarcada (ou a última do lead): título e convidados saem dela
  let antiga: any = null;
  if (b.de_chave) {
    [antiga] = await rest(`reunioes?chave=eq.${enc(String(b.de_chave))}&lead_id=eq.${id}&select=chave,event_id,titulo`);
    if (!antiga) throw new Recusa("Reunião de origem não encontrada.", 404);
  } else {
    [antiga] = await rest(`reunioes?lead_id=eq.${id}&event_id=not.is.null&select=chave,event_id,titulo&order=inicio.desc.nullslast&limit=1`);
  }
  let eventoAntigo: any = null;
  if (antiga?.event_id) {
    const g = await google(`/calendars/${encodeURIComponent(AGENDA())}/events/${encodeURIComponent(antiga.event_id)}`);
    if (g.ok) eventoAntigo = g.j;
  }
  const convidados = new Map<string, string | undefined>();
  if (b.copiar_convidados !== false) {
    for (const a of eventoAntigo?.attendees ?? []) {
      if (!a.self && !a.organizer && a.email && EMAIL.test(a.email)) convidados.set(a.email.toLowerCase(), a.displayName);
    }
  }
  for (const e of Array.isArray(b.convidados) ? b.convidados : []) {
    const m = String(e ?? "").trim().toLowerCase();
    if (!m) continue;
    if (!EMAIL.test(m)) throw new Recusa(`E-mail inválido: ${m}`);
    convidados.set(m, convidados.get(m));
  }
  if (convidados.size > 20) throw new Recusa("No máximo 20 convidados.");

  // horário ocupado: avisa antes, e o painel pergunta se marca mesmo assim
  if (b.forcar !== true) {
    const fb = await google("/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: inicio.toISOString(), timeMax: fim.toISOString(), timeZone: TZ, items: [{ id: AGENDA() }] }),
    });
    const ocupado = fb.ok ? (fb.j.calendars?.[AGENDA()]?.busy ?? []) : [];
    if (ocupado.length) return { conflito: true, ocupado };
  }

  const titulo = /^reuni[aã]o com /i.test(eventoAntigo?.summary ?? antiga?.titulo ?? "")
    ? (eventoAntigo?.summary ?? antiga.titulo)
    : `Reunião com ${lead.nome}${lead.instancia ? ` - ${lead.instancia}` : ""}`;
  const descricao = [
    `${antiga ? "Remarcada" : "Marcada"} pelo diário de reuniões (anovaprofissao.com.br/reunioes).`,
    "",
    `Lead: ${lead.nome}${lead.telefone ? ` (${lead.telefone})` : ""}`,
    lead.turbo_url ? `Conversa no Turbo: ${lead.turbo_url}` : "",
  ].filter((l, i) => l || i === 1).join("\n");
  const g = await google(
    `/calendars/${encodeURIComponent(AGENDA())}/events?conferenceDataVersion=1&sendUpdates=${convidados.size ? "all" : "none"}`,
    {
      method: "POST",
      body: JSON.stringify({
        summary: titulo,
        description: descricao,
        start: { dateTime: inicio.toISOString(), timeZone: TZ },
        end: { dateTime: fim.toISOString(), timeZone: TZ },
        attendees: [...convidados].map(([email, displayName]) => ({ email, ...(displayName ? { displayName } : {}) })),
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: true },
      }),
    },
  );
  if (!g.ok) {
    console.error("reunioes google insert", g.status, g.j?.error?.message);
    throw new Recusa("O Google Agenda não criou o evento. Tente de novo.", 502);
  }
  const ev = g.j;
  const meet = ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;
  const { data, hora } = diaHora(inicio);
  const agora = new Date().toISOString();
  // status_por "painel" (não "jimmy"): a rotina pode trocar para realizada quando a transcrição chegar
  const [nova] = await rest("reunioes", {
    method: "POST",
    body: JSON.stringify({
      chave: `evt:${ev.id}`, lead_id: id, event_id: ev.id, data, hora,
      inicio: inicio.toISOString(), fim: fim.toISOString(), duracao_min: dur,
      titulo, tipo: "lead", produto: lead.produto ?? null,
      status: "agendada", status_por: "painel", status_em: agora,
    }),
  });
  if (antiga && b.de_chave) {
    await rest(`reunioes?chave=eq.${enc(antiga.chave)}`, {
      method: "PATCH", body: JSON.stringify({ remarcada_para: inicio.toISOString(), atualizado_em: agora }),
    });
  }
  return { conflito: false, reuniao: nova, meet, convidados: convidados.size, link: ev.htmlLink ?? null };
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
  let encaminhados: number[] = [];
  if (status === "ok") {
    await rest(`reunioes_leads?id=eq.${leadId}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ instancia: inst, atualizado_em: new Date().toISOString() }),
    });
    // o pedido de autorização para short (e outras mensagens à parte) vem com encaminhar: false
    if (b.encaminhar !== false) {
      encaminhados = await encaminhar(leadId, { como: "enviada", texto: msg, lembrete_id: b.lembrete_id })
        .catch((e) => { console.error("reunioes encaminhar", e instanceof Error ? e.message : e); return []; });
    }
  }
  return { status, erro, encaminhados };
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

    if (acao === "estado") return json(await estado(!maquina));

    // assistente do Mac (transcrições e ciclo do WhatsApp)
    if (maquina) {
      // shorts pedidos no painel: a rotina shorts-do-painel pega a fila, sobe a prévia e anda com o status
      if (acao === "shorts_fila") {
        const [lista, leads] = await Promise.all([
          rest("reunioes_shorts?status=in.(fila,ajustar,aprovado,montando,publicando)&select=*&order=criado_em.asc"),
          leadsCurtos(),
        ]);
        return json({ shorts: lista.map((s: any) => ({ ...s, falta_autorizar: faltaAutorizar(s.trechos, leads) })) });
      }
      if (acao === "short_upload") return json(await linkDeUpload(idShort(b.id)));
      if (acao === "short_marcar") return json({ short: await marcarShort(b) });
      if (acao === "short_avisado") {
        const id = idShort(b.id);
        const [s] = await rest(`reunioes_shorts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ avisado: texto(b.avisado, 40) }) });
        if (!s) throw new Recusa("Short não encontrado.", 404);
        return json({ ok: true });
      }
      if (acao === "gravar") {
        const g = await gravarReunioes(b.reunioes ?? []);
        const lembretes = await gravarLembretes(b.lembretes ?? []);
        return json({ reunioes: g.n, lembretes, momentos_descartados: g.descartados });
      }
      if (acao === "lembrete_criar") return json({ lembrete: await criarLembrete(b.lembrete) });
      if (acao === "lembrete_patch") return json({ lembrete: await patchLembrete(idLembrete(b.id), b.campos ?? {}) });
      if (acao === "lembrete_enviado") return json({ lembrete: await lembreteEnviado(idLembrete(b.id)) });
      if (acao === "lembrete_pular") return json({ lembrete: await lembretePular(idLembrete(b.id)) });
      if (acao === "reuniao_patch") return json({ reuniao: await patchReuniao(String(b.chave ?? ""), b.campos ?? {}) });
      // só leitura: o Mac vê os follow-ups agendados no Turbo, mas não agenda nem cancela
      if (acao === "agendados") return json(await agendados());
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
      if (b.momentos !== undefined) campos.momentos = b.momentos;
      if (b.gravacao_id !== undefined) campos.gravacao_id = b.gravacao_id;
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
      if (b.pular === true) return json({ lembrete: await lembretePular(id) });
      if (b.texto !== undefined) campos.texto = texto(b.texto, 1000);
      // "Já encaminhei" (marca à mão) e "Voltar para a fila"
      if (b.encaminhado !== undefined) campos.encaminhado = b.encaminhado ? { como: "manual", em: agora } : null;
      if (b.tipo !== undefined) campos.tipo = b.tipo === "tarefa" ? "tarefa" : "lembrete";
      if (b.avisar !== undefined) campos.avisar = b.avisar === true;
      if (b.quando !== undefined) {
        const l = await lerLembrete(id);
        const tipoFinal = campos.tipo ?? l.tipo;
        if (b.quando === null || b.quando === "") {
          if (tipoFinal !== "tarefa") throw new Recusa("Lembrete precisa de data e hora.");
          campos.quando = null;
          campos.avisar = false;
        } else campos.quando = quandoValido(b.quando);
        campos.status = "pendente";
        campos.enviado_em = null;
        campos.adiamentos = [...(l.adiamentos ?? []), { de: l.quando, em: agora, por: "painel" }];
      }
      if (b.repetir !== undefined) {
        if (b.repetir === null) campos.repetir = null;
        else {
          const base = campos.quando ?? (await lerLembrete(id)).quando;
          campos.repetir = regraOuRecusa(b.repetir, base);
        }
      }
      if (campos.tipo === "tarefa") campos.repetir = null;
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
    if (acao === "agendar") return json(await agendar(b));
    if (acao === "reuniao_marcar") return json(await marcarReuniao(b));
    if (acao === "agendados") return json(await agendados());
    if (acao === "agendado_cancelar") {
      const idAg = String(b.id ?? "");
      const r = await turbo("/api/public/extension/schedule", { action: "cancel", id: idAg });
      // a mensagem não sai mais: o que ela cobria volta para a fila do que fazer
      const voltaram = /^[A-Za-z0-9_-]{1,80}$/.test(idAg)
        ? await rest(`reunioes_lembretes?encaminhado->>agendada_id=eq.${enc(idAg)}&status=in.(pendente,enviado)`, {
          method: "PATCH", body: JSON.stringify({ encaminhado: null, atualizado_em: new Date().toISOString() }),
        }).catch(() => [])
        : [];
      return json({ ...r, voltaram: voltaram.length });
    }
    if (acao === "instancias") return json({ instancias: await instancias() });
    if (acao === "enviar") return json(await enviar(b));
    // shorts (aba Shorts do painel)
    if (acao === "short_criar") return json({ short: await criarShort(b) });
    if (acao === "short_salvar") {
      const c: Record<string, unknown> = {};
      if (b.publicacao !== undefined) c.publicacao = pura(() => normalizarPublicacao(b.publicacao));
      if (b.destinos !== undefined) c.destinos = normalizarDestinos(b.destinos);
      return json({ short: await patchShort(idShort(b.id), c, ["pronto"]) });
    }
    if (acao === "short_aprovar") return json({ short: await aprovarShort(b) });
    if (acao === "short_ajustar") {
      const ajuste = texto(b.ajuste, 1000);
      if (!ajuste) throw new Recusa("Diga o que mudar no vídeo.");
      return json({ short: await patchShort(idShort(b.id), { status: "ajustar", ajuste, aprovado_em: null, erro: null }, ["pronto", "erro"]) });
    }
    if (acao === "short_tentar") {
      const s = await lerShort(idShort(b.id));
      const volta = s.aprovado_em ? "aprovado" : s.ajuste ? "ajustar" : "fila";
      return json({ short: await patchShort(s.id, { status: volta, erro: null }, ["erro"]) });
    }
    if (acao === "short_descartar") {
      const id = idShort(b.id);
      const s = await patchShort(id, { status: "descartado", video: null }, ["fila", "montando", "pronto", "ajustar", "aprovado", "erro"]);
      await apagarVideos(id).catch(() => {});
      return json({ short: s });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    console.error("reunioes:", acao, e instanceof Error ? e.message : e);
    return json({ error: "Não deu certo agora. Tente de novo em instantes." }, 500);
  }
});
