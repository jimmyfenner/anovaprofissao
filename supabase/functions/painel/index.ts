// A NOVA PROFISSÃO — função "painel" (nov/2026)
// anovaprofissao.com.br/painel: o licenciado entra com um código de 6 dígitos mandado
// ao WhatsApp cadastrado dele (tabela licenciados) e vê só os leads da página dele.
// O Jimmy entra com o número dele e escolhe de qual licenciado quer ver o painel.
// Mesmo desenho do painel do igreencel.com.br: o código fica no banco só como hash,
// vale 10 min e 5 tentativas, no máximo 3 pedidos por número a cada 15 min, e a
// resposta de "codigo" é igual para qualquer número (a página não serve de teste de
// quais números têm acesso). A sessão é um token aleatório de 30 dias guardado no
// navegador; no banco fica só o hash dele (db/19-painel-licenciados.sql).
//
// Ações do painel (com o token no corpo): codigo, entrar, dados, lead, sair.
// Ações do /admin (login do Jimmy no Supabase): config, config_salvar, config_teste,
// e o cadastro dos licenciados (db/20): lic_salvar (ficha + foto + publicar), lic_ativo
// (página no ar ou não) e lic_publicar. Depois de gravar, chama o deploy hook da Vercel
// (segredo VERCEL_DEPLOY_HOOK): o build lê as fichas no banco e gera as páginas.
// Publicar: supabase functions deploy painel --project-ref buapklmgdjcoyzrmhhcd --use-api
// (verify_jwt ligado: o site chama com a chave anon, o /admin com o login).

const EVO_URL = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
const EVO_KEY = Deno.env.get("EVOLUTION_APIKEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VERCEL_HOOK = Deno.env.get("VERCEL_DEPLOY_HOOK") ?? "";

// quem entra no painel com acesso a todos os licenciados
const ADMINS: Record<string, string> = { "5548991067007": "Jimmy" };
const DESAFIO_MS = 10 * 60_000;
const SESSAO_MS = 30 * 86_400_000;
const MAX_TENTATIVAS = 5;
const LIMITE_PEDIDOS = 3;           // códigos por número a cada 15 min
const STATUS = ["novo", "contatado", "em_conversa", "ganho", "sem_retorno", "descartado"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUNAS_LEAD = "id,criado_em,nome,whatsapp,whatsapp_e164,email,cidade,uf,objetivo,tempo,experiencia," +
  "solucao,perfil,investimento,momento,tipo,status,anotacoes,contatado_em,utm_source,utm_campaign,device";

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

async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  let body: any = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = txt; }
  if (!r.ok) throw new Error(`rest ${path.split("?")[0]} ${r.status}: ${txt.slice(0, 200)}`);
  return { body, headers: r.headers };
}
const linhas = async (path: string) => {
  const { body } = await rest(path);
  return Array.isArray(body) ? body : [];
};
// quantas linhas, sem trazer as linhas
async function contar(path: string): Promise<number> {
  const { headers } = await rest(path, { headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((headers.get("content-range") ?? "").split("/")[1]) || 0;
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}
// hash do código preso ao id do pedido (o mesmo código em outro pedido não confere) e à chave do servidor
const hashCodigo = (id: string, codigo: string) => sha256(`anp|painel|${SB_KEY}|${id}|${codigo}`);
function novoCodigo() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}
function novoToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function iguais(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Formas do mesmo celular: com e sem o 9 depois do DDD, sempre com 55 na frente.
function formas(entrada: unknown): string[] {
  let d = String(entrada ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return [];
  const ddd = d.slice(0, 2), resto = d.slice(2);
  const com9 = resto.length === 9 ? resto : "9" + resto;
  const sem9 = resto.length === 9 && resto.startsWith("9") ? resto.slice(1) : resto;
  return Array.from(new Set([`55${ddd}${resto}`, `55${ddd}${com9}`, `55${ddd}${sem9}`]));
}

type Lic = { slug: string; nome: string; whatsapp: string };
type Quem = { whatsapp: string; nome: string; admin: boolean; lic: Lic | null };

// Quem é o número: o Jimmy (todos os licenciados) ou um licenciado ativo com acesso ligado.
async function quemEh(numeros: string[]): Promise<Quem | null> {
  const adm = numeros.find((n) => ADMINS[n]);
  if (adm) return { whatsapp: adm, nome: ADMINS[adm], admin: true, lic: null };
  if (!numeros.length) return null;
  const achados = await linhas(
    `licenciados?whatsapp=in.(${numeros.join(",")})&ativo=eq.true&painel_ativo=eq.true&select=slug,nome,whatsapp&limit=1`,
  );
  const l = achados[0];
  return l ? { whatsapp: l.whatsapp, nome: String(l.nome).split(" ")[0], admin: false, lic: l } : null;
}

async function instanciaCodigos(): Promise<string | null> {
  const [c] = await linhas("painel_config?id=eq.1&select=instancia_codigos");
  if (c?.instancia_codigos) return c.instancia_codigos;
  const [w] = await linhas("whatsapp_config?id=eq.1&select=instancia");   // sem escolha: a dos avisos de lead
  return w?.instancia ?? null;
}

// tenta o formato v2 da Evolution e cai para o v1
async function enviarWhats(instancia: string, numero: string, texto: string): Promise<{ ok: boolean; erro: string }> {
  if (!EVO_URL || !EVO_KEY) return { ok: false, erro: "Evolution não configurada" };
  const url = `${EVO_URL}/message/sendText/${encodeURIComponent(instancia)}`;
  const tenta = (body: unknown) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: EVO_KEY }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  }).then(async (r) => ({ ok: r.ok, status: r.status, txt: (await r.text()).slice(0, 200) }));
  try {
    let r = await tenta({ number: numero, text: texto });
    if (!r.ok && r.status !== 404) r = await tenta({ number: numero, textMessage: { text: texto } });
    return r.ok ? { ok: true, erro: "" } : { ok: false, erro: `HTTP ${r.status}: ${r.txt}` };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "falha de rede" };
  }
}

