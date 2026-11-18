// A NOVA PROFISSÃO — função "conversa" (17/11/2026)
// Conversa com o lead pelo iGreen Turbo, no mesmo modelo do igreencel e do
// querocarregador: as mensagens ficam no Turbo, que recebe os dois números do
// Jimmy (pessoal 7007 e carregador 2413), e o painel lê, envia e agenda pela
// API pública de lá, com o token do workspace dele (segredo TURBO_TOKEN, o
// mesmo do diário de reuniões; gerado em Turbo › Configurações › Extensão do
// navegador). Só quem entra no /admin usa (login do Supabase deste projeto).
//
//   {action:"ler", numero}                                   → {mensagens, erros}   (e grava o selo)
//   {action:"enviar", numero, nome, instancia, tipo:"text", texto}                   → {ok, pendente}
//   {action:"enviar", numero, nome, instancia, tipo:"audio"|"ptv"|"image"|"video"|"document",
//    media_url, mime_type, filename?, legenda?}                                      → {ok, pendente}
//   {action:"upload", nome, tipo}                            → {upload_url, public_url} (o navegador sobe direto no Turbo)
//   {action:"fluxos"}                                        → {flows, folders}
//   {action:"etapas", fluxo}                                 → {steps}
//   {action:"fluxo", numero, nome, instancia, fluxo, etapa?} → {ok}                 (inteiro ou a partir da etapa)
//   {action:"resumos", numeros}                              → {resumos, erros}      (selos da lista, até 25)
//   {action:"agendar", numero, nome, instancia, texto, quando, cancelar_se_responder}  → {item}
//   {action:"agendadas", numero?}                            → {itens}              (atualiza as do Turbo; sem número, todas)
//   {action:"cancelar_agendada", id}                         → {item}
//
// Publicar: supabase functions deploy conversa --project-ref buapklmgdjcoyzrmhhcd --use-api
// (verify_jwt ligado: o painel chama com o login).

import {
  CONV_NUMEROS, convAceitaLegenda, convEhInstancia, convEhUuid, convJuntar, convNumeroValido, convResumir, convTipoValido,
} from "../_shared/conversa.mjs";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TURBO = "https://igreenturbo.com.br";
const TURBO_TOKEN = Deno.env.get("TURBO_TOKEN") ?? "";

/** Ler é rápido; esperar mais só prende a tela. */
const LIMITE_LEITURA_MS = 15_000;
/** O Turbo só confirma depois que a Evolution aceita a mensagem (áudio e vídeo levam mais). */
const LIMITE_ENVIO_MS = 75_000;
/** O fluxo só responde quando termina de mandar as etapas (com as esperas entre elas). */
const LIMITE_FLUXO_MS = 110_000;
/** Selos por pedido e leituras simultâneas no Turbo, para não sobrecarregar o Turbo. */
const MAX_RESUMOS = 25;
const SIMULTANEOS = 4;
/** O Turbo aceita até 4.000 caracteres numa agendada e até um ano à frente. */
const MAX_AGENDADA = 4000;
const MAX_AGENDAR_DIAS = 180;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

class Recusa extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

type Instancia = "pessoal" | "carregador";
type MensagemDoTurbo = {
  id: string; direction: "in" | "out"; msg_type: string; content: string | null; media_url: string | null;
  sent_at: string | null; delivery_status: string | null; author_type: string | null;
};
type Resumo = ReturnType<typeof convResumir>;
type AgendadaDoTurbo = {
  id: string; contact_id: string; instance_id: string | null; message: string | null; scheduled_at: string;
  status: string; error: string | null; cancel_on_inbound: boolean | null; kind: string | null; instance_name?: string | null;
};

// ── banco (service role, só daqui) ───────────────────────────
async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  let corpo: any = null;
  try { corpo = txt ? JSON.parse(txt) : null; } catch { corpo = txt; }
  if (!r.ok) throw new Error(`rest ${path.split("?")[0]} HTTP ${r.status}: ${String(txt).slice(0, 300)}`);
  return corpo;
}
const semTabela = (e: unknown) => /PGRST205|42P01|schema cache/.test(String((e as Error)?.message ?? e));

