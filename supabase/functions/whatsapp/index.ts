// A NOVA PROFISSÃO — função "whatsapp"
// Conecta um número via QR (instância nova a cada conexão),
// informa o estado e avisa os destinatários quando entra um lead.
// A chave da Evolution vive nos Secrets do Supabase, nunca no site.

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL  = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "A Nova Profissao <onboarding@resend.dev>";

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

async function enviarEmail(para: string, assunto: string, texto: string) {
  if (!RESEND_KEY) return { ok: false, status: 0, body: "RESEND_API_KEY nao configurada" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [para],
      subject: assunto,
      text: texto,
      html: `<pre style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${
        texto.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))
      }</pre>`,
    }),
  });
  const t = await r.text();
  return { ok: r.ok, status: r.status, body: t.slice(0, 400) };
}

// toda tentativa vira uma linha — é isto que responde "por que nao chegou"
async function registrar(linhas: unknown[]) {
  if (!linhas.length) return;
  await fetch(`${SB_URL}/rest/v1/notificacoes_log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "return=minimal",
    },
    body: JSON.stringify(linhas),
  }).catch(() => {});
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
      // reenvio manual: o painel manda só o id e a função busca o lead
      let L: any = body.record ?? {};
      if (!L?.nome && body.lead_id) {
        const achado = await db(`leads?id=eq.${body.lead_id}&select=*`);
        L = achado?.[0] ?? {};
      }

      const dest = await db("notificacao_destinatarios?ativo=eq.true&select=numero,email,nome");
      if (!dest?.length) return json({ error: "Nenhum destinatário ativo" }, 400);

      const ehTeste = acao === "teste";
      // quem veio pelo botão de cadastro direto já decidiu: o aviso é outro
      const ehDireto = L.tipo === "direto";
      const onde = `${L.cidade ?? "?"}/${L.uf ?? "?"}`;

      const corpoDireto = [
        "🔴 *CADASTRO DIRETO — pessoa decidida*", "",
        `*${L.nome ?? "?"}*`,
        `WhatsApp: ${L.whatsapp ?? "?"}`,
        `E-mail: ${L.email ?? "—"}`, "",
        "Essa pessoa nao fez o quiz: clicou para se cadastrar agora e foi",
        "levada ao cadastro oficial. Fale com ela hoje — provavelmente esta",
        "com o formulario da iGreen aberto neste momento.", "",
        `Origem: ${L.utm_source ?? "direto"}${L.utm_campaign ? " / " + L.utm_campaign : ""}`,
        L.whatsapp_e164 ? `Abrir conversa: https://wa.me/${L.whatsapp_e164}` : "",
      ];

      const corpoQuiz = [
        "*Lead novo — A Nova Profissao*", "",
        `${L.nome ?? "?"} — ${onde}`,
        `WhatsApp: ${L.whatsapp ?? "?"}`, "",
        `Objetivo: ${L.objetivo ?? "—"}`,
        `Disponibilidade: ${L.tempo ?? "—"}`,
        `Experiencia: ${L.experiencia ?? "—"}`,
        `Interesse: ${L.solucao ?? "—"}`,
        `Perfil: ${L.perfil ?? "—"}`, "",
        `Origem: ${L.utm_source ?? "direto"}${L.utm_campaign ? " / " + L.utm_campaign : ""}`,
        L.whatsapp_e164 ? `Abrir conversa: https://wa.me/${L.whatsapp_e164}` : "",
      ];

      const texto = ehTeste
        ? "Teste do A Nova Profissao. Se voce recebeu esta mensagem, os avisos de lead estao funcionando."
        : (ehDireto ? corpoDireto : corpoQuiz).filter(Boolean).join("\n");

      const assunto = ehTeste
        ? "Teste de aviso — A Nova Profissao"
        : ehDireto
          ? `🔴 CADASTRO DIRETO: ${L.nome ?? "?"} foi para o cadastro agora`
          : `Lead novo: ${L.nome ?? "?"} — ${onde}`;

      const cfg = await db("whatsapp_config?id=eq.1&select=instancia");
      const inst = cfg?.[0]?.instancia;

      const log: any[] = [];
      let zap = 0, mail = 0;

      await Promise.allSettled(dest.flatMap((d: any) => {
        const tarefas: Promise<void>[] = [];

        if (d.numero) {
          tarefas.push((async () => {
            if (!inst) {
              log.push({ lead_id: L.id ?? null, lead_nome: L.nome ?? null, canal: "whatsapp",
                         destino: d.numero, ok: false, detalhe: "Nenhum WhatsApp conectado" });
              return;
            }
            const r = await enviar(inst, d.numero, texto);
            if (r.ok) zap++;
            log.push({ lead_id: L.id ?? null, lead_nome: L.nome ?? null, canal: "whatsapp",
                       destino: d.numero, ok: r.ok,
                       detalhe: r.ok ? null : `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}` });
          })());
        }

        if (d.email) {
          tarefas.push((async () => {
            const r = await enviarEmail(d.email, assunto, texto.replace(/\*/g, ""));
            if (r.ok) mail++;
            log.push({ lead_id: L.id ?? null, lead_nome: L.nome ?? null, canal: "email",
                       destino: d.email, ok: r.ok,
                       detalhe: r.ok ? null : `HTTP ${r.status}: ${r.body}` });
          })());
        }

        return tarefas;
      }));

      await registrar(log);
      const falhas = log.filter((l) => !l.ok);
      return json({
        ok: falhas.length === 0,
        whatsapp: zap, email: mail, total: log.length,
        falhas: falhas.map((l) => `${l.canal} ${l.destino}: ${l.detalhe}`),
      });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