// Sessão do painel pelo token. Confere de novo quem é: um licenciado bloqueado no /admin sai na hora.
async function sessao(token: unknown): Promise<Quem> {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) throw new Recusa("Entre de novo no painel.", 401);
  const [s] = await linhas(`sessoes_painel?token_hash=eq.${await sha256(token)}&select=id,whatsapp,expira_em,encerrada_em`);
  if (!s || s.encerrada_em || Date.parse(s.expira_em) < Date.now()) throw new Recusa("Entre de novo no painel.", 401);
  const quem = await quemEh([s.whatsapp]);
  if (!quem) throw new Recusa("Este número não tem mais acesso ao painel.", 403);
  rest(`sessoes_painel?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ ultimo_uso: new Date().toISOString() }) }).catch(() => {});
  return quem;
}

// De qual licenciado é o painel: o próprio, ou o escolhido pelo Jimmy.
async function licDoPedido(quem: Quem, slug: unknown): Promise<Lic | null> {
  if (!quem.admin) return quem.lic;
  const todos = await linhas("licenciados?ativo=eq.true&select=slug,nome,whatsapp&order=nome");
  return todos.find((l) => l.slug === slug) ?? todos[0] ?? null;
}

async function usuarioAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === SB_KEY) return false;
  const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
  const u = r.ok ? await r.json().catch(() => null) : null;
  return typeof u?.id === "string";
}


/* ---------- cadastro de licenciados pelo /admin (db/20) ---------- */
// manter igual ao RESERVADOS do build.js (endereços que já são páginas do site)
const RESERVADOS = new Set(["admin", "home", "integradores", "transicao-energetica", "transicaoenergetica",
  "privacidade", "termos", "aviso-legal", "media", "fonts", "seo", "dados", "og", "api", "blog", "publicador",
  "apresentacao", "agendar", "agendamento", "home-agendar", "painel", "reunioes", "tools", "legal", "licenciados", "supabase", "grupos"]);
const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE",
  "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
// a mesma trava do build (conferirEspelho): nada do Jimmy pode ir para a página de outro
const DO_JIMMY = /jimmy|fenner|minerandoosol|99106-?7007|5548991067007/i;
const NOME_OK = /^[\p{L}][\p{L} .'-]*$/u;

const limpo = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (t.length > max) throw new Recusa(`Texto longo demais (máximo ${max} caracteres): "${t.slice(0, 30)}…"`);
  return t;
};
function exige(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Recusa(msg);
}
function semJimmy(campo: string, valor: string) {
  if (DO_JIMMY.test(valor)) {
    throw new Recusa(`${campo}: não pode citar o Jimmy, os contatos ou as redes dele. A página do licenciado não pode levar o visitante até você.`);
  }
}
// 2024-03-01T12:00:00.000Z -> 20240301T120000 (o mesmo formato de licenciados_publicos)
const versaoDe = (iso: string) => iso.replace(/[-:]/g, "").slice(0, 15);

async function publicarSite(): Promise<boolean> {
  if (!/^https:\/\/api\.vercel\.com\//.test(VERCEL_HOOK)) return false;
  try {
    const r = await fetch(VERCEL_HOOK, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}

async function subirFoto(slug: string, base64: string): Promise<string> {
  const b64 = base64.replace(/^data:image\/jpeg;base64,/, "");
  exige(/^[A-Za-z0-9+/=]+$/.test(b64) && b64.length < 2_000_000, "A foto veio num formato que não reconheço. Escolha outra.");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  exige(bytes.length > 5000 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, "A foto precisa ser JPEG. Escolha outra.");
  const arquivo = `${slug}-${Date.now()}.jpg`;
  const r = await fetch(`${SB_URL}/storage/v1/object/licenciados/${arquivo}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "image/jpeg", "x-upsert": "false" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`storage ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return arquivo;
}
async function apagarFoto(arquivo: string | null) {
  if (!arquivo) return;
  await fetch(`${SB_URL}/storage/v1/object/licenciados/${arquivo}`, {
    method: "DELETE", headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  }).catch(() => {});
}

async function salvarLicenciado(b: any) {
  const novo = b.novo === true;
  const slug = String(b.slug ?? "").trim();
  exige(/^[a-z0-9-]{3,40}$/.test(slug), "Endereço inválido: use de 3 a 40 letras minúsculas, números ou hífen, sem acento.");
  const [atual] = await linhas(`licenciados?slug=eq.${slug}&select=slug,foto`);
  if (novo) {
    exige(!RESERVADOS.has(slug), `"/${slug}" já é uma página do site. Escolha outro endereço.`);
    exige(!atual, `Já existe um licenciado em /${slug}. Escolha outro endereço ou edite o existente.`);
  } else {
    exige(atual, "Licenciado não encontrado. Atualize a lista.");
  }

  const nome = limpo(b.nome, 90);
  exige(NOME_OK.test(nome) && nome.split(" ").length >= 2, "Nome completo: escreva nome e sobrenome, só com letras.");
  const nome_pagina = limpo(b.nome_pagina, 40);
  exige(nome_pagina && NOME_OK.test(nome_pagina), "Nome na página: só letras.");
  const nome_curto = limpo(b.nome_curto, 24);
  exige(nome_curto && NOME_OK.test(nome_curto), "Como é chamado: só letras.");
  for (const [c, v] of [["Nome completo", nome], ["Nome na página", nome_pagina], ["Como é chamado", nome_curto]]) semJimmy(c, v);

  let whatsapp = String(b.whatsapp ?? "").replace(/\D/g, "");
  if (whatsapp.length === 10 || whatsapp.length === 11) whatsapp = "55" + whatsapp;
  exige(/^55[1-9][0-9]9?[0-9]{8}$/.test(whatsapp), "WhatsApp: informe com DDD, por exemplo (47) 99999-0000.");
  exige(!ADMINS[whatsapp] && whatsapp !== "5548991067007", "WhatsApp: esse é o seu número. Use o do licenciado.");
  const mesmoZap = await linhas(`licenciados?whatsapp=eq.${whatsapp}&slug=neq.${slug}&select=nome`);
  exige(!mesmoZap.length, `WhatsApp: esse número já é de ${mesmoZap[0]?.nome}. Cada licenciado entra no painel com o próprio número.`);

  const email = limpo(b.email, 120).toLowerCase();
  exige(/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(email), "E-mail inválido.");
  exige(!/jimmyfenner|up\.novos\.cadastros/i.test(email), "E-mail: use o do licenciado, não o seu.");

  const cidade = limpo(b.cidade, 60);
  exige(cidade.length >= 2 && NOME_OK.test(cidade), "Cidade: só letras.");
  const uf = String(b.uf ?? "").toUpperCase();
  exige(UFS.includes(uf), "Escolha o estado.");
  const regiao = limpo(b.regiao, 60);
  exige(!regiao || NOME_OK.test(regiao), "Região: só letras.");
  semJimmy("Cidade", cidade); semJimmy("Região", regiao);

  // aceita o link da iGreen como vier (mantém tipolicenca etc.) ou só o ID; com só o ID,
  // monta o mesmo tipo de link da home do Jimmy (licença Connect, a de R$ 1.997/ano)
  const link = String(b.link ?? "").trim();
  const LINK_OK = /^https:\/\/expansao\.igreenenergy\.com\.br\/\?id=([0-9]{1,9})(&[a-z]+=[A-Za-z0-9]+)*$/;
  let link_cadastro = "";
  if (/^\d{1,9}$/.test(link)) link_cadastro = `https://expansao.igreenenergy.com.br/?id=${link}&checkout=true&tipolicenca=CONNECT`;
  else if (LINK_OK.test(link)) link_cadastro = link;
  exige(link_cadastro, "Link de cadastro: cole o link de licenciamento da iGreen (expansao.igreenenergy.com.br/?id=...) ou só o número do ID.");
  exige(link_cadastro.match(LINK_OK)![1] !== "1971", "Link de cadastro: esse é o seu ID. Use o do licenciado, senão os cadastros da página dele caem com você.");

  let desde: string | null = null;
  if (b.desde) {
    const m = String(b.desde).match(/^(\d{4})-(\d{2})$/);
    const agora = new Date();
    exige(m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 2015 &&
      (+m[1] < agora.getUTCFullYear() || (+m[1] === agora.getUTCFullYear() && +m[2] <= agora.getUTCMonth() + 1)),
      "Licenciado desde: escolha um mês que já passou.");
    desde = `${m[1]}-${m[2]}-01`;
  }
  const qualificacao = limpo(b.qualificacao, 40);
  exige(!qualificacao || NOME_OK.test(qualificacao), "Qualificação: só letras.");

  const bio = (Array.isArray(b.bio) ? b.bio : []).map((t: unknown) => limpo(t, 600)).filter(Boolean);
  exige(bio.length >= 1 && bio.length <= 4, "Apresentação: escreva de 1 a 4 parágrafos (ou use o texto modelo).");
  bio.forEach((t: string) => semJimmy("Apresentação", t));

  let instagram = limpo(b.instagram, 120).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?].*$/, "");
  exige(!instagram || /^[A-Za-z0-9._]{1,30}$/.test(instagram), "Instagram: informe o @ do perfil.");
  const youtube = limpo(b.youtube, 200);
  exige(!youtube || /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/[^\s"<>]+$/.test(youtube), "YouTube: cole o link do canal, começando com https://.");
  const link_grupo = limpo(b.link_grupo, 200);
  exige(!link_grupo || /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(link_grupo), "Grupo: cole o convite do grupo do WhatsApp (https://chat.whatsapp.com/...).");
  const meta_pixel = String(b.meta_pixel ?? "").replace(/\D/g, "");
  exige(!meta_pixel || /^[0-9]{10,20}$/.test(meta_pixel), "Pixel da Meta: só os números do ID.");
  semJimmy("Instagram", instagram); semJimmy("YouTube", youtube);

  exige(!novo || b.foto_base64, "Escolha a foto do licenciado.");
  const foto = b.foto_base64 ? await subirFoto(slug, String(b.foto_base64)) : undefined;

  const agoraIso = new Date().toISOString();
  const ficha: Record<string, unknown> = {
    nome, nome_pagina, nome_curto, feminino: b.feminino === true, whatsapp, email, cidade, uf,
    regiao: regiao || null, link_cadastro, link_grupo: link_grupo || null, meta_pixel: meta_pixel || null,
    desde, qualificacao: qualificacao || null, bio, instagram: instagram || null, youtube: youtube || null,
    atualizado_em: agoraIso,
  };
  if (foto) ficha.foto = foto;
  try {
    if (novo) {
      await rest("licenciados", { method: "POST", body: JSON.stringify({ slug, ativo: true, painel_ativo: true, ...ficha }) });
    } else {
      await rest(`licenciados?slug=eq.${slug}`, { method: "PATCH", body: JSON.stringify(ficha) });
    }
  } catch (e) {
    if (foto) await apagarFoto(foto);
    throw e;
  }
  if (foto && atual?.foto) await apagarFoto(atual.foto);
  return { slug, versao: versaoDe(agoraIso) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio */ }
  const acao = String(body.action ?? "");

  try {
    /* ---------- login: 1) código no WhatsApp ---------- */
    if (acao === "codigo") {
      const numeros = formas(body.whatsapp);
      if (!numeros.length) throw new Recusa("Informe o WhatsApp com DDD.");
      const desafio = crypto.randomUUID();
      const quem = await quemEh(numeros);
      if (quem) {
        const recentes = await contar(
          `acessos_painel?whatsapp=eq.${quem.whatsapp}&criado_em=gte.${encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString())}&select=id`,
        );
        if (recentes >= LIMITE_PEDIDOS) throw new Recusa("Muitos códigos pedidos. Espere alguns minutos.", 429);
        const codigo = novoCodigo();
        await rest("acessos_painel", {
          method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            id: desafio, whatsapp: quem.whatsapp, codigo_hash: await hashCodigo(desafio, codigo),
            expira_em: new Date(Date.now() + DESAFIO_MS).toISOString(),
          }),
        });
        const envio = (async () => {
          const inst = await instanciaCodigos();
          const r = inst
            ? await enviarWhats(inst, quem.whatsapp,
                `🔐 Código do painel anovaprofissao.com.br: *${codigo}*\n\nVale por 10 minutos. Se não foi você que pediu, ignore esta mensagem.`)
            : { ok: false, erro: "Nenhuma instância escolhida para os códigos" };
          await rest(`acessos_painel?id=eq.${desafio}`, {
            method: "PATCH", body: JSON.stringify({ envio_ok: r.ok, envio_erro: r.ok ? null : r.erro.slice(0, 300) }),
          }).catch(() => {});
          if (!r.ok) console.error("painel: código não saiu", r.erro);
        })();
        // a Evolution pode demorar: responde já e termina o envio em segundo plano
        // @ts-ignore EdgeRuntime existe no Supabase
        if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(envio); else await envio;
      }
      return json({ ok: true, desafio });
    }

    /* ---------- login: 2) confere o código e abre a sessão ---------- */
    if (acao === "entrar") {
      const desafio = String(body.desafio ?? "");
      const codigo = String(body.codigo ?? "").replace(/\D/g, "");
      if (!UUID.test(desafio)) throw new Recusa("O código venceu. Peça outro.");
      if (codigo.length !== 6) throw new Recusa("O código tem 6 números.");
      const [a] = await linhas(`acessos_painel?id=eq.${desafio}&select=id,whatsapp,codigo_hash,expira_em,tentativas,usado_em`);
      if (!a || a.usado_em || Date.parse(a.expira_em) < Date.now()) throw new Recusa("O código venceu. Peça outro.");
      if (a.tentativas >= MAX_TENTATIVAS) throw new Recusa("Tentativas esgotadas. Peça outro código.", 429);
      if (!iguais(await hashCodigo(a.id, codigo), a.codigo_hash)) {
        await rest(`acessos_painel?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ tentativas: a.tentativas + 1 }) });
        const restam = MAX_TENTATIVAS - a.tentativas - 1;
        throw new Recusa(restam > 0 ? `Código errado. Restam ${restam} tentativas.` : "Código errado. Peça outro.");
      }
      await rest(`acessos_painel?id=eq.${a.id}`, { method: "PATCH", body: JSON.stringify({ usado_em: new Date().toISOString() }) });
      // o acesso pode ter sido desligado enquanto o código estava no WhatsApp
      const quem = await quemEh([a.whatsapp]);
      if (!quem) throw new Recusa("Este número não tem mais acesso ao painel.", 403);
      const token = novoToken();
      await rest("sessoes_painel", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ whatsapp: a.whatsapp, token_hash: await sha256(token), expira_em: new Date(Date.now() + SESSAO_MS).toISOString() }),
      });
      if (quem.lic) {
        await rest(`licenciados?slug=eq.${quem.lic.slug}`, { method: "PATCH", body: JSON.stringify({ ultimo_acesso_painel: new Date().toISOString() }) }).catch(() => {});
      }
      return json({ ok: true, token, nome: quem.nome });
    }

    /* ---------- painel ---------- */
    if (acao === "dados") {
      const quem = await sessao(body.token);
      const lic = await licDoPedido(quem, body.slug);
      const outros = quem.admin ? await linhas("licenciados?ativo=eq.true&select=slug,nome&order=nome") : [];
      if (!lic) return json({ quem: { nome: quem.nome, admin: quem.admin }, licenciados: outros, licenciado: null, leads: [], numeros: null });
      const desde = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
      const pagina = encodeURIComponent(`(landing.eq./${lic.slug},landing.like./${lic.slug}/*)`);
      const [leads, visitas30, leads30] = await Promise.all([
        linhas(`leads?licenciado=eq.${lic.slug}&select=${COLUNAS_LEAD}&order=criado_em.desc&limit=500`),
        contar(`visitas?or=${pagina}&criado_em=gte.${desde}&select=id`),
        contar(`leads?licenciado=eq.${lic.slug}&criado_em=gte.${desde}&select=id`),
      ]);
      return json({
        quem: { nome: quem.nome, admin: quem.admin },
        licenciados: outros,
        licenciado: { slug: lic.slug, nome: lic.nome, curto: String(lic.nome).split(" ")[0] },
        leads,
        numeros: { visitas30, leads30, esperando: leads.filter((l) => l.status === "novo").length },
      });
    }

    if (acao === "lead") {
      const quem = await sessao(body.token);
      const lic = await licDoPedido(quem, body.slug);
      const id = String(body.id ?? "");
      if (!lic || !UUID.test(id)) throw new Recusa("Lead inválido.");
      const [l] = await linhas(`leads?id=eq.${id}&licenciado=eq.${lic.slug}&select=id,status,contatado_em`);
      if (!l) throw new Recusa("Este lead não é da sua página.", 404);
      const patch: Record<string, unknown> = {};
      if (body.status !== undefined) {
        if (!STATUS.includes(body.status)) throw new Recusa("Status inválido.");
        patch.status = body.status;
      }
      if (body.anotacoes !== undefined) patch.anotacoes = String(body.anotacoes ?? "").slice(0, 4000);
      // quem foi chamado (ou mudou de status) sai da fila de espera, como no /admin
      if ((patch.status && patch.status !== "novo") && !l.contatado_em) patch.contatado_em = new Date().toISOString();
      if (!Object.keys(patch).length) return json({ ok: true });
      await rest(`leads?id=eq.${id}&licenciado=eq.${lic.slug}`, { method: "PATCH", body: JSON.stringify(patch) });
      return json({ ok: true, ...patch });
    }

    if (acao === "sair") {
      if (typeof body.token === "string" && body.token.length <= 100) {
        await rest(`sessoes_painel?token_hash=eq.${await sha256(body.token)}`, {
          method: "PATCH", body: JSON.stringify({ encerrada_em: new Date().toISOString() }),
        }).catch(() => {});
      }
      return json({ ok: true });
    }

    /* ---------- /admin (login do Jimmy no Supabase) ---------- */
    if (acao === "config" || acao === "config_salvar" || acao === "config_teste") {
      if (!(await usuarioAdmin(req))) throw new Recusa("Sem permissão.", 403);
      if (acao === "config_salvar") {
        const inst = body.instancia_codigos == null || body.instancia_codigos === "" ? null : String(body.instancia_codigos).slice(0, 80);
        await rest("painel_config?id=eq.1", { method: "PATCH", body: JSON.stringify({ instancia_codigos: inst, atualizado_em: new Date().toISOString() }) });
      }
      if (acao === "config_teste") {
        const inst = typeof body.instancia === "string" && body.instancia ? body.instancia : await instanciaCodigos();
        if (!inst) throw new Recusa("Escolha a instância que manda os códigos.");
        const r = await enviarWhats(inst, "5548991067007",
          "🔐 Teste do painel anovaprofissao.com.br: os códigos de acesso dos licenciados vão sair deste número.");
        if (!r.ok) throw new Recusa(`O teste não saiu: ${r.erro}`, 502);
        return json({ ok: true });
      }
      const [c] = await linhas("painel_config?id=eq.1&select=instancia_codigos,atualizado_em");
      const [w] = await linhas("whatsapp_config?id=eq.1&select=instancia");
      const ultimos = await linhas("acessos_painel?select=whatsapp,criado_em,envio_ok,envio_erro,usado_em&order=criado_em.desc&limit=10");
      return json({ instancia_codigos: c?.instancia_codigos ?? null, instancia_avisos: w?.instancia ?? null, ultimos });
    }


    if (acao === "lic_salvar" || acao === "lic_ativo" || acao === "lic_publicar") {
      if (!(await usuarioAdmin(req))) throw new Recusa("Sem permissão.", 403);
      let r: Record<string, unknown> = {};
      if (acao === "lic_salvar") r = await salvarLicenciado(body);
      if (acao === "lic_ativo") {
        const slug = String(body.slug ?? "");
        exige(/^[a-z0-9-]{3,40}$/.test(slug), "Licenciado inválido.");
        const agoraIso = new Date().toISOString();
        const { body: feito } = await rest(`licenciados?slug=eq.${slug}`, {
          method: "PATCH", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ativo: body.ativo === true, atualizado_em: agoraIso }),
        });
        exige(Array.isArray(feito) && feito.length, "Licenciado não encontrado.");
        r = { slug, versao: versaoDe(agoraIso), ativo: body.ativo === true };
      }
      const publicando = await publicarSite();
      return json({ ok: true, ...r, publicando });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (e) {
    if (e instanceof Recusa) return json({ error: e.message }, e.status);
    console.error("painel:", acao, e instanceof Error ? e.message : e);
    return json({ error: "O painel está fora do ar agora. Tente de novo em instantes." }, 500);
  }
});