// login do painel: qualquer usuário válido do Supabase deste projeto (os licenciados entram no /painel por outro caminho)
async function usuario(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === SB_KEY) return null;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return typeof u?.id === "string" ? u.id : null;
}

// espelho de licenciado: a página disse ao lead que quem chama é o licenciado — nunca por aqui
async function conferirLicenciado(numero: string) {
  const ls = await rest(`leads?select=id,licenciado&whatsapp_e164=eq.${numero}&limit=50`).catch(() => []);
  if (Array.isArray(ls) && ls.length && ls.every((l: any) => l.licenciado)) {
    throw new Recusa("Lead de espelho de licenciado: quem chama é o licenciado, então não dá para mandar mensagem por aqui.");
  }
}

// ── iGreen Turbo ─────────────────────────────────────────────
type RespostaTurbo<T> = { ok: true; dados: T } | { ok: false; mensagem: string; codigo?: string; status?: number };

async function turbo<T>(path: string, corpo: object | null, limiteMs: number): Promise<RespostaTurbo<T>> {
  if (!TURBO_TOKEN) return { ok: false, mensagem: "O painel ainda não está ligado ao iGreen Turbo (falta a chave do workspace)." };
  try {
    const r = await fetch(`${TURBO}${path}`, {
      method: corpo ? "POST" : "GET",
      headers: corpo ? { Authorization: `Bearer ${TURBO_TOKEN}`, "Content-Type": "application/json" } : { Authorization: `Bearer ${TURBO_TOKEN}` },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(limiteMs),
    });
    if (r.ok) return { ok: true, dados: (await r.json().catch(() => ({}))) as T };
    const resposta = await r.json().catch(() => null);
    console.error("[turbo]", path.split("?")[0], r.status, resposta?.error);
    if (r.status === 401) return { ok: false, mensagem: "O iGreen Turbo recusou a chave do painel.", status: 401 };
    return {
      ok: false,
      status: r.status,
      codigo: typeof resposta?.error === "string" ? resposta.error : undefined,
      mensagem: typeof resposta?.message === "string" && resposta.message ? resposta.message : `O iGreen Turbo respondeu com erro (${r.status}).`,
    };
  } catch (e) {
    console.error("[turbo]", path.split("?")[0], (e as Error).message);
    return { ok: false, mensagem: "O iGreen Turbo não respondeu a tempo." };
  }
}

/** Recusa do Turbo num envio, em palavras de quem está no painel. */
function recusaDoEnvio(r: { mensagem: string; codigo?: string }) {
  if (r.codigo === "instance_disconnected") return json({ error: "Esse WhatsApp está desconectado no iGreen Turbo. Conecte por lá e mande de novo." }, 502);
  if (r.codigo === "not_on_whatsapp") return json({ error: "Esse número não tem WhatsApp." }, 400);
  if (r.codigo === "flow_inactive") return json({ error: "Esse fluxo está desativado no iGreen Turbo. Ative lá e mande de novo." }, 400);
  if (["invalid_media", "invalid_kind", "empty_text", "invalid_mime", "empty_message", "message_too_long", "invalid_date", "past_date", "far_date"].includes(r.codigo ?? ""))
    return json({ error: r.mensagem }, 400);
  // Sem resposta a mensagem pode ter saído: quem enviou olha a conversa antes de repetir.
  return json({ error: `${r.mensagem} Confira a conversa antes de mandar de novo.` }, 502);
}

/** Texto curto e limpo, ou "" (corta no tamanho que o Turbo aceita). */
const curto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** O Turbo exige um nome para criar o contato quando o número é novo lá. */
const nomeDoLead = (v: unknown) => curto(v, 120) || "Lead do A Nova Profissão";
const instanciaDo = (v: unknown): Instancia => (convEhInstancia(v) ? v as Instancia : CONV_NUMEROS[0].instancia as Instancia);

