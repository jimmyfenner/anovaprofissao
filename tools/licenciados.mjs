/* ============================================================
   Fichas dos licenciados para o build (nov/2026)

   Uso (o build.js chama sozinho):  node tools/licenciados.mjs <pasta-das-fotos>

   Lê licenciados_publicos() no Supabase com a chave anon (a mesma que já está
   no site), baixa a foto de cada um do bucket público "licenciados" para
   <pasta-das-fotos>/<arquivo>.jpg e escreve no stdout o JSON no formato que o
   build.js usa: { "<slug>": { nome, nome_curto, ... } }.

   Qualquer falha (rede, banco, foto que não é JPEG) sai com erro: o build para
   e a Vercel mantém no ar a versão anterior, com as páginas de todos. Publicar
   sem um licenciado apagaria a página dele.
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(path.join(RAIZ, "home.html"), "utf8");
const URL_SB = (home.match(/var SUPABASE_URL = "([^"]+)"/) || [])[1];
const CHAVE = (home.match(/var SUPABASE_KEY = "([^"]+)"/) || [])[1];
const pastaFotos = process.argv[2];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ESTADOS = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

function falha(msg) {
  console.error("ERRO (licenciados): " + msg);
  process.exit(1);
}

async function buscar(url, init, tentativas = 3) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
      if (r.ok) return r;
      ultimo = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    } catch (e) { ultimo = e; }
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  throw ultimo;
}

// 5513981602345 -> (13) 98160-2345
function zapExibir(n) {
  const m = String(n).match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(n);
}

if (!URL_SB || !CHAVE) falha("não achei SUPABASE_URL/SUPABASE_KEY na home.html.");
if (!pastaFotos) falha("informe a pasta das fotos.");

// teste local sem banco: LICENCIADOS_TESTE=<pasta> com licenciados.json (o mesmo formato
// de licenciados_publicos) e as fotos ao lado. Nunca usado na Vercel.
const TESTE = process.env.LICENCIADOS_TESTE;
let fichas;
if (TESTE) {
  fichas = JSON.parse(fs.readFileSync(path.join(TESTE, "licenciados.json"), "utf8"));
} else try {
  const r = await buscar(`${URL_SB}/rest/v1/rpc/licenciados_publicos`, {
    method: "POST",
    headers: { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, "Content-Type": "application/json" },
    body: "{}",
  });
  fichas = await r.json();
} catch (e) {
  falha("não consegui ler os licenciados no Supabase: " + (e?.message || e));
}
if (!fichas || typeof fichas !== "object" || Array.isArray(fichas)) falha("resposta inesperada do Supabase.");

fs.mkdirSync(pastaFotos, { recursive: true });
const saida = {};
for (const [slug, f] of Object.entries(fichas)) {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) falha(`endereço inválido: ${slug}`);
  if (!/^[a-z0-9-]{3,40}-[0-9]{8,20}\.jpg$/.test(f.foto || "")) falha(`foto inválida para ${slug}`);
  if (!ESTADOS[f.uf]) falha(`UF inválida para ${slug}: ${f.uf}`);

  let bytes;
  try {
    if (TESTE) bytes = fs.readFileSync(path.join(TESTE, f.foto));
    else bytes = Buffer.from(await (await buscar(`${URL_SB}/storage/v1/object/public/licenciados/${f.foto}`, {})).arrayBuffer());
  } catch (e) {
    falha(`não consegui baixar a foto de ${slug}: ` + (e?.message || e));
  }
  if (bytes.length < 2000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) falha(`a foto de ${slug} não é um JPEG válido.`);
  fs.writeFileSync(path.join(pastaFotos, f.foto), bytes);

  const [ano, mes] = (f.desde || "").split("-").map(Number);
  const lic = f.feminino ? "licenciada" : "licenciado";
  saida[slug] = {
    ativo: true,
    nome: f.nome,
    nome_curto: f.nome_curto,
    nome_completo: f.nome_completo,
    feminino: !!f.feminino,
    cidade: f.cidade,
    uf: f.uf,
    estado: ESTADOS[f.uf],
    regiao: f.regiao || "",
    whatsapp: f.whatsapp,
    whatsapp_exibir: zapExibir(f.whatsapp),
    link_cadastro: f.link_cadastro,
    link_grupo: f.link_grupo || "",
    meta_pixel: f.meta_pixel || "",
    desde: ano ? `${MESES[mes - 1]} de ${ano}` : "",
    desde_curto: ano ? `${MESES[mes - 1].slice(0, 3)}/${ano}` : "",
    qualificacao: f.qualificacao || "",
    foto: `/media/licenciados/${f.foto}`,
    foto_alt: `${f.nome_completo}, ${lic} iGreen Energy em ${f.cidade}, ${f.uf}`,
    bio: Array.isArray(f.bio) ? f.bio : [],
    instagram: f.instagram || "",
    youtube: f.youtube || "",
    versao: f.versao,
  };
}
process.stdout.write(JSON.stringify(saida));
