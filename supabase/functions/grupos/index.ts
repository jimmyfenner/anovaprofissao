import Anthropic from "npm:@anthropic-ai/sdk";

// A NOVA PROFISSÃO — função "grupos" (nov/2026)
// Painel grupos.anovaprofissao.com.br: os grupos de WhatsApp do Jimmy pela instância
// `pessoal` da Evolution (a do iGreen Turbo; só lemos o que a Evolution já guarda, sem
// mexer no webhook dele). Ver db/23-grupos.sql e o CLAUDE.md ("Grupos do WhatsApp").
//
// processar (pública, chamada pelo pg_cron a cada 2 min; só anda o que já está na fila):
//   1. lê as mensagens novas dos grupos ligados (findMessages por messageTimestamp)
//   2. menção ou resposta ao Jimmy vira "Precisa de você" na hora, sem IA
//   3. manda os envios programados vencidos (com "mencionar todos")
//   4. com a chave da OpenRouter: tria as mensagens (instrução nova / precisa de você)
//   5. avisa no WhatsApp (instância 1575 → número do Jimmy) o que é novo
//   6. depois da hora do resumo, resume o dia de cada grupo ligado e manda o apanhado
// Painel (token da sessão do /painel, só o número do Jimmy): estado, grupo_salvar,
//   grupos_sugeridos, sincronizar, mensagens, item, resumir, perguntar, envio_salvar,
//   envio_remover, envio_teste, config_salvar.
// IA: por configuração (grupos_config.modelo_triagem / modelo_resumo). "claude-*" vai direto à API da
// Anthropic (ANTHROPIC_API_KEY, SDK oficial, JSON validado por schema na triagem); qualquer outro nome
// vai à OpenRouter (OPENROUTER_API_KEY). Toda chamada fica em ai_usage com tokens e custo.
// Publicar: supabase functions deploy grupos --project-ref buapklmgdjcoyzrmhhcd --use-api --no-verify-jwt

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OR_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const ANT_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const JIMMY = "5548991067007";
const PAINEL = "https://grupos.anovaprofissao.com.br";
const BRT_MS = -3 * 3_600_000; // Brasília, sem horário de verão
const TIPOS_GRUPO = ["instrucoes", "licenciados", "envios"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JID_GRUPO = /^[0-9-]{6,40}@g\.us$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

class Recusa extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}
const exige = (cond: unknown, msg: string) => { if (!cond) throw new Recusa(msg); };
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- banco ---------------- */

async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  let body: any = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!r.ok) throw new Error(`rest ${path.split("?")[0]} ${r.status}: ${txt.slice(0, 300)}`);
  return body;
}
const linhas = async (path: string): Promise<any[]> => {
  const b = await rest(path);
  return Array.isArray(b) ? b : [];
};
const patch = (path: string, dados: unknown) =>
  rest(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(dados) });
async function inserir(tabela: string, dados: unknown[], conflito = "ignorar", onConflict = "") {
  for (let i = 0; i < dados.length; i += 200) {
    const pedaco = dados.slice(i, i + 200);
    await rest(`${tabela}${onConflict ? `?on_conflict=${onConflict}` : ""}`, {
      method: "POST",
      headers: { Prefer: `return=minimal,resolution=${conflito === "ignorar" ? "ignore" : "merge"}-duplicates` },
      body: JSON.stringify(pedaco),
    });
  }
}
const q = (s: string) => encodeURIComponent(s);
const lista = (xs: string[]) => `(${xs.map((x) => `"${x.replace(/"/g, "")}"`).join(",")})`;

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

// Sessão do /painel (login por código no WhatsApp). Aqui só entra o número do Jimmy.
async function sessao(token: unknown) {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) throw new Recusa("Entre de novo.", 401);
  const [s] = await linhas(`sessoes_painel?token_hash=eq.${await sha256(token)}&select=id,whatsapp,expira_em,encerrada_em`);
  if (!s || s.encerrada_em || Date.parse(s.expira_em) < Date.now()) throw new Recusa("Entre de novo.", 401);
  if (s.whatsapp !== JIMMY) throw new Recusa("Este painel é só do Jimmy.", 403);
}

async function config() {
  const [c] = await linhas("grupos_config?id=eq.1&select=*");
  if (!c) throw new Error("grupos_config vazia: aplicar db/23-grupos.sql");
  return c;
}

/* ---------------- horário de Brasília ---------------- */

const brt = (d = new Date()) => new Date(d.getTime() + BRT_MS); // campos UTC = relógio de Brasília
const diaBrt = (d = new Date()) => brt(d).toISOString().slice(0, 10);
const inicioDia = (dia: string) => new Date(Date.parse(dia + "T00:00:00Z") - BRT_MS);
function horaBrt(d: Date) {
  const b = brt(d);
  return `${String(b.getUTCHours()).padStart(2, "0")}:${String(b.getUTCMinutes()).padStart(2, "0")}`;
}
function saudacao(d = new Date()) {
  const h = brt(d).getUTCHours();
  return h >= 5 && h < 12 ? "Bom dia" : h >= 12 && h < 18 ? "Boa tarde" : "Boa noite";
}

/* ---------------- Evolution ---------------- */