// ── leitura da conversa e selo ───────────────────────────────
function lerNoNumero(numero: string, instancia: Instancia) {
  const q = new URLSearchParams({ phone: numero, limit: "40", instance_name: instancia });
  return turbo<{ contact_id: string | null; messages: MensagemDoTurbo[] }>(`/api/public/extension/messages?${q}`, null, LIMITE_LEITURA_MS);
}

/** A conversa do lead nos dois números, junta; os erros de cada número; e o contato dele em cada um. */
async function lerConversa(numero: string) {
  const respostas = await Promise.all(CONV_NUMEROS.map((n: { instancia: string }) => lerNoNumero(numero, n.instancia as Instancia)));
  const porInstancia: Record<string, MensagemDoTurbo[]> = {};
  const contatos: Record<string, string> = {};
  const erros: string[] = [];
  respostas.forEach((r, i) => {
    const { instancia, rotulo } = CONV_NUMEROS[i];
    if (r.ok) {
      porInstancia[instancia] = Array.isArray(r.dados.messages) ? r.dados.messages : [];
      if (convEhUuid(r.dados.contact_id)) contatos[instancia] = r.dados.contact_id as string;
    } else erros.push(`${rotulo}: ${r.mensagem}`);
  });
  // Só grava o selo quando os dois números responderam; com um faltando, o resumo sairia incompleto.
  return { mensagens: convJuntar(porInstancia), erros, contatos, completo: erros.length === 0 };
}

async function gravarResumo(numero: string, resumo: Resumo, contatos: Record<string, string>) {
  await rest("conversa_resumo?on_conflict=numero", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ numero, ...resumo, contatos, atualizado_em: new Date().toISOString() }),
  }).catch((e) => { if (!semTabela(e)) console.error("[resumo]", (e as Error).message); });
}

/** Roda as tarefas com no máximo `limite` ao mesmo tempo. */
async function emLotes<T>(itens: T[], limite: number, tarefa: (item: T) => Promise<void>) {
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) await tarefa(itens[proximo++]);
  }));
}

// ── agendadas no Turbo ───────────────────────────────────────
type Linha = {
  id: string; numero: string; contato_id: string; instancia: string | null; texto: string; quando: string; status: string;
  cancelar_se_responder: boolean; erro: string | null; atualizado_em: string;
};

function linhaDa(a: AgendadaDoTurbo, numero: string, instancia: string | null): Linha {
  return {
    id: a.id, numero, contato_id: a.contact_id, instancia,
    texto: (a.message ?? "").trim() || `[${a.kind && a.kind !== "message" ? a.kind : "mensagem"}]`,
    quando: a.scheduled_at, status: a.status, cancelar_se_responder: a.cancel_on_inbound === true,
    erro: a.error ?? null, atualizado_em: new Date().toISOString(),
  };
}

async function gravarAgendadas(linhas: Linha[]) {
  if (!linhas.length) return;
  await rest("conversa_agendadas?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(linhas),
  });
}

/**
 * Lê no Turbo as agendadas dos contatos conhecidos (do selo e das já agendadas por aqui) e
 * atualiza a tabela. Pega também as agendadas pela Inbox do Turbo. Sem número: as pendentes
 * daqui e as conversas dos últimos 60 dias.
 */
