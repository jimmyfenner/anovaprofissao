// A NOVA PROFISSÃO — função "agenda"
// Reunião de 30 min pelo Google Meet na agenda do Jimmy (contato@jimmyfenner.com.br),
// a mesma do querocarregador.com.br: os horários ocupados lá somem daqui e vice-versa.
//   slots   → horários livres (público)
//   book    → marca a reunião e grava o lead (público)
//   excluir → apaga o evento e o lead (só com o login do painel)
// Duas origens: "home" (anovaprofissao.com.br/agendar, apresentação da iGreen Energy,
// exige ciência da licença de R$ 1.997 por ano) e "integradores"
// (querovendercarregador.com.br/agendar, Conexão Mob, exige o vídeo de apresentação).
// O aviso de reunião nova não sai daqui: o gatilho dos leads chama a função
// "whatsapp" quando o lead é gravado, e isso só acontece depois que o evento existe.
// Implantar com --no-verify-jwt: o site chama com a chave anon.

const TZ = "America/Sao_Paulo";
const TZ_OFFSET = "-03:00"; // Brasil sem horário de verão desde 2019
const SLOT_MINUTES = 30;
const MIN_NOTICE_MS = 4 * 60 * 60 * 1000;
const MAX_DAYS_AHEAD = 14;
// Horário de atendimento por dia da semana (0 = domingo), em horas cheias de Brasília.
// Igual ao do querocarregador (terça termina mais cedo).
const WORKING_HOURS: Record<number, [number, number]> = {
  1: [9, 19],
  2: [9, 16],
  3: [9, 19],
  4: [9, 19],
  5: [9, 19],
};

const ORIGENS: Record<string, { titulo: string; solucao: string; site: string }> = {
  home: {
    titulo: "Apresentação iGreen Energy",
    solucao: "Reunião de apresentação da iGreen Energy",
    site: "anovaprofissao.com.br/agendar",
  },
  integradores: {
    titulo: "Conexão Mob (integrador)",
    // "página de integradores" no texto é o que classifica o lead como de lá (painel e contador)
    solucao: "Reunião sobre a Conexão Mob — página de integradores",
    site: "querovendercarregador.com.br/agendar",
  },
};
const ACEITE_HOME = "Ciente de que a licença de licenciado custa R$ 1.997 por ano";
const ACEITE_INTEG = "Assistiu ao vídeo de apresentação";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function db(path: string, init: RequestInit = {}) {
  return await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      ...(init.headers ?? {}),
    },
  });
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function googleAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

const bookingCalendar = () => Deno.env.get("AGENDA_CALENDAR_ID") ?? "primary";

// Agendas consultadas para saber se o Jimmy está ocupado (a de agendamento sempre entra).
function busyCalendars(): string[] {
  const extra = (Deno.env.get("AGENDA_BUSY_CALENDARS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([bookingCalendar(), ...extra]));
}

async function busyIntervals(timeMin: Date, timeMax: Date): Promise<Array<[number, number]>> {
  const token = await googleAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TZ,
      items: busyCalendars().map((id) => ({ id })),
    }),
  });
  if (!res.ok) throw new Error(`Google freeBusy ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const intervals: Array<[number, number]> = [];
  for (const [id, cal] of Object.entries<any>(data.calendars ?? {})) {
    if (cal.errors?.length) {
      // Sem conseguir ler a agenda principal, não dá para garantir que o horário está livre.
      if (id === bookingCalendar()) throw new Error(`freeBusy sem acesso a ${id}`);
      console.warn("freeBusy ignorou agenda", id, cal.errors);
      continue;
    }
    for (const b of cal.busy ?? []) intervals.push([Date.parse(b.start), Date.parse(b.end)]);
  }
  return intervals;
}

// Todos os inícios de horário dentro do expediente, na janela [agora + 4h, agora + 14 dias].
function candidateSlots(now: number): Date[] {
  const slots: Date[] = [];
  const earliest = now + MIN_NOTICE_MS;
  const latest = now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  const todayBrt = new Date(now - 3 * 60 * 60 * 1000); // relógio de Brasília nos getters UTC
  for (let d = 0; d <= MAX_DAYS_AHEAD; d++) {
    const day = new Date(Date.UTC(todayBrt.getUTCFullYear(), todayBrt.getUTCMonth(), todayBrt.getUTCDate() + d));
    const hours = WORKING_HOURS[day.getUTCDay()];
    if (!hours) continue;
    const ymd = day.toISOString().slice(0, 10);
    for (let m = hours[0] * 60; m + SLOT_MINUTES <= hours[1] * 60; m += SLOT_MINUTES) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const start = new Date(`${ymd}T${hh}:${mm}:00${TZ_OFFSET}`);
      if (start.getTime() >= earliest && start.getTime() <= latest) slots.push(start);
    }
  }
  return slots;
}

const overlaps = (start: number, end: number, busy: Array<[number, number]>) =>
  busy.some(([bs, be]) => start < be && end > bs);

async function freeSlots(now: number): Promise<Date[]> {
  const candidates = candidateSlots(now);
  if (!candidates.length) return [];
  const busy = await busyIntervals(
    candidates[0],
    new Date(candidates[candidates.length - 1].getTime() + SLOT_MINUTES * 60_000),
  );
  return candidates.filter((s) => !overlaps(s.getTime(), s.getTime() + SLOT_MINUTES * 60_000, busy));
}

// "2026-11-05T10:00:00-03:00" — mantém o horário de Brasília legível para o site.
const toBrtIso = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19) + TZ_OFFSET;

const OCUPADO = "Esse horário acabou de ser ocupado. Escolha outro, por favor.";

async function apagarEvento(eventoId: string, futuro: boolean) {
  const token = await googleAccessToken();
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendar())}/events/${encodeURIComponent(eventoId)}?sendUpdates=${futuro ? "all" : "none"}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  // 404/410: o evento já não existe, o que dá no mesmo
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google events.delete ${r.status}: ${await r.text()}`);
}

