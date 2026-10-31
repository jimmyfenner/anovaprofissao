// A NOVA PROFISSÃO — função "conversao-meta"
// Manda o lead de integrador à API de Conversões da Meta: chega mesmo quando o
// navegador bloqueia o pixel (iPhone, bloqueador de anúncios). O event_id é o
// id do lead, o mesmo que a página manda ao pixel, então a Meta conta uma vez só.
// Quem chama é o gatilho do banco (db/16), com a chave de serviço. Toda tentativa
// vira uma linha em notificacoes_log, canal "meta", e o token vive só nos Secrets.

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TOKEN  = Deno.env.get("META_CAPI_TOKEN") ?? "";

const GRAPH_API = "https://graph.facebook.com/v23.0";
const URL_PAGINA = "https://querovendercarregador.com.br/";
const TEMPO_MAXIMO_MS = 15_000;

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      ...(init.headers ?? {}),
    },
  });
  return r.ok ? await r.json().catch(() => null) : null;
}

// a verificação de JWT da plataforma também aceita a chave anon, que é pública
// no site: sem este teste, qualquer pessoa poderia chamar a função. A chave que o
// gatilho manda é a de private_config (formato sb_secret, não é um JWT com papel
// para conferir), então a comparação é com ela.
async function chamadaDoBanco(req: Request) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const cfg = await db("private_config?chave=eq.service_key&select=valor");
  return cfg?.[0]?.valor === token;
}

async function sha256(valor: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(valor.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// a Meta pede cidade sem acento, espaço nem pontuação
const soLetras = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

async function dadosDaPessoa(L: any, ip: string | null, ua: string | null) {
  const nomes = String(L.nome ?? "").trim().split(/\s+/);
  const ud: Record<string, unknown> = {
    fn: [await sha256(nomes[0])],
    country: [await sha256("br")],
    external_id: [await sha256(L.id)],
  };
  const fone = String(L.whatsapp_e164 ?? L.whatsapp ?? "").replace(/\D/g, "");
  if (fone) ud.ph = [await sha256(fone)];
  if (L.email) ud.em = [await sha256(L.email)];
  if (nomes.length > 1) ud.ln = [await sha256(nomes[nomes.length - 1])];
  if (L.cidade && soLetras(L.cidade)) ud.ct = [await sha256(soLetras(L.cidade))];
  if (L.uf) ud.st = [await sha256(L.uf)];
  if (ip) ud.client_ip_address = ip;
  if (ua) ud.client_user_agent = ua;
  if (L.meta_fbp) ud.fbp = L.meta_fbp;
  if (L.meta_fbc) ud.fbc = L.meta_fbc;
  return ud;
}

// devolve ok e o que explica o resultado; o token vai no corpo, não na URL,
// porque o erro de rede do fetch cita a URL e o detalhe aparece no painel
async function enviarLead(pixel: string, L: any, ud: Record<string, unknown>, codigoTeste: string | null) {
  try {
    const r = await fetch(`${GRAPH_API}/${pixel}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: TOKEN,
        data: [{
          event_name: "Lead",
          event_time: Math.floor(new Date(L.criado_em).getTime() / 1000),
          event_id: L.id,
          action_source: "website",
          event_source_url: /^(www\.)?(querovendercarregador|anovaprofissao)\.com\.br(\/|$)/.test(L.landing ?? "")
            ? `https://${L.landing}`
            : URL_PAGINA,
          user_data: ud,
          custom_data: { content_name: "Conexão Mob — integradores", content_category: "integrador" },
        }],
        ...(codigoTeste ? { test_event_code: codigoTeste } : {}),
      }),
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
    const t = await r.text();
    return { ok: r.ok, detalhe: r.ok ? `sinais: ${Object.keys(ud).join(", ")}` : `HTTP ${r.status}: ${t.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, detalhe: String(e).slice(0, 300) };
  }
}

Deno.serve(async (req) => {
  if (!(await chamadaDoBanco(req))) return json({ error: "Sem acesso" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }

  try {
    // Testar eventos: lead fictício, com o código da aba aberta no Gerenciador de Eventos.
    // Sem o código da sessão aberta, a Meta processa como conversão real.
    const ehTeste = body.action === "teste";
    if (ehTeste && !body.test_event_code) return json({ error: "Falta test_event_code" }, 400);

    let L: any = ehTeste
      ? { id: crypto.randomUUID(), criado_em: new Date().toISOString(), nome: "Teste Integrador", whatsapp_e164: "5548900000000" }
      : null;
    if (!ehTeste) {
      if (!/^[0-9a-f-]{36}$/i.test(body.lead_id ?? "")) return json({ error: "lead_id inválido" }, 400);
      L = (await db(`leads?id=eq.${body.lead_id}&select=id,criado_em,nome,whatsapp,whatsapp_e164,email,cidade,uf,landing,meta_fbp,meta_fbc,meta_conversao_enviada`))?.[0];
      if (!L) return json({ error: "Lead não encontrado" }, 404);
      if (L.meta_conversao_enviada === true) return json({ ok: true, repetido: true });
    }

    // o mesmo pixel que a página carrega: se trocar no painel, os dois trocam juntos
    const cfg = await db("site_config?chave=eq.meta_pixel&select=valor");
    const pixel = String(cfg?.[0]?.valor ?? "").replace(/\D/g, "");
    const ua = body.user_agent ?? (ehTeste ? "conversao-meta/teste" : null);

    const res = !TOKEN
      ? { ok: false, detalhe: "META_CAPI_TOKEN nao configurado" }
      : !pixel
        ? { ok: false, detalhe: "meta_pixel vazio no site_config" }
        : await enviarLead(pixel, L, await dadosDaPessoa(L, body.ip ?? null, ua), ehTeste ? body.test_event_code : null);
    if (!res.ok) console.error("[meta]", res.detalhe);

    await db("notificacoes_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: ehTeste ? null : L.id,
        lead_nome: ehTeste ? null : L.nome,
        canal: "meta",
        destino: pixel || null,
        ok: res.ok,
        detalhe: res.detalhe,
      }),
    });
    if (!ehTeste) {
      await db(`leads?id=eq.${L.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ meta_conversao_enviada: res.ok }),
      });
    }
    return json({ ok: res.ok, detalhe: res.detalhe }, res.ok ? 200 : 502);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