async function sincronizarAgendadas(numero: string | null) {
  const resumos: any[] = numero
    ? await rest(`conversa_resumo?select=numero,contatos&numero=eq.${numero}`)
    : await rest(`conversa_resumo?select=numero,contatos&ultima_em=gte.${new Date(Date.now() - 60 * 864e5).toISOString()}&limit=1000`);
  const locais: Linha[] = numero
    ? await rest(`conversa_agendadas?numero=eq.${numero}&order=quando.desc&limit=200`)
    : await rest("conversa_agendadas?status=in.(pending,processing)&limit=1000");

  // contato no Turbo -> número e instância
  const porContato = new Map<string, { numero: string; instancia: string | null }>();
  for (const r of resumos) {
    for (const [inst, id] of Object.entries(r.contatos ?? {})) if (convEhUuid(id)) porContato.set(id as string, { numero: r.numero, instancia: inst });
  }
  for (const l of locais) if (!porContato.has(l.contato_id)) porContato.set(l.contato_id, { numero: l.numero, instancia: l.instancia });
  const ids = [...porContato.keys()];
  const vistas = new Set<string>();
  const linhas: Linha[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const r = await turbo<{ items: AgendadaDoTurbo[] }>(`/api/public/extension/schedule?contact_ids=${lote.join(",")}`, null, LIMITE_LEITURA_MS);
    if (!r.ok) throw new Recusa(r.mensagem, 502);
    for (const a of r.dados.items ?? []) {
      const dono = porContato.get(a.contact_id);
      if (!dono || !convEhUuid(a.id)) continue;
      vistas.add(a.id);
      linhas.push(linhaDa(a, dono.numero, dono.instancia));
    }
  }
  // pendente daqui que o Turbo não devolveu mais: foi apagada lá
  for (const l of locais) {
    if ((l.status === "pending" || l.status === "processing") && !vistas.has(l.id)) {
      linhas.push({ ...l, status: "cancelled", erro: "Não está mais no iGreen Turbo", atualizado_em: new Date().toISOString() });
    }
  }
  await gravarAgendadas(linhas);
  return numero ? linhas.filter((l) => l.numero === numero) : linhas;
}

function quandoValido(v: unknown): string {
  const ms = Date.parse(String(v ?? ""));
  if (!Number.isFinite(ms)) throw new Recusa("Escolha o dia e a hora.");
  if (ms < Date.now() - 60_000) throw new Recusa("Esse horário já passou.");
  if (ms > Date.now() + MAX_AGENDAR_DIAS * 864e5) throw new Recusa(`Agende para no máximo ${MAX_AGENDAR_DIAS} dias à frente.`);
  return new Date(ms).toISOString();
}

async function agendar(b: Record<string, unknown>) {
  if (!convNumeroValido(b.numero)) throw new Recusa("Número inválido.");
  const numero = b.numero as string;
  const texto = typeof b.texto === "string" ? b.texto.trim() : "";
  if (!texto) throw new Recusa("Escreva a mensagem.");
  if (texto.length > MAX_AGENDADA) throw new Recusa("Mensagem agendada vai com até 4.000 caracteres.");
  const quando = quandoValido(b.quando);
  const instancia = instanciaDo(b.instancia);
  await conferirLicenciado(numero);
  // O contato precisa existir no número escolhido (lead novo ainda não está no Turbo).
  const c = await turbo<{ contact_id: string }>(
    "/api/public/extension/lead-contact",
    { phone: numero, name: nomeDoLead(b.nome), instance_name: instancia },
    LIMITE_LEITURA_MS,
  );
  if (!c.ok) {
    if (c.codigo === "instance_disconnected") throw new Recusa("Esse WhatsApp está desconectado no iGreen Turbo. Conecte por lá e agende de novo.", 502);
    if (c.codigo === "not_on_whatsapp") throw new Recusa("Esse número não tem WhatsApp.");
    throw new Recusa(c.mensagem, 502);
  }
  if (!convEhUuid(c.dados.contact_id)) throw new Recusa("O iGreen Turbo não devolveu o contato do lead.", 502);
  const r = await turbo<{ item: AgendadaDoTurbo }>("/api/public/extension/schedule", {
    action: "create", contact_id: c.dados.contact_id, message: texto, scheduled_at: quando,
    cancel_on_inbound: b.cancelar_se_responder === true,
  }, LIMITE_LEITURA_MS);
  if (!r.ok) throw new Recusa(r.mensagem, r.status && r.status < 500 ? 400 : 502);
  const linha = linhaDa(r.dados.item, numero, instancia);
  await gravarAgendadas([linha]).catch((e) => console.error("[agendar] gravar", (e as Error).message));
  console.log("[conversa] agendou", { instancia, quando });
  return linha;
}