function fone(d: string) {
  const n = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  return n.length === 11 ? `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`
       : n.length === 10 ? `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}` : d;
}
const curto = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }

  try {
    if (body.action === "slots") {
      const slots = await freeSlots(Date.now());
      return json({ slots: slots.map(toBrtIso), slotMinutes: SLOT_MINUTES });
    }

    if (body.action === "book") {
      if (body.site) return json({ ok: true }); // campo-isca: robô preenche, gente não vê
      const origem = ORIGENS[body.origem] ? body.origem : null;
      const nome = curto(body.nome, 120);
      const email = (curto(body.email, 200) ?? "").toLowerCase();
      let digitos = String(body.whatsapp ?? "").replace(/\D/g, "");
      if (digitos.length > 11 && digitos.startsWith("55")) digitos = digitos.slice(2);
      const inicio = new Date(String(body.inicio ?? ""));

      if (!origem) return json({ error: "Origem inválida." }, 400);
      if (!nome || nome.length < 2) return json({ error: "Informe o seu nome." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Informe um e-mail válido: o convite vai para ele." }, 400);
      if (digitos.length < 10 || digitos.length > 11) return json({ error: "Informe o WhatsApp com DDD." }, 400);
      if (isNaN(inicio.getTime())) return json({ error: "Escolha um horário." }, 400);
      if (origem === "home" && body.ciente_investimento !== true) {
        return json({ error: "Para agendar, confirme que sabe do investimento de R$ 1.997 por ano." }, 400);
      }
      if (origem === "integradores" && body.viu_video !== true) {
        return json({ error: "Para agendar, assista antes ao vídeo de apresentação." }, 400);
      }
      const e164 = "55" + digitos;

      // uma reunião futura por pessoa: evita agenda lotada por engano (ou de propósito)
      const quem = `(whatsapp_e164.eq.${e164},email.eq."${email.replace(/["\\]/g, "")}")`;
      const ja = await (await db(
        `leads?tipo=eq.agendamento&agenda_inicio=gt.${encodeURIComponent(new Date().toISOString())}` +
        `&or=${encodeURIComponent(quem)}&select=agenda_inicio&limit=1`,
      )).json().catch(() => []);
      if (Array.isArray(ja) && ja.length) {
        return json({ error: "Você já tem uma reunião marcada. Se precisar mudar o horário, responda o convite ou fale com o Jimmy no WhatsApp.", jaTem: true, inicio: toBrtIso(new Date(ja[0].agenda_inicio)) }, 409);
      }

      // Confere de novo na agenda: o horário pode ter sido ocupado depois que a página carregou.
      const now = Date.now();
      const isCandidate = candidateSlots(now).some((s) => s.getTime() === inicio.getTime());
      const fim = new Date(inicio.getTime() + SLOT_MINUTES * 60_000);
      if (!isCandidate || overlaps(inicio.getTime(), fim.getTime(), await busyIntervals(inicio, fim))) {
        return json({ error: OCUPADO, slotTaken: true }, 409);
      }

      const cfg = ORIGENS[origem];
      const atuacao = origem === "integradores" ? curto(body.atuacao, 120) : null;
      const pct = Number.isFinite(body.video_pct) ? Math.max(0, Math.min(100, Math.round(body.video_pct))) : null;
      const aceite = origem === "home" ? ACEITE_HOME
        : ACEITE_INTEG + (body.video_visto_aqui ? " (no site)" : " (declarou)");

      // Evento primeiro: o lead só existe com reunião de verdade, e é a gravação
      // do lead que dispara o aviso. A descrição é vista também pelo convidado.
      const token = await googleAccessToken();
      const eventRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(bookingCalendar())}/events?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: `${cfg.titulo} — ${nome}`,
            description:
              `Reunião agendada pelo site ${cfg.site}\n\n` +
              `Nome: ${nome}\nWhatsApp: ${fone(e164)}\nE-mail: ${email}\n` +
              (atuacao ? `O que faz hoje: ${atuacao}\n` : "") +
              (origem === "home"
                ? "Ciente de que, para ser licenciado, a licença custa R$ 1.997 por ano: sim\n"
                : "Assistiu ao vídeo de apresentação: sim\n") +
              `\nCom Jimmy Fenner, licenciado independente da iGreen Energy.`,
            start: { dateTime: inicio.toISOString(), timeZone: TZ },
            end: { dateTime: fim.toISOString(), timeZone: TZ },
            attendees: [{ email, displayName: nome }],
            conferenceData: {
              createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
            },
            reminders: { useDefault: true },
          }),
        },
      );
      if (!eventRes.ok) throw new Error(`Google events.insert ${eventRes.status}: ${await eventRes.text()}`);
      const event = await eventRes.json();
      const meetLink =
        event.hangoutLink ?? event.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;

      const lead = {
        nome, email,
        whatsapp: fone(e164), whatsapp_e164: e164,
        tipo: "agendamento",
        solucao: cfg.solucao,
        experiencia: atuacao,
        video_pct: origem === "integradores" ? pct : null,
        agenda_inicio: inicio.toISOString(),
        agenda_fim: fim.toISOString(),
        agenda_meet: meetLink,
        agenda_evento: event.id,
        agenda_aceite: aceite,
        utm_source: curto(body.utm_source, 200), utm_medium: curto(body.utm_medium, 200),
        utm_campaign: curto(body.utm_campaign, 200), utm_content: curto(body.utm_content, 200),
        utm_term: curto(body.utm_term, 200),
        landing: curto(body.landing, 300), referrer: curto(body.referrer, 300),
        device: curto(body.device, 20),
      };
      const ins = await db("leads", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(lead) });
      if (!ins.ok) {
        const t = await ins.text();
        // sem lead a reunião não vale: libera o horário na agenda
        await apagarEvento(event.id, true).catch((e) => console.error("evento órfão", event.id, e));
        if (/23505|duplicate key/.test(t)) return json({ error: OCUPADO, slotTaken: true }, 409);
        throw new Error(`insert leads ${ins.status}: ${t}`);
      }

      return json({ ok: true, inicio: toBrtIso(inicio), meetLink });
    }

    if (body.action === "excluir") {
      // só o painel: confere o login (token do usuário) antes de apagar qualquer coisa
      const userToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${userToken}` } });
      const user = u.ok ? await u.json().catch(() => null) : null;
      if (!user?.id) return json({ error: "Sem permissão." }, 403);

      const id = String(body.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Lead inválido." }, 400);
      const achado = await (await db(`leads?id=eq.${id}&select=id,agenda_evento,agenda_fim`)).json().catch(() => []);
      const L = Array.isArray(achado) ? achado[0] : null;
      if (!L) return json({ ok: true });
      if (L.agenda_evento) await apagarEvento(L.agenda_evento, Date.parse(L.agenda_fim) > Date.now());
      const del = await db(`leads?id=eq.${id}`, { method: "DELETE" });
      if (!del.ok) throw new Error(`delete leads ${del.status}: ${await del.text()}`);
      return json({ ok: true });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Não foi possível acessar a agenda agora. Tente novamente em instantes." }, 500);
  }
});
