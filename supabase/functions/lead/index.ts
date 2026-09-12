// ============================================================
// A Nova Profissão — recebe o lead, salva e avisa o Jimmy.
// Deploy:  supabase functions deploy lead --no-verify-jwt
//
// Secrets necessários (Supabase > Edge Functions > Secrets):
//   SUPABASE_URL                (já vem preenchido)
//   SUPABASE_SERVICE_ROLE_KEY   (já vem preenchido)
//   EVOLUTION_URL               ex: https://sua-evolution.com.br
//   EVOLUTION_INSTANCE          ex: Lembretes Jimmy
//   EVOLUTION_APIKEY            a chave da sua Evolution
//   NOTIFY_WHATSAPP             5548991067007
//   RESEND_API_KEY              chave do Resend (e-mail)
//   NOTIFY_EMAIL                contato@jimmyfenner.com.br
//   EMAIL_FROM                  ex: leads@anovaprofissao.com.br
// ============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const env = (k: string) => Deno.env.get(k) ?? "";
const txt = (v: unknown, max = 300) =>
  typeof v === "string" ? v.trim().slice(0, max) || null : null;

function digits(v: unknown): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  return d.startsWith("55") ? d : "55" + d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const nome = txt(body.nome, 120);
  const zap = digits(body.whatsapp);
  if (!nome || !zap) return json({ error: "Nome e WhatsApp são obrigatórios" }, 400);

  const lead = {
    nome,
    whatsapp: txt(body.whatsapp, 40),
    whatsapp_e164: zap,
    cidade: txt(body.cidade, 120),
    uf: txt(body.uf, 2),
    objetivo: txt(body.objetivo),
    tempo: txt(body.tempo),
    experiencia: txt(body.experiencia),
    solucao: txt(body.solucao),
    perfil: txt(body.perfil),
    utm_source: txt(body.utm_source, 120),
    utm_medium: txt(body.utm_medium, 120),
    utm_campaign: txt(body.utm_campaign, 120),
    utm_content: txt(body.utm_content, 120),
    utm_term: txt(body.utm_term, 120),
    landing: txt(body.landing, 300),
    referrer: txt(body.referrer, 300),
    device: txt(body.device, 40),
  };

  // ---- 1. salvar (prioridade absoluta) ----
  const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(lead),
  });

  if (!res.ok) {
    console.error("falha ao gravar lead:", res.status, await res.text());
    return json({ error: "Não foi possível registrar agora" }, 500);
  }
  const [salvo] = await res.json();

  // ---- 2. avisar (nunca derruba o salvamento) ----
  const resumo =
    `🟢 Lead novo — A Nova Profissão\n\n` +
    `${lead.nome} — ${lead.cidade ?? "?"}/${lead.uf ?? "?"}\n` +
    `WhatsApp: ${lead.whatsapp}\n\n` +
    `Objetivo: ${lead.objetivo ?? "—"}\n` +
    `Disponibilidade: ${lead.tempo ?? "—"}\n` +
    `Experiência: ${lead.experiencia ?? "—"}\n` +
    `Interesse: ${lead.solucao ?? "—"}\n` +
    `Perfil: ${lead.perfil ?? "—"}\n\n` +
    `Origem: ${lead.utm_source ?? "direto"}` +
    (lead.utm_campaign ? ` / ${lead.utm_campaign}` : "") + `\n` +
    `Abrir conversa: https://wa.me/${zap}`;

  await Promise.allSettled([notifyWhatsApp(resumo), notifyEmail(lead, resumo)]);

  return json({ ok: true, id: salvo?.id ?? null });
});

async function notifyWhatsApp(texto: string) {
  const url = env("EVOLUTION_URL"), inst = env("EVOLUTION_INSTANCE");
  const key = env("EVOLUTION_APIKEY"), to = env("NOTIFY_WHATSAPP");
  if (!url || !inst || !key || !to) return;
  const r = await fetch(`${url.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(inst)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ number: to, text: texto }),
  });
  if (!r.ok) console.error("evolution:", r.status, await r.text());
}

async function notifyEmail(lead: Record<string, unknown>, resumo: string) {
  const key = env("RESEND_API_KEY"), to = env("NOTIFY_EMAIL"), from = env("EMAIL_FROM");
  if (!key || !to || !from) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: `A Nova Profissão <${from}>`,
      to: [to],
      subject: `Lead novo: ${lead.nome} — ${lead.cidade ?? "?"}/${lead.uf ?? "?"}`,
      text: resumo,
    }),
  });
  if (!r.ok) console.error("resend:", r.status, await r.text());
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