async function cancelarAgendada(id: unknown) {
  if (!convEhUuid(id)) throw new Recusa("Agendamento inválido.");
  const r = await turbo<{ item: AgendadaDoTurbo }>("/api/public/extension/schedule", { action: "cancel", id }, LIMITE_LEITURA_MS);
  const [local] = await rest(`conversa_agendadas?id=eq.${id}&select=*`).catch(() => []);
  if (!r.ok) {
    // já saiu, já foi cancelada ou sumiu: relê o número para o painel mostrar como está
    if (local?.numero) await sincronizarAgendadas(local.numero).catch(() => {});
    throw new Recusa(r.mensagem, r.status === 409 ? 409 : 502);
  }
  const linha = linhaDa(r.dados.item, local?.numero ?? "", local?.instancia ?? null);
  if (local) await gravarAgendadas([linha]).catch((e) => console.error("[cancelar] gravar", (e as Error).message));
  return linha;
}

// ── entrada ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    if (!(await usuario(req))) return json({ error: "Entre de novo no painel." }, 401);
    const body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const acao = body.action;

    if (acao === "ler") {
      if (!convNumeroValido(body.numero)) return json({ error: "Número inválido." }, 400);
      const { mensagens, erros, contatos, completo } = await lerConversa(body.numero as string);
      if (completo) await gravarResumo(body.numero as string, convResumir(mensagens), contatos);
      return json({ mensagens, erros });
    }

    if (acao === "enviar") {
      if (!convNumeroValido(body.numero)) return json({ error: "Número inválido." }, 400);
      const tipo = body.tipo === undefined ? "text" : body.tipo;
      if (!convTipoValido(tipo)) return json({ error: "Tipo de mensagem inválido." }, 400);
      await conferirLicenciado(body.numero as string);
      let envio: Record<string, unknown>;
      if (tipo === "text") {
        // O texto vai inteiro, com as quebras de linha; só as pontas são aparadas.
        const texto = typeof body.texto === "string" ? body.texto.trim() : "";
        if (!texto) return json({ error: "Escreva a mensagem." }, 400);
        if (texto.length > 4096) return json({ error: "A mensagem passou de 4.096 caracteres." }, 400);
        envio = { kind: "text", text: texto };
      } else {
        const mediaUrl = curto(body.media_url, 1000);
        const mime = curto(body.mime_type, 120).toLowerCase();
        if (!/^https:\/\//.test(mediaUrl) || !mime) return json({ error: "O arquivo não subiu direito. Anexe de novo." }, 400);
        const legenda = convAceitaLegenda(tipo) && typeof body.legenda === "string" ? body.legenda.trim().slice(0, 1024) : "";
        envio = {
          kind: tipo, media_url: mediaUrl, mime_type: mime,
          ...(curto(body.filename, 200) ? { filename: curto(body.filename, 200) } : {}),
          ...(legenda ? { caption: legenda } : {}),
        };
      }
      const instancia = instanciaDo(body.instancia);
      const r = await turbo<{ message_id: string | null; pending: boolean }>(
        "/api/public/extension/send",
        { phone: body.numero, name: nomeDoLead(body.nome), instance_name: instancia, ...envio },
        LIMITE_ENVIO_MS,
      );
      if (!r.ok) return recusaDoEnvio(r);
      console.log("[conversa] enviou", { tipo, instancia });
      return json({ ok: true, pendente: Boolean(r.dados.pending) });
    }

    if (acao === "upload") {
      const nome = curto(body.nome, 200) || "arquivo";
      const tipo = curto(body.tipo, 120).toLowerCase();
      if (!tipo) return json({ error: "Falta o tipo do arquivo." }, 400);
      const r = await turbo<{ upload_url: string; public_url: string }>(
        "/api/public/extension/send", { action: "upload", filename: nome, mime_type: tipo }, LIMITE_LEITURA_MS,
      );
      if (!r.ok) return json({ error: r.codigo === "invalid_mime" ? "Esse tipo de arquivo não vai pelo WhatsApp." : r.mensagem }, r.codigo === "invalid_mime" ? 400 : 502);
      return json({ upload_url: r.dados.upload_url, public_url: r.dados.public_url });
    }

    if (acao === "fluxos") {
      const r = await turbo<{ flows: unknown[]; folders: unknown[] }>("/api/public/extension/messages?flows=1", null, LIMITE_LEITURA_MS);
      if (!r.ok) return json({ error: r.mensagem }, 502);
      return json({ flows: r.dados.flows ?? [], folders: r.dados.folders ?? [] });
    }

    if (acao === "etapas") {
      if (!convEhUuid(body.fluxo)) return json({ error: "Fluxo inválido." }, 400);
      const r = await turbo<{ steps: unknown[] }>(`/api/public/extension/messages?steps_of=${body.fluxo}`, null, LIMITE_LEITURA_MS);
      if (!r.ok) return json({ error: r.mensagem }, r.codigo === "flow_not_found" ? 404 : 502);
      return json({ steps: r.dados.steps ?? [] });
    }

    if (acao === "fluxo") {
      if (!convNumeroValido(body.numero)) return json({ error: "Número inválido." }, 400);
      if (!convEhUuid(body.fluxo)) return json({ error: "Fluxo inválido." }, 400);
      const etapa = body.etapa == null || body.etapa === "" ? null : body.etapa;
      if (etapa !== null && !convEhUuid(etapa)) return json({ error: "Etapa inválida." }, 400);
      await conferirLicenciado(body.numero as string);
      const instancia = instanciaDo(body.instancia);
      const r = await turbo<{ ok: true }>("/api/public/extension/run-flow", {
        flow_id: body.fluxo, phone: body.numero, name: nomeDoLead(body.nome), instance_name: instancia,
        ...(etapa ? { start_node_id: etapa } : {}),
      }, LIMITE_FLUXO_MS);
      if (!r.ok) return recusaDoEnvio(r);
      console.log("[conversa] mandou fluxo", { etapa: Boolean(etapa), instancia });
      return json({ ok: true });
    }

    if (acao === "resumos") {
      const numeros = Array.isArray(body.numeros) ? [...new Set(body.numeros.filter(convNumeroValido) as string[])].slice(0, MAX_RESUMOS) : [];
      const erros: string[] = [];
      const resumos: Record<string, Resumo> = {};
      await emLotes(numeros, SIMULTANEOS, async (numero) => {
        const { mensagens, erros: e, contatos, completo } = await lerConversa(numero);
        if (!completo) return void erros.push(...e);
        resumos[numero] = convResumir(mensagens);
        await gravarResumo(numero, resumos[numero], contatos);
      });
      return json({ resumos, erros: [...new Set(erros)] });
    }

    if (acao === "agendar") return json({ item: await agendar(body) });

    if (acao === "agendadas") {
      const numero = body.numero == null || body.numero === "" ? null : body.numero;
      if (numero !== null && !convNumeroValido(numero)) return json({ error: "Número inválido." }, 400);
      return json({ itens: await sincronizarAgendadas(numero as string | null) });
    }

    if (acao === "cancelar_agendada") return json({ item: await cancelarAgendada(body.id) });

    return json({ error: "Ação desconhecida." }, 400);
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    if (semTabela(e)) return json({ error: "Falta rodar a migração db/31-conversa.sql." }, 500);
    console.error("conversa:", (e as Error).message);
    return json({ error: "Erro inesperado. Tente de novo." }, 500);
  }
});
