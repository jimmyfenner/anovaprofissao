// A NOVA PROFISSÃO — função "whatsapp"
// Conecta um número via QR (instância nova a cada conexão),
// informa o estado e avisa os destinatários quando entra um lead.
// A chave da Evolution vive nos Secrets do Supabase, nunca no site.

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function evo(path: string, init: RequestInit = {}) {
  const r = await fetch(`${EVO_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: EVO_KEY, ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  let body: unknown = txt;
  try { body = JSON.parse(txt); } catch { /* não-JSON */ }
  return { ok: r.ok, status: r.status, body };
}

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

function novoNome() {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `anovaprofissao-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
         `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// a Evolution já devolveu o QR em vários formatos ao longo das versões
function achaQR(o: any): string | null {
  if (!o || typeof o !== "object") return null;
  const c = o.base64 ?? o.qrcode?.base64 ?? o.qr?.base64 ??
            o.code ?? o.qrcode?.code ?? o.instance?.qrcode?.base64;
  if (typeof c !== "string" || !c) return null;
  return c.startsWith("data:") ? c : `data:image/png;base64,${c}`;
}
function achaEstado(o: any): string {
  return o?.instance?.state ?? o?.state ?? o?.status ??
         o?.instance?.connectionStatus ?? o?.connectionStatus ?? "desconhecido";
}

// tenta o formato v2 e cai para o v1 se a versão do servidor for antiga
async function enviar(inst: string, numero: string, texto: string) {
  let r = await evo(`/message/sendText/${encodeURIComponent(inst)}`, {
    method: "POST", body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!r.ok) {
    r = await evo(`/message/sendText/${encodeURIComponent(inst)}`, {
      method: "POST", body: JSON.stringify({ number: numero, textMessage: { text: texto } }),
    });
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const acao = body.action ?? (body.type === "INSERT" && body.table === "leads" ? "notify" : null);

  try {
    if (acao === "connect") {
      const cfg = await db("whatsapp_config?id=eq.1&select=instancia");
      const antiga = cfg?.[0]?.instancia;
      if (antiga) {
        await evo(`/instance/logout/${encodeURIComponent(antiga)}`, { method: "DELETE" });
        await evo(`/instance/delete/${encodeURIComponent(antiga)}`, { method: "DELETE" });
      }
      const nome = novoNome();
      const criada = await evo("/instance/create", {
        method: "POST",
        body: JSON.stringify({ instanceName: nome, qrcode: true, integration: "WHATSAPP-BAILEYS" }),
      });
      if (!criada.ok) return json({ error: "Não foi possível criar a instância", detalhe: criada.body }, 502);
      let qr = achaQR(criada.body);
      if (!qr) qr = achaQR((await evo(`/instance/connect/${encodeURIComponent(nome)}`)).body);
      await db("whatsapp_config?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify({ instancia: nome, conectada_em: null, atualizado_em: new Date().toISOString() }),
      });
      return json({ ok: true, instancia: nome, qr });
    }

    if (acao === "status") {
      const cfg = await db("whatsapp_config?id=eq.1&select=instancia,conectada_em");
      const inst = cfg?.[0]?.instancia;
      if (!inst) return json({ ok: true, instancia: null, estado: "sem_instancia" });
      const estado = achaEstado((await evo(`/instance/connectionState/${encodeURIComponent(inst)}`)).body);
      if (estado === "open" && !cfg?.[0]?.conectada_em) {
        await db("whatsapp_config?id=eq.1", {
          method: "PATCH", body: JSON.stringify({ conectada_em: new Date().toISOString() }),
        });
      }
      return json({ ok: true, instancia: inst, estado });
    }

    if (acao === "disconnect") {
      const cfg = await db("whatsapp_config?id=eq.1&select=instancia");
      const inst = cfg?.[0]?.instancia;
      if (inst) {
        await evo(`/instance/logout/${encodeURIComponent(inst)}`, { method: "DELETE" });
        await evo(`/instance/delete/${encodeURIComponent(inst)}`, { method: "DELETE" });
      }
      await db("whatsapp_config?id=eq.1", {
        method: "PATCH",
        body: JSON.stringify({ instancia: null, conectada_em: null, atualizado_em: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    if (acao === "notify" || acao === "teste") {
      const cfg = await db("whatsapp_config?id=eq.1&select=instancia");
      const inst = cfg?.[0]?.instancia;
      if (!inst) return json({ error: "Nenhum WhatsApp conectado" }, 400);
      const dest = await db("notificacao_destinatarios?ativo=eq.true&select=numero,nome");
      if (!dest?.length) return json({ error: "Nenhum destinatário ativo" }, 400);

      const L = body.record ?? {};
      const texto = acao === "teste"
        ? "Teste do A Nova Profissao. Se voce recebeu esta mensagem, as notificacoes de lead estao funcionando."
        : [
            "*Lead novo — A Nova Profissao*", "",
            `${L.nome ?? "?"} — ${L.cidade ?? "?"}/${L.uf ?? "?"}`,
            `WhatsApp: ${L.whatsapp ?? "?"}`, "",
            `Objetivo: ${L.objetivo ?? "—"}`,
            `Disponibilidade: ${L.tempo ?? "—"}`,
            `Experiencia: ${L.experiencia ?? "—"}`,
            `Interesse: ${L.solucao ?? "—"}`,
            `Perfil: ${L.perfil ?? "—"}`, "",
            `Origem: ${L.utm_source ?? "direto"}${L.utm_campaign ? " / " + L.utm_campaign : ""}`,
            L.whatsapp_e164 ? `Abrir conversa: https://wa.me/${L.whatsapp_e164}` : "",
          ].filter(Boolean).join("\n");

      const envios = await Promise.allSettled(dest.map((d: any) => enviar(inst, d.numero, texto)));
      const okCount = envios.filter((e) => e.status === "fulfilled" && (e as any).value.ok).length;
      return json({ ok: true, enviados: okCount, total: dest.length });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