async function evo(path: string, init: RequestInit = {}, ms = 60_000) {
  const r = await fetch(`${EVO_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: EVO_KEY, ...((init.headers as Record<string, string>) ?? {}) },
    signal: AbortSignal.timeout(ms),
  });
  const txt = await r.text();
  let body: any = txt;
  try { body = JSON.parse(txt); } catch { /* texto */ }
  return { ok: r.ok, status: r.status, body };
}

async function enviarTexto(instancia: string, numero: string, texto: string, mencionar = false) {
  try {
    const r = await evo(`/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      body: JSON.stringify({ number: numero, text: texto, delay: 1200, ...(mencionar ? { mentionsEveryOne: true } : {}) }),
    }, 75_000);
    return r.ok ? { ok: true, erro: "" } : { ok: false, erro: `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "falha de rede" };
  }
}

// Mensagens da Evolution num intervalo (messageTimestamp em ISO: com número a busca volta vazia).
async function buscarMensagens(instancia: string, desde: Date, ate: Date, jid?: string, maxPaginas = 12) {
  const where: any = { messageTimestamp: { gte: desde.toISOString(), lte: ate.toISOString() } };
  if (jid) where.key = { remoteJid: jid };
  const todos: any[] = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const r = await evo(`/chat/findMessages/${encodeURIComponent(instancia)}`, {
      method: "POST", body: JSON.stringify({ where, page: pagina, offset: 500 }),
    }, 90_000);
    if (!r.ok) throw new Error(`findMessages ${r.status}`);
    const m = r.body?.messages ?? r.body;
    const recs = Array.isArray(m?.records) ? m.records : [];
    todos.push(...recs);
    if (!recs.length || pagina >= (m?.pages ?? 1)) break;
  }
  return todos;
}

const PULAR = new Set([
  "reactionMessage", "pollUpdateMessage", "protocolMessage", "senderKeyDistributionMessage",
  "associatedChildMessage", "albumMessage", "placeholderMessage", "unknown", "messageContextInfo",
  "keepInChatMessage", "pinInChatMessage", "encReactionMessage", "editedMessage",
]);

function textoDe(m: any): string {
  if (!m || typeof m !== "object") return "";
  if (typeof m.conversation === "string") return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return "[imagem]" + (m.imageMessage.caption ? " " + m.imageMessage.caption : "");
  if (m.videoMessage) return "[vídeo]" + (m.videoMessage.caption ? " " + m.videoMessage.caption : "");
  if (m.ptvMessage) return "[vídeo]";
  if (m.audioMessage) return m.audioMessage.ptt ? "[áudio de voz]" : "[áudio]";
  const doc = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc) return `[documento${doc.fileName ? ": " + doc.fileName : ""}]` + (doc.caption ? " " + doc.caption : "");
  if (m.stickerMessage) return "[figurinha]";
  const poll = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (poll) return `[enquete] ${poll.name ?? ""}: ${(poll.options ?? []).map((o: any) => o.optionName).join(" / ")}`;
  if (m.contactMessage) return `[contato] ${m.contactMessage.displayName ?? ""}`;
  if (m.contactsArrayMessage) return "[contatos]";
  if (m.locationMessage || m.liveLocationMessage) return "[localização]";
  if (m.eventMessage) return `[evento] ${m.eventMessage.name ?? ""}`;
  if (m.viewOnceMessage?.message) return textoDe(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2?.message) return textoDe(m.viewOnceMessageV2.message);
  if (m.ephemeralMessage?.message) return textoDe(m.ephemeralMessage.message);
  if (m.groupInviteMessage) return `[convite de grupo] ${m.groupInviteMessage.groupName ?? ""}`;
  return "";
}

function contextoDe(r: any): any {
  if (r?.contextInfo && typeof r.contextInfo === "object") return r.contextInfo;
  const m = r?.message ?? {};
  for (const v of Object.values(m)) {
    if (v && typeof v === "object" && (v as any).contextInfo) return (v as any).contextInfo;
  }
  return {};
}

// Registro da Evolution → linha de grupo_mensagens (null = não é mensagem de conversa).
function paraLinha(r: any, meus: Set<string>) {
  const k = r?.key ?? {};
  const jid = String(k.remoteJid ?? "");
  if (!JID_GRUPO.test(jid) || !k.id) return null;
  const tipo = String(r.messageType ?? "");
  if (PULAR.has(tipo)) return null;
  const texto = textoDe(r.message).trim();
  if (!texto) return null;
  const ctx = contextoDe(r);
  const deMim = !!k.fromMe;
  const autor = String(k.participantAlt ?? k.participant ?? "") || null;
  const mencionados: string[] = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
  const citaAutor = typeof ctx.participant === "string" ? ctx.participant : null;
  const ts = Number(r.messageTimestamp);
  return {
    id: String(k.id),
    jid,
    ts: new Date((ts < 1e12 ? ts * 1000 : ts)).toISOString(),
    autor,
    autor_nome: deMim ? "Jimmy" : (r.pushName && !/^\d+$/.test(r.pushName) ? String(r.pushName).slice(0, 80) : null),
    de_mim: deMim,
    tipo: tipo || null,
    texto: texto.slice(0, 6000),
    cita_id: typeof ctx.stanzaId === "string" ? ctx.stanzaId : null,
    cita_autor: citaAutor,
    cita_texto: ctx.quotedMessage ? textoDe(ctx.quotedMessage).slice(0, 600) || null : null,
    menciona_jimmy: !deMim && mencionados.some((j) => meus.has(j)),
    responde_jimmy: !deMim && !!citaAutor && meus.has(citaAutor),
    _alt: [k.participant, k.participantAlt].filter((x) => typeof x === "string") as string[],
  };
}

/* ---------------- IA (OpenRouter, com registro em ai_usage) ---------------- */

// Preço por milhão de tokens (entrada, saída) da API da Anthropic, para o custo em ai_usage.
const PRECOS: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.10, 0.50], "claude-sonnet-5-5": [2, 10], "claude-opus-5-5": [4, 20],
};
const ehClaude = (modelo: string) => modelo.startsWith("claude-");
const iaDisponivel = (modelo: string) => ehClaude(modelo) ? !!ANT_KEY : !!OR_KEY;
let anthropic: Anthropic | null = null;

type OpcoesIa = { schema?: Record<string, unknown>; max?: number; esforco?: "low" | "medium" | "high" };

async function ia(feature: string, modelo: string, sistema: string, usuario: string, opts: OpcoesIa = {}) {
  if (!iaDisponivel(modelo)) {
    throw new Recusa(`A IA ainda não está ligada: falta a chave ${ehClaude(modelo) ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY"}.`, 409);
  }
  let ok = false, erro: string | null = null, conteudo = "";
  let tin: number | null = null, tout: number | null = null, custo: number | null = null;
  try {
    if (ehClaude(modelo)) {
      anthropic ??= new Anthropic({ apiKey: ANT_KEY, timeout: 100_000, maxRetries: 2 });
      const params: any = {
        model: modelo, max_tokens: opts.max ?? 8000, system: sistema,
        messages: [{ role: "user", content: usuario }],
        output_config: { effort: opts.esforco ?? "medium", ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}) },
      };
      // Sonnet/Opus: se um filtro de segurança recusar, a própria API tenta outro modelo
      const r: any = modelo.startsWith("claude-haiku")
        ? await anthropic.messages.create(params)
        : await anthropic.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
      tin = r.usage?.input_tokens ?? null;
      tout = r.usage?.output_tokens ?? null;
      const p = PRECOS[modelo];
      if (p && tin != null && tout != null) custo = (tin * p[0] + tout * p[1]) / 1e6;
      conteudo = (r.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (r.stop_reason === "refusal") erro = `recusado (${r.stop_details?.category ?? "sem categoria"})`;
      else if (r.stop_reason === "max_tokens") erro = "resposta cortada (max_tokens)";
      else ok = !!conteudo;
      if (!ok && !erro) erro = `sem texto (stop_reason ${r.stop_reason})`;
    } else {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json", "HTTP-Referer": PAINEL, "X-Title": "Grupos do Jimmy" },
        body: JSON.stringify({
          model: modelo.replace(/^openrouter:/, ""), temperature: 0.2, max_tokens: opts.max ?? 1800,
          messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
          ...(opts.schema ? { response_format: { type: "json_object" } } : {}),
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(100_000),
      });
      const j = await r.json().catch(() => null);
      tin = j?.usage?.prompt_tokens ?? null;
      tout = j?.usage?.completion_tokens ?? null;
      custo = j?.usage?.cost ?? null;
      conteudo = String(j?.choices?.[0]?.message?.content ?? "");
      ok = r.ok && !!conteudo;
      if (!ok) erro = `HTTP ${r.status}: ${JSON.stringify(j?.error ?? j).slice(0, 300)}`;
    }
  } catch (e) {
    erro = e instanceof Error ? e.message.slice(0, 300) : "falha";
  }
  await rest("ai_usage", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ feature, modelo, ok, erro, tokens_in: tin, tokens_out: tout, custo_usd: custo }),
  }).catch(() => {});
  if (!ok) throw new Error(`IA (${feature}): ${erro}`);
  return conteudo;
}

const SCHEMA_TRIAGEM = {
  type: "object",
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["instrucao", "atencao"] },
          titulo: { type: "string" },
          detalhe: { type: "string" },
          ids: { type: "array", items: { type: "string" } },
        },
        required: ["tipo", "titulo", "detalhe", "ids"],
        additionalProperties: false,
      },
    },
  },
  required: ["itens"],
  additionalProperties: false,
};
function jsonDe(t: string): any {
  const s = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* tenta o maior objeto */ }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  return a >= 0 && b > a ? JSON.parse(s.slice(a, b + 1)) : null;
}
const fone = (j: unknown) => {
  const d = typeof j === "string" && j.endsWith("@s.whatsapp.net") ? j.split("@")[0] : "";
  return d.length >= 12 ? `(${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : "";
};
const quem = (m: any) => m.de_mim ? "Jimmy" : (m.autor_nome || fone(m.autor) || "alguém");
const linhaMsg = (m: any) =>
  `[${m.id}] ${horaBrt(new Date(m.ts))} ${quem(m)}: ` +
  (m.cita_texto ? `(respondendo "${String(m.cita_texto).slice(0, 120)}") ` : "") + String(m.texto).slice(0, 1500);

const QUEM = "Você ajuda Jimmy Fenner, líder de licenciados da iGreen Energy (energia por assinatura, " +
  "telecom, seguros e eletropostos Mob, num modelo de licenciamento com equipes). Ele participa de muitos " +
  "grupos de WhatsApp e não consegue ler tudo. Escreva em português do Brasil, direto, sem inventar nada: " +
  "datas, valores e nomes exatamente como aparecem nas mensagens. Separe sempre o que foi AFIRMADO (e por quem) " +
  "do que foi só perguntado ou suposto (\"acho que\", \"será que\", \"?\"): dúvida nunca vira fato. Se as " +
  "respostas divergem, diga que divergem e não escolha um lado. Não diga \"confirmado\" sem confirmação explícita.";

const CRITERIO: Record<string, string> = {
  instrucoes:
    "Este grupo é da empresa ou da liderança. Marque como \"instrucao\" só orientação NOVA AFIRMADA como comunicado " +
    "ou resposta segura de quem fala pela empresa ou pela liderança, que licenciados ou " +
    "líderes precisam seguir ou repassar: regra, procedimento, prazo, campanha, condição comercial, material " +
    "novo, mudança em sistema, cadastro, produto ou distribuidora, comunicado oficial. NÃO é instrução: parabéns, " +
    "saudação, comemoração de venda, piada, dúvida de colega, conversa paralela, convite ou divulgação de live, " +
    "evento, treinamento ou link de transmissão (a não ser que traga regra nova), pergunta de colega com resposta " +
    "incerta ou divergente, nem repetição de algo que já " +
    "está no contexto. Use \"atencao\" só quando a mensagem pede algo ao Jimmy pelo nome ou responde a uma " +
    "mensagem dele; pedido de ajuda para outra pessoa não é com ele.",
  licenciados:
    "Este é um grupo de licenciados que o Jimmy lidera e treina. Marque como \"atencao\" o que precisa dele: " +
    "pergunta feita a ele ou ao líder, dúvida que ficou sem resposta no grupo, pedido de ajuda, licenciado " +
    "travado, desanimado ou pensando em desistir, reclamação, problema com cliente, cadastro, pagamento ou " +
    "comissão. Não marque o que outra pessoa já respondeu bem, nem conversa social.",
};

async function triarGrupo(cfg: any, g: any, novas: any[]) {
  const ctx = await linhas(
    `grupo_mensagens?jid=eq.${q(g.jid)}&triada=eq.true&ts=lt.${q(novas[0].ts)}&select=id,ts,autor,autor_nome,de_mim,texto,cita_texto&order=ts.desc&limit=15`,
  );
  const prompt =
    `${CRITERIO[g.tipo] ?? CRITERIO.licenciados}\n\nGrupo: ${g.nome}\n\n` +
    (ctx.length ? `CONTEXTO (já lido antes, não marque):\n${ctx.reverse().map(linhaMsg).join("\n")}\n\n` : "") +
    `MENSAGENS NOVAS:\n${novas.map(linhaMsg).join("\n")}\n\n` +
    `Responda só JSON: {"itens":[{"tipo":"instrucao" ou "atencao","titulo":"até 120 caracteres, específico",` +
    `"detalhe":"o que é preciso saber ou fazer, com números e regras exatamente como escritos e quem afirmou, até 600 caracteres",` +
    `"ids":["ids das mensagens de origem"]}]}. ` +
    `Junte num item só as mensagens do mesmo assunto. Se nada importa, {"itens":[]}.`;
  const resp = jsonDe(await ia("grupos_triagem", cfg.modelo_triagem, QUEM, prompt, { schema: SCHEMA_TRIAGEM, max: 6000 }));
  const validos = new Set(novas.map((m) => m.id));
  const porId = new Map(novas.map((m) => [m.id, m]));
  const itens = (Array.isArray(resp?.itens) ? resp.itens : [])
    .filter((it: any) => (it?.tipo === "instrucao" || it?.tipo === "atencao") && typeof it.titulo === "string" && it.titulo.trim())
    .slice(0, 12)
    .map((it: any) => {
      const ids = (Array.isArray(it.ids) ? it.ids : []).map(String).filter((id: string) => validos.has(id)).slice(0, 20);
      const primeira = porId.get(ids[0]) ?? novas[novas.length - 1];
      return {
        jid: g.jid, tipo: it.tipo, origem: "ia",
        titulo: String(it.titulo).trim().slice(0, 140),
        detalhe: typeof it.detalhe === "string" ? it.detalhe.trim().slice(0, 1200) : null,
        autor_nome: quem(primeira),
        ts: primeira.ts, msg_ids: ids,
      };
    });
  if (itens.length) await inserir("grupo_itens", itens);
  await patch(`grupo_mensagens?id=in.${lista(novas.map((m) => m.id))}`, { triada: true });
  return itens.length;
}

/* ---------------- leitura ---------------- */

// historico = true: mensagens antigas trazidas ao ligar um grupo. Entram já lidas, sem aviso nem triagem.
async function lerMensagens(cfg: any, desde: Date, jidUnico?: string, historico = false) {
  const ativos = jidUnico
    ? await linhas(`grupos?jid=eq.${q(jidUnico)}&select=jid,nome,tipo`)
    : await linhas("grupos?ativo=eq.true&tipo=neq.envios&select=jid,nome,tipo");
  if (!ativos.length) return { lidas: 0, novas: 0 };
  const porJid = new Map(ativos.map((g) => [g.jid, g]));
  const meus = new Set<string>(cfg.meus_jids ?? []);
  const recs = await buscarMensagens(cfg.instancia, desde, new Date(Date.now() + 3_600_000), jidUnico, jidUnico ? 6 : 12);

  // os ids do próprio Jimmy (telefone e LID) aparecem nas mensagens que ele manda
  const novosMeus = new Set<string>();
  for (const r of recs) {
    if (r?.key?.fromMe) for (const x of [r.key.participant, r.key.participantAlt]) {
      if (typeof x === "string" && x && !meus.has(x)) novosMeus.add(x);
    }
  }
  if (novosMeus.size) {
    novosMeus.forEach((x) => meus.add(x));
    await patch("grupos_config?id=eq.1", { meus_jids: [...meus].slice(0, 20) });
  }

  const porId = new Map<string, any>();
  for (const r of recs) {
    const l = paraLinha(r, meus);
    if (!l || !porJid.has(l.jid)) continue;
    const atual = porId.get(l.id);
    if (!atual || l.texto.length > atual.texto.length) porId.set(l.id, l);
  }
  const lidas = [...porId.values()];
  if (!lidas.length) return { lidas: recs.length, novas: 0 };

  // só as que ainda não estão no banco viram aviso
  const jaTem = new Set<string>();
  for (let i = 0; i < lidas.length; i += 150) {
    const ids = lidas.slice(i, i + 150).map((l) => l.id);
    (await linhas(`grupo_mensagens?id=in.${lista(ids)}&select=id`)).forEach((x) => jaTem.add(x.id));
  }
  const novas = lidas.filter((l) => !jaTem.has(l.id));
  if (!novas.length) return { lidas: recs.length, novas: 0 };

  await inserir("grupo_mensagens", novas.map(({ _alt, ...l }) => ({
    ...l,
    triada: historico || l.de_mim || (porJid.get(l.jid)?.tipo === "envios"),
  })));
  if (historico) return { lidas: recs.length, novas: novas.length };

  // menção ou resposta ao Jimmy: aviso na hora, sem IA
  const diretos = novas.filter((l) => l.menciona_jimmy || l.responde_jimmy).map((l) => ({
    jid: l.jid, tipo: "atencao", origem: l.menciona_jimmy ? "mencao" : "resposta",
    titulo: `${quem(l)} ${l.menciona_jimmy ? "te mencionou" : "respondeu você"}`,
    detalhe: l.texto.slice(0, 1200), autor_nome: quem(l), ts: l.ts, msg_ids: [l.id],
  }));
  // um por vez: o índice único (tipo + mensagem) barra repetição se duas leituras se cruzarem
  for (const d of diretos) await inserir("grupo_itens", [d]).catch(() => {});

  // última mensagem de cada grupo
  const ultima = new Map<string, string>();
  for (const l of novas) if (!ultima.has(l.jid) || l.ts > ultima.get(l.jid)!) ultima.set(l.jid, l.ts);
  await Promise.all([...ultima].map(([jid, ts]) =>
    patch(`grupos?jid=eq.${q(jid)}&or=(ultima_msg_em.is.null,ultima_msg_em.lt.${q(ts)})`, { ultima_msg_em: ts }).catch(() => {})));
  return { lidas: recs.length, novas: novas.length };
}

async function sincronizarGrupos(cfg: any) {
  const r = await evo(`/group/fetchAllGroups/${encodeURIComponent(cfg.instancia)}?getParticipants=false`, {}, 140_000);
  if (!r.ok || !Array.isArray(r.body)) throw new Error(`fetchAllGroups ${r.status}`);
  const agora = new Date().toISOString();
  const grupos = r.body
    .filter((g: any) => JID_GRUPO.test(String(g?.id ?? "")) && !g.isCommunity)
    .map((g: any) => ({
      jid: g.id, nome: String(g.subject ?? "").trim().slice(0, 200), tamanho: Number(g.size) || null,
      so_admins: !!g.announce, atualizado_em: agora,
    }));
  await inserir("grupos", grupos, "juntar", "jid");
  await patch("grupos_config?id=eq.1", { lista_em: agora });
  return grupos.length;
}

/* ---------------- envios programados ---------------- */

// Próxima vez de um envio repetido, depois de `depois` (horário de Brasília).
function proximaVez(e: any, depois: Date): Date | null {
  if (e.repetir === "nao" || !e.hora) return null;
  const [h, mi] = String(e.hora).split(":").map(Number);
  const base = brt(depois);
  for (let d = 0; d <= 400; d++) {
    const dia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + d));
    const semana = dia.getUTCDay();
    const fimMes = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth() + 1, 0)).getUTCDate();
    const ok = e.repetir === "diario" ||
      (e.repetir === "semanal" && (e.dias_semana ?? []).includes(semana)) ||
      (e.repetir === "mensal" && dia.getUTCDate() === Math.min(e.dia_mes ?? 1, fimMes));
    if (!ok) continue;
    const t = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h, mi) - BRT_MS);
    if (t.getTime() > depois.getTime()) {
      if (e.ate && diaBrt(t) > e.ate) return null;
      return t;
    }
  }
  return null;
}

const montarTexto = (t: string) => t.replace(/\{saudacao\}/gi, saudacao());

async function mandarEnvios(cfg: any, prazo: number) {
  const agora = new Date().toISOString();
  const vencidos = await linhas(
    `grupo_envios?ativo=eq.true&proximo_em=lte.${q(agora)}&or=(enviando_ate.is.null,enviando_ate.lt.${q(agora)})&order=proximo_em&limit=5`,
  );
  let feitos = 0;
  for (const e of vencidos) {
    if (Date.now() > prazo) break;
    const trava = await rest(
      `grupo_envios?id=eq.${e.id}&or=(enviando_ate.is.null,enviando_ate.lt.${q(new Date().toISOString())})`,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ enviando_ate: new Date(Date.now() + 170_000).toISOString() }) },
    );
    if (!Array.isArray(trava) || !trava.length) continue;
    const erros: string[] = [];
    for (let i = 0; i < e.jids.length; i++) {
      const jid = e.jids[i];
      const r = await enviarTexto(cfg.instancia, jid, montarTexto(e.texto), e.mencionar);
      await rest("grupo_envios_log", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ envio_id: e.id, jid, ok: r.ok, erro: r.ok ? null : r.erro }),
      }).catch(() => {});
      if (!r.ok) erros.push(r.erro);
      if (i < e.jids.length - 1) await espera(4000 + Math.random() * 5000);
    }
    const prox = proximaVez(e, new Date());
    await patch(`grupo_envios?id=eq.${e.id}`, {
      ultimo_em: new Date().toISOString(), ultimo_erro: erros.length ? erros.join(" | ").slice(0, 500) : null,
      proximo_em: prox ? prox.toISOString() : null, ativo: !!prox, enviando_ate: null, atualizado_em: new Date().toISOString(),
    });
    feitos++;
  }
  return feitos;
}

/* ---------------- avisos e resumo ---------------- */

async function avisar(cfg: any) {
  if (!cfg.avisar) return 0;
  const desde = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const itens = await linhas(
    `grupo_itens?status=eq.novo&avisado_em=is.null&aviso_erro=is.null&criado_em=gte.${q(desde)}&select=id,jid,tipo,titulo,detalhe,autor_nome,ts&order=ts&limit=12`,
  );
  if (!itens.length) return 0;
  const nomes = new Map((await linhas(`grupos?jid=in.${lista([...new Set(itens.map((i) => i.jid))])}&select=jid,nome`)).map((g) => [g.jid, g.nome]));
  const blocos = itens.slice(0, 8).map((i) =>
    `${i.tipo === "instrucao" ? "📌 *Instrução nova*" : "🙋 *Precisa de você*"} · ${nomes.get(i.jid) ?? "grupo"}\n` +
    `${i.titulo}\n` + (i.detalhe ? `${String(i.detalhe).slice(0, 220)}${String(i.detalhe).length > 220 ? "…" : ""}\n` : "") +
    `— ${i.autor_nome ?? "alguém"}, ${horaBrt(new Date(i.ts))}`);
  const resto = itens.length > 8 ? `\n\n…e mais ${itens.length - 8}.` : "";
  const texto = `🔔 *Grupos* · ${itens.length} ${itens.length === 1 ? "novidade" : "novidades"}\n\n${blocos.join("\n\n")}${resto}\n\nAbrir: ${PAINEL}`;
  const r = await enviarTexto(cfg.instancia_avisos, cfg.numero_avisos, texto);
  await patch(`grupo_itens?id=in.${lista(itens.map((i) => i.id))}`,
    r.ok ? { avisado_em: new Date().toISOString() } : { aviso_erro: r.erro.slice(0, 300) });
  return itens.length;
}

async function resumirGrupo(cfg: any, g: any, dia: string) {
  const ini = inicioDia(dia), fim = new Date(ini.getTime() + 86_400_000);
  const msgs = await linhas(
    `grupo_mensagens?jid=eq.${q(g.jid)}&ts=gte.${q(ini.toISOString())}&ts=lt.${q(fim.toISOString())}&select=id,ts,autor,autor_nome,de_mim,texto,cita_texto&order=ts&limit=900`,
  );
  if (!msgs.length) return null;
  const foco = g.tipo === "instrucoes"
    ? "Destaque instruções, mudanças, prazos e materiais novos."
    : "Destaque dúvidas que se repetem, quem precisa de ajuda, o que ficou sem resposta e quem se destacou.";
  const texto = (await ia("grupos_resumo", cfg.modelo_resumo, QUEM,
    `Resuma o dia ${dia.split("-").reverse().join("/")} do grupo "${g.nome}" em até 6 tópicos curtos ` +
        `(comece cada um com "• "), do mais importante para o menos. ${foco} Só se houver uma ação concreta e ainda ` +
        `pendente para o Jimmy (responder alguém, repassar uma regra, resolver um problema), termine com uma linha ` +
        `"Para você: ..."; nunca sugira ir a evento que já passou. Sem introdução, sem markdown além dos tópicos.\n\n` +
        msgs.map(linhaMsg).join("\n"), { max: 8000 })).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim().slice(0, 2500);
  await inserir("grupo_resumos", [{ jid: g.jid, dia, texto, msgs: msgs.length, criado_em: new Date().toISOString() }], "juntar", "jid,dia");
  return texto;
}

async function resumoDoDia(cfg: any, prazo: number) {
  if (!iaDisponivel(cfg.modelo_resumo)) return 0;
  const hoje = diaBrt();
  if (brt().getUTCHours() < cfg.resumo_hora || (cfg.resumo_dia && cfg.resumo_dia >= hoje)) return 0;
  const ini = inicioDia(hoje).toISOString();
  const grupos = await linhas(`grupos?ativo=eq.true&tipo=neq.envios&ultima_msg_em=gte.${q(ini)}&select=jid,nome,tipo&order=nome`);
  const feitos = new Set((await linhas(`grupo_resumos?dia=eq.${hoje}&select=jid`)).map((r) => r.jid));
  let n = 0;
  for (const g of grupos.filter((g) => !feitos.has(g.jid))) {
    if (Date.now() > prazo) return n; // continua na próxima chamada
    try { await resumirGrupo(cfg, g, hoje); } catch (e) { console.error("resumo", g.jid, e); }
    feitos.add(g.jid); n++;
  }
  // todos resumidos: manda o apanhado
  const resumos = await linhas(`grupo_resumos?dia=eq.${hoje}&select=jid,texto,msgs`);
  const nomes = new Map(grupos.map((g) => [g.jid, g.nome]));
  const partes = resumos.filter((r) => nomes.has(r.jid)).sort((a, b) => b.msgs - a.msgs).map((r) => {
    const topicos = String(r.texto).split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
    return `*${nomes.get(r.jid)}* (${r.msgs} msgs)\n${topicos}`;
  });
  if (partes.length && cfg.avisar) {
    const doDia = await linhas(`grupo_itens?ts=gte.${q(ini)}&status=in.(novo,visto)&select=tipo`);
    const ni = doDia.filter((i) => i.tipo === "instrucao").length, nv = doDia.length - ni;
    const topo = ni || nv
      ? `${ni ? `📌 ${ni} ${ni === 1 ? "instrução nova" : "instruções novas"}` : ""}${ni && nv ? " · " : ""}${nv ? `🙋 ${nv} ${nv === 1 ? "pendência" : "pendências"} com você` : ""}\n\n`
      : "";
    const texto = `📋 *Resumo dos grupos* · ${hoje.split("-").reverse().join("/")}\n\n${topo}${partes.slice(0, 10).join("\n\n")}` +
      `${partes.length > 10 ? `\n\n…e mais ${partes.length - 10} grupos.` : ""}\n\nCompleto: ${PAINEL}`;
    await enviarTexto(cfg.instancia_avisos, cfg.numero_avisos, texto);
  }
  await patch("grupos_config?id=eq.1", { resumo_dia: hoje });
  return n;
}

/* ---------------- processar ---------------- */

async function processar() {
  const inicio = Date.now();
  const prazo = inicio + 95_000;
  const agora = new Date();
  const trava = await rest(`grupos_config?id=eq.1&or=(processando_ate.is.null,processando_ate.lt.${q(agora.toISOString())})`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ processando_ate: new Date(inicio + 140_000).toISOString() }),
  });
  if (!Array.isArray(trava) || !trava.length) return { ocupado: true };
  const cfg = trava[0];
  const feito: Record<string, unknown> = {};
  const erros: string[] = [];
  const passo = async (nome: string, f: () => Promise<unknown>) => {
    try { feito[nome] = await f(); } catch (e) { erros.push(`${nome}: ${e instanceof Error ? e.message : e}`); }
  };
  try {
    if (!cfg.lista_em || Date.now() - Date.parse(cfg.lista_em) > 86_400_000) {
      await passo("lista", () => sincronizarGrupos(cfg));
    }
    // a cada hora relê as últimas 26 h (pega mensagem que a Evolution recebeu atrasada)
    const releitura = brt(agora).getUTCMinutes() < 2;
    const desde = releitura ? new Date(Date.now() - 26 * 3_600_000)
      : cfg.cursor_em ? new Date(Date.parse(cfg.cursor_em) - 3 * 60_000) : new Date(Date.now() - 30 * 60_000);
    await passo("leitura", async () => {
      const r = await lerMensagens(cfg, desde);
      await patch("grupos_config?id=eq.1", { cursor_em: agora.toISOString() });
      return r;
    });
    await passo("envios", () => mandarEnvios(cfg, prazo - 25_000));
    // triagem a cada 10 min (menção e resposta ao Jimmy já avisam na hora, sem IA)
    const triarAgora = !cfg.triagem_em || Date.now() - Date.parse(cfg.triagem_em) >= 9.5 * 60_000;
    if (iaDisponivel(cfg.modelo_triagem) && triarAgora) {
      await passo("triagem", async () => {
        const pendentes = await linhas("grupo_mensagens?triada=eq.false&select=id,jid,ts,autor,autor_nome,de_mim,texto,cita_texto&order=ts&limit=600");
        const grupos = new Map((await linhas("grupos?ativo=eq.true&select=jid,nome,tipo")).map((g) => [g.jid, g]));
        const porJid = new Map<string, any[]>();
        for (const m of pendentes) {
          if (!grupos.has(m.jid)) continue;
          if (!porJid.has(m.jid)) porJid.set(m.jid, []);
          porJid.get(m.jid)!.push(m);
        }
        // grupos desligados no meio do caminho não precisam de triagem
        const orfas = pendentes.filter((m) => !grupos.has(m.jid)).map((m) => m.id);
        if (orfas.length) await patch(`grupo_mensagens?id=in.${lista(orfas.slice(0, 300))}`, { triada: true });
        let itens = 0;
        for (const [jid, msgs] of porJid) {
          if (Date.now() > prazo - 20_000) break;
          itens += await triarGrupo(cfg, grupos.get(jid), msgs.slice(0, 120));
        }
        await patch("grupos_config?id=eq.1", { triagem_em: new Date().toISOString() });
        return itens;
      });
    }
    await passo("avisos", () => avisar(cfg));
    await passo("resumo", () => resumoDoDia(cfg, prazo));
  } finally {
    await patch("grupos_config?id=eq.1", {
      processando_ate: null, ultimo_erro: erros.length ? erros.join(" | ").slice(0, 800) : null,
      atualizado_em: new Date().toISOString(),
    }).catch(() => {});
  }
  return { ...feito, erros, ms: Date.now() - inicio };
}

/* ---------------- painel ---------------- */

async function estado() {
  const cfg = await config();
  const hoje = diaBrt();
  const iniHoje = inicioDia(hoje).toISOString();
  const [grupos, itens, resumos, envios, log, uso, hojeMsgs] = await Promise.all([
    linhas("grupos?select=jid,nome,tamanho,papel,so_admins,ativo,tipo,sugestao,msgs_14d,ultima_msg_em&order=ativo.desc,msgs_14d.desc,nome&limit=1000"),
    linhas("grupo_itens?or=(status.in.(novo,visto),criado_em.gte." + q(new Date(Date.now() - 7 * 86_400_000).toISOString()) + ")&select=*&order=ts.desc&limit=300"),
    linhas(`grupo_resumos?dia=gte.${diaBrt(new Date(Date.now() - 7 * 86_400_000))}&select=jid,dia,texto,msgs,criado_em&order=dia.desc&limit=400`),
    linhas("grupo_envios?select=*&order=ativo.desc,proximo_em.asc.nullslast,criado_em.desc&limit=200"),
    linhas("grupo_envios_log?select=envio_id,jid,enviado_em,ok,erro&order=enviado_em.desc&limit=60"),
    linhas(`ai_usage?criado_em=gte.${q(new Date(Date.now() - 30 * 86_400_000).toISOString())}&select=custo_usd,criado_em`),
    linhas(`grupo_mensagens?ts=gte.${q(iniHoje)}&select=jid&limit=20000`),
  ]);
  const contagem: Record<string, number> = {};
  for (const m of hojeMsgs) contagem[m.jid] = (contagem[m.jid] ?? 0) + 1;
  const custo = (desde: number) => uso.filter((u) => Date.parse(u.criado_em) >= desde).reduce((s, u) => s + Number(u.custo_usd ?? 0), 0);
  return {
    hoje,
    config: {
      instancia: cfg.instancia, instancia_avisos: cfg.instancia_avisos, numero_avisos: cfg.numero_avisos,
      avisar: cfg.avisar, resumo_hora: cfg.resumo_hora, modelo_triagem: cfg.modelo_triagem, modelo_resumo: cfg.modelo_resumo,
      ia: iaDisponivel(cfg.modelo_triagem) && iaDisponivel(cfg.modelo_resumo),
      cursor_em: cfg.cursor_em, lista_em: cfg.lista_em, ultimo_erro: cfg.ultimo_erro,
    },
    custo: { hoje: custo(Date.parse(iniHoje)), mes: custo(Date.now() - 30 * 86_400_000) },
    grupos, itens, resumos, envios, log, msgs_hoje: contagem,
  };
}

function lerEnvio(b: any) {
  const texto = String(b.texto ?? "").trim();
  exige(texto.length >= 1 && texto.length <= 4096, "Escreva a mensagem (até 4.096 caracteres).");
  const jids = [...new Set<string>((Array.isArray(b.jids) ? b.jids : []).map(String))].filter((j) => JID_GRUPO.test(j));
  exige(jids.length >= 1 && jids.length <= 50, "Escolha de 1 a 50 grupos.");
  const repetir = ["nao", "diario", "semanal", "mensal"].includes(b.repetir) ? b.repetir : "nao";
  const e: any = { texto, jids, mencionar: b.mencionar !== false, repetir, dias_semana: null, dia_mes: null, hora: null, ate: null };
  if (repetir === "nao") {
    const em = b.agora ? new Date() : new Date(String(b.em ?? ""));
    exige(!isNaN(em.getTime()), "Escolha o dia e a hora do envio.");
    exige(em.getTime() > Date.now() - 5 * 60_000, "Esse horário já passou.");
    e.proximo_em = em.toISOString();
  } else {
    exige(/^[0-2]\d:[0-5]\d$/.test(String(b.hora ?? "")), "Escolha a hora do envio.");
    e.hora = String(b.hora);
    if (repetir === "semanal") {
      e.dias_semana = [...new Set<number>((Array.isArray(b.dias_semana) ? b.dias_semana : []).map(Number))].filter((d) => d >= 0 && d <= 6);
      exige(e.dias_semana.length, "Escolha os dias da semana.");
    }
    if (repetir === "mensal") {
      e.dia_mes = Math.round(Number(b.dia_mes));
      exige(e.dia_mes >= 1 && e.dia_mes <= 31, "Escolha o dia do mês.");
    }
    if (b.ate) {
      exige(/^\d{4}-\d{2}-\d{2}$/.test(String(b.ate)), "Data final inválida.");
      e.ate = String(b.ate);
    }
    const desde = b.inicio ? new Date(String(b.inicio)) : new Date();
    const prox = proximaVez(e, isNaN(desde.getTime()) ? new Date() : new Date(desde.getTime() - 1000));
    exige(prox, "Com essas regras não sobra nenhuma data de envio.");
    e.proximo_em = prox!.toISOString();
  }
  return e;
}

async function perguntar(cfg: any, b: any) {
  const pergunta = String(b.pergunta ?? "").trim().slice(0, 800);
  exige(pergunta.length >= 4, "Escreva a pergunta.");
  const dias = Math.min(Math.max(Number(b.dias) || 30, 1), 180);
  const desde = new Date(Date.now() - dias * 86_400_000);
  const jids = Array.isArray(b.jids) && b.jids.length ? b.jids.map(String).filter((j: string) => JID_GRUPO.test(j)) : null;
  // palavras da pergunta (sem as vazias) viram busca "ou" no texto das mensagens
  const vazias = new Set("que qual quais quem como onde quando sobre para pelo pela pelos pelas com sem uma umas uns dos das nos nas foi era ser tem ter isso essa esse este esta aquele aquela grupo grupos falou falaram disse disseram mensagem mensagens alguem alguém algum alguma hoje ontem semana mês mes".split(" "));
  const palavras = pergunta.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]{3,}/g) ?? [];
  const chave = [...new Set(palavras.filter((p) => !vazias.has(p)))].slice(0, 12);
  let achadas: any[] = [];
  if (chave.length) {
    achadas = await rest("rpc/grupos_buscar", {
      method: "POST",
      body: JSON.stringify({ p_consulta: chave.join(" or "), p_desde: desde.toISOString(), p_jids: jids, p_limite: 160 }),
    }) ?? [];
  }
  const resumos = await linhas(
    `grupo_resumos?dia=gte.${diaBrt(desde)}${jids ? `&jid=in.${lista(jids)}` : ""}&select=jid,dia,texto&order=dia.desc&limit=60`,
  );
  const itens = await linhas(
    `grupo_itens?ts=gte.${q(desde.toISOString())}${jids ? `&jid=in.${lista(jids)}` : ""}&select=jid,tipo,titulo,detalhe,autor_nome,ts&order=ts.desc&limit=80`,
  );
  const nomes = new Map((await linhas("grupos?select=jid,nome")).map((g) => [g.jid, g.nome]));
  const fmt = (ts: string) => `${diaBrt(new Date(ts)).split("-").reverse().slice(0, 2).join("/")} ${horaBrt(new Date(ts))}`;
  const fontes =
    `MENSAGENS QUE BATEM COM A PERGUNTA:\n` +
    (achadas.length ? achadas.sort((a, b) => a.ts.localeCompare(b.ts)).map((m) =>
      `- [${m.grupo}] ${fmt(m.ts)} ${m.autor_nome ?? "alguém"}: ${String(m.texto).slice(0, 700)}`).join("\n") : "(nenhuma)") +
    `\n\nINSTRUÇÕES E PENDÊNCIAS REGISTRADAS:\n` +
    (itens.length ? itens.map((i) => `- [${nomes.get(i.jid) ?? "grupo"}] ${fmt(i.ts)} ${i.tipo}: ${i.titulo}${i.detalhe ? " — " + String(i.detalhe).slice(0, 300) : ""}`).join("\n") : "(nenhuma)") +
    `\n\nRESUMOS DOS DIAS:\n` +
    (resumos.length ? resumos.map((r) => `- [${nomes.get(r.jid) ?? "grupo"}] ${r.dia.split("-").reverse().join("/")}:\n${r.texto}`).join("\n") : "(nenhum)");
  const resposta = (await ia("grupos_pergunta", cfg.modelo_resumo,
    QUEM + " Responda só com base nas fontes abaixo. Cite grupo, quem disse e quando. Se as fontes não respondem, diga isso claramente e sugira outra forma de perguntar.",
    `PERGUNTA: ${pergunta}\n\nPERÍODO: últimos ${dias} dias.\n\n${fontes}`, { max: 8000 })).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();
  return { resposta, fontes: { mensagens: achadas.length, itens: itens.length, resumos: resumos.length } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const acao = String(body.action ?? "");

  try {
    if (acao === "processar") return json(await processar());

    await sessao(body.token);
    const cfg = await config();

    if (acao === "estado") return json(await estado());

    if (acao === "grupo_salvar") {
      const jid = String(body.jid ?? "");
      exige(JID_GRUPO.test(jid), "Grupo inválido.");
      const p: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (body.tipo !== undefined) { exige(TIPOS_GRUPO.includes(body.tipo), "Tipo inválido."); p.tipo = body.tipo; }
      if (body.ativo !== undefined) { p.ativo = body.ativo === true; if (body.ativo === true) p.ligado_em = new Date().toISOString(); }
      // a mensagem nova mais antiga que pode virar aviso é a de depois de ligar
      if (body.ativo === true) {
        const [g] = await linhas(`grupos?jid=eq.${q(jid)}&select=tipo,sugestao,ativo`);
        if (g?.ativo) delete p.ligado_em;
      }
      await patch(`grupos?jid=eq.${q(jid)}`, p);
      // ligou agora: traz os últimos 3 dias para o grupo não começar vazio (já triados, sem aviso)
      if (body.ativo === true && (body.tipo ?? "") !== "envios") {
        const traz = (async () => {
          const antes = new Set((await linhas(`grupo_mensagens?jid=eq.${q(jid)}&select=id&limit=1`)).map((x) => x.id));
          if (antes.size) return;
          await lerMensagens(cfg, new Date(Date.now() - 3 * 86_400_000), jid, true);
        })().catch((e) => console.error("histórico", jid, e));
        // @ts-ignore EdgeRuntime existe no Supabase
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(traz); else await traz;
      }
      return json({ ok: true });
    }

    if (acao === "grupos_sugeridos") {
      const sug = await linhas("grupos?sugestao=in.(instrucoes,licenciados)&ativo=eq.false&select=jid,sugestao");
      for (const g of sug) {
        await patch(`grupos?jid=eq.${q(g.jid)}`, { ativo: true, tipo: g.sugestao, ligado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
      }
      return json({ ok: true, ligados: sug.length });
    }

    if (acao === "sincronizar") return json({ ok: true, grupos: await sincronizarGrupos(cfg) });

    if (acao === "mensagens") {
      const jid = String(body.jid ?? "");
      exige(JID_GRUPO.test(jid), "Grupo inválido.");
      let msgs = await linhas(`grupo_mensagens?jid=eq.${q(jid)}&select=id,ts,autor,autor_nome,de_mim,texto,cita_texto&order=ts.desc&limit=150`);
      let ao_vivo = false;
      if (!msgs.length) {
        // grupo desligado: mostra direto da Evolution, sem gravar
        const recs = await buscarMensagens(cfg.instancia, new Date(Date.now() - 3 * 86_400_000), new Date(Date.now() + 3_600_000), jid, 2);
        const meus = new Set<string>(cfg.meus_jids ?? []);
        const vistos = new Set<string>();
        msgs = recs.map((r) => paraLinha(r, meus)).filter((l) => l && !vistos.has(l.id) && vistos.add(l.id))
          .sort((a: any, b: any) => b.ts.localeCompare(a.ts)).slice(0, 150)
          .map(({ _alt, ...l }: any) => l);
        ao_vivo = true;
      }
      return json({ mensagens: msgs.reverse(), ao_vivo });
    }

    if (acao === "item") {
      const id = String(body.id ?? "");
      exige(UUID.test(id) && ["novo", "visto", "feito", "ignorado"].includes(body.status), "Pedido inválido.");
      await patch(`grupo_itens?id=eq.${id}`, { status: body.status });
      return json({ ok: true });
    }

    if (acao === "resumir") {
      const jid = String(body.jid ?? "");
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dia ?? "")) ? String(body.dia) : diaBrt();
      const [g] = await linhas(`grupos?jid=eq.${q(jid)}&select=jid,nome,tipo`);
      exige(g, "Grupo inválido.");
      const texto = await resumirGrupo(cfg, g, dia);
      exige(texto, "Esse grupo não tem mensagens guardadas nesse dia.");
      return json({ ok: true, texto });
    }

    if (acao === "perguntar") return json(await perguntar(cfg, body));

    if (acao === "envio_salvar") {
      const e = lerEnvio(body);
      const id = body.id ? String(body.id) : null;
      if (id) {
        exige(UUID.test(id), "Envio inválido.");
        await patch(`grupo_envios?id=eq.${id}`, { ...e, ativo: true, ultimo_erro: null, atualizado_em: new Date().toISOString() });
        return json({ ok: true, id });
      }
      const [novo] = await rest("grupo_envios", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(e) });
      return json({ ok: true, id: novo?.id });
    }

    if (acao === "envio_pausar") {
      const id = String(body.id ?? "");
      exige(UUID.test(id), "Envio inválido.");
      const [e] = await linhas(`grupo_envios?id=eq.${id}&select=*`);
      exige(e, "Envio não encontrado.");
      if (body.ativo === true) {
        const prox = e.repetir === "nao" ? (Date.parse(e.proximo_em ?? "") > Date.now() ? new Date(e.proximo_em) : null) : proximaVez(e, new Date());
        exige(prox, "Esse envio não tem mais data. Edite e escolha outra.");
        await patch(`grupo_envios?id=eq.${id}`, { ativo: true, proximo_em: prox!.toISOString(), atualizado_em: new Date().toISOString() });
      } else {
        await patch(`grupo_envios?id=eq.${id}`, { ativo: false, atualizado_em: new Date().toISOString() });
      }
      return json({ ok: true });
    }

    if (acao === "envio_remover") {
      const id = String(body.id ?? "");
      exige(UUID.test(id), "Envio inválido.");
      await rest(`grupo_envios?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return json({ ok: true });
    }

    if (acao === "envio_teste") {
      const texto = String(body.texto ?? "").trim();
      exige(texto, "Escreva a mensagem.");
      const r = await enviarTexto(cfg.instancia_avisos, cfg.numero_avisos,
        `🧪 *Teste de envio* (é assim que chega nos grupos${body.mencionar !== false ? ", com todos mencionados" : ""}):\n\n${montarTexto(texto)}`);
      exige(r.ok, `Não saiu: ${r.erro}`);
      return json({ ok: true });
    }

    if (acao === "config_salvar") {
      const p: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
      if (body.avisar !== undefined) p.avisar = body.avisar === true;
      if (body.resumo_hora !== undefined) {
        const h = Math.round(Number(body.resumo_hora));
        exige(h >= 0 && h <= 23, "Hora inválida.");
        p.resumo_hora = h;
      }
      await patch("grupos_config?id=eq.1", p);
      return json({ ok: true });
    }

    throw new Recusa("Ação desconhecida.");
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    console.error("grupos", acao, e);
    return json({ error: "Algo deu errado. Tente de novo em instantes." }, 500);
  }
});
