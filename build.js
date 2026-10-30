/* ============================================================
   Build do anovaprofissao.com.br
   Lê os fontes (home.html / admin.html), envolve com o <head>
   completo e escreve tudo em dist/, que é o que a Vercel serve.

   Rodar:  node build.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const SITE = {
  url: 'https://anovaprofissao.com.br',
  nome: 'A Nova Profissão',
  title: 'A Nova Profissão | Licenciamento iGreen Energy',
  desc: 'Conheça uma nova forma de atuar comercialmente com energia, telecom, seguros e outras soluções recorrentes, através do modelo de licenciamento da iGreen Energy.',
  autor: 'Jimmy Fenner',
  locale: 'pt_BR',
  theme: '#0A0D0C',
};

/* Data de revisão dos textos jurídicos. É fixa de propósito: ela diz quando o
   texto mudou, não quando o site foi publicado. Atualize ao alterar legal/*. */
const ATUALIZADO = '30 de outubro de 2026';
/* Idem para as páginas do Publicador (publicador/*). */
const ATUALIZADO_PUBLICADOR = '25 de outubro de 2026';

const out = (...p) => path.join(__dirname, 'dist', ...p);
const mkdir = d => fs.mkdirSync(d, { recursive: true });

/* ---- favicon: raio em verde elétrico ---- */
const FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#0A0D0C"/>' +
  '<path d="M18.5 4L9 18h5.5L13 28l10-14.5h-5.5z" fill="#34DB8B"/></svg>';

/* ---- extrai o FAQ da própria página para gerar o schema ----
   assim os dados estruturados nunca ficam fora de sincronia com o texto */
function faqSchema(html) {
  const itens = [];
  const re = /<details><summary>([\s\S]*?)<\/summary><div>([\s\S]*?)<\/div><\/details>/g;
  let m;
  while ((m = re.exec(html))) {
    itens.push({
      '@type': 'Question',
      name: limpa(m[1]),
      acceptedAnswer: { '@type': 'Answer', text: limpa(m[2]) },
    });
  }
  return itens.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: itens } : null;
}
// <br> vira espaço antes de tirar as tags, senão "seguros.<br><br>A Licença" gruda
const limpa = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function schemas(html, comSite = true) {
  const pessoa = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Jimmy Fenner',
    jobTitle: 'Licenciado iGreen Energy',
    url: SITE.url,
    sameAs: [
      'https://youtube.com/@jimmyfenner',
      'https://instagram.com/minerandoosol',
    ],
    address: { '@type': 'PostalAddress', addressLocality: 'Balneário Camboriú', addressRegion: 'SC', addressCountry: 'BR' },
  };
  const site = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.nome,
    url: SITE.url,
    inLanguage: 'pt-BR',
    publisher: { '@type': 'Person', name: 'Jimmy Fenner' },
  };
  return [comSite && site, pessoa, faqSchema(html)].filter(Boolean)
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n');
}

/* O fonte é escrito no formato do Artifact (só o corpo), mas traz <title> e
   os <link> de fonte no topo. Aqui a gente separa: o que é de <head> sobe
   para o <head> — fontes descobertas mais cedo melhoram o LCP — e o <title>
   duplicado sai do corpo. */
function separaCabeca(src) {
  const links = [];
  let body = src
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    // fontes do Google saem: o site serve as próprias (ver FONTES abaixo)
    .replace(/<link\b[^>]*>\s*/gi, m => { if (!/fonts\.(googleapis|gstatic)\.com/.test(m)) links.push(m.trim()); return ''; });
  return { body: body.trimStart(), links: links.join('\n') };
}

/* Fontes hospedadas no próprio site (out/2026). O <link> do Google Fonts
   travava a primeira pintura em ~2 s no celular (Lighthouse: "render-blocking")
   e mandava o IP do visitante ao Google. Agora: dois preloads das fontes do
   texto e do título, e o @font-face direto no <head>. Só o subconjunto latino,
   que cobre o português; Archivo e Instrument Sans são variáveis (um arquivo
   para todos os pesos). Para trocar de fonte, baixar os .woff2 para fonts/. */
const UR_LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const FONTES = `<link rel="preload" href="/fonts/instrument-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Archivo';font-style:normal;font-weight:500 800;font-display:swap;src:url(/fonts/archivo.woff2) format('woff2');unicode-range:${UR_LATIN}}
@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 600;font-display:swap;src:url(/fonts/instrument-sans.woff2) format('woff2');unicode-range:${UR_LATIN}}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;font-display:swap;src:url(/fonts/ibm-plex-mono-400.woff2) format('woff2');unicode-range:${UR_LATIN}}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:500;font-display:swap;src:url(/fonts/ibm-plex-mono-500.woff2) format('woff2');unicode-range:${UR_LATIN}}
</style>`;

/* Imagem de compartilhamento (WhatsApp, Facebook, LinkedIn): uma por página,
   1200x630, em media/og/. Fundo gerado no Higgsfield (sem texto) e título
   composto por cima com as fontes e cores do site. Endereço absoluto no
   domínio canônico da própria página. */
function documento({ body, title, desc, canonical, noindex, links = '', siteNome = SITE.nome, comSite = true,
                     autor = SITE.autor, og = SITE.url + '/media/og/home.jpg', ogAlt = 'A venda acontece uma vez. A conta do cliente chega todo mês. A Nova Profissão.' }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="${SITE.theme}">
<meta name="author" content="${autor}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<link rel="canonical" href="${canonical}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
${FONTES}
${links}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${siteNome}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${ogAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${og}">
${noindex ? '' : schemas(body, comSite)}
<style>
  html{color-scheme:dark}
  body{margin:0}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
</head>
<body>
${body}
</body>
</html>`;
}


/* ---------------- páginas jurídicas ----------------
   Fontes em legal/*.html trazem só o miolo do texto. Aqui cada uma ganha o
   mesmo sistema visual da home, num shell enxuto e autossuficiente. */
const LEGAIS = [
  { slug:'privacidade', arq:'privacidade.html',
    title:'Política de Privacidade | ' + SITE.nome,
    desc:'Quais dados o site coleta, para que servem, com quem são compartilhados e como pedir a exclusão.' },
  { slug:'termos', arq:'termos.html',
    title:'Termos de Uso | ' + SITE.nome,
    desc:'As condições de uso do site: o que ele é, o que não é, e as regras que valem para quem navega.' },
  { slug:'aviso-legal', arq:'aviso-legal.html',
    title:'Aviso Legal | ' + SITE.nome,
    desc:'Site independente, ausência de garantia de renda, exemplos ilustrativos e demais ressalvas.' },
];

const CSS_LEGAL = `
:root{--ink:#0A0D0C;--surface:#111614;--line:#232E29;--line-soft:#1A211E;--text:#EAF2ED;--muted:#8FA39A;--muted-dim:#61736B;--credit:#34DB8B;
--display:"Archivo","Helvetica Neue",Arial,sans-serif;--body:"Instrument Sans","Helvetica Neue",Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font-family:var(--body);font-size:1rem;line-height:1.62;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin-inline:auto;padding-inline:clamp(20px,5vw,40px)}
.topo{border-bottom:1px solid var(--line-soft);position:sticky;top:0;background:rgba(10,13,12,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.topo .wrap{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding-block:.95rem}
.marca{font-family:var(--display);font-weight:800;font-size:1.02rem;letter-spacing:-.02em;color:var(--text);text-decoration:none}
.marca b{color:var(--credit);font-weight:800}
.voltar{font-size:.9rem;color:var(--muted);text-decoration:none}
.voltar:hover{color:var(--credit)}
main{padding-block:clamp(48px,8vw,84px)}
h1{font-family:var(--display);font-weight:700;font-size:clamp(1.9rem,5vw,2.8rem);letter-spacing:-.03em;line-height:1.05;margin:0 0 1.3rem;text-wrap:balance}
h2{font-family:var(--display);font-weight:600;font-size:clamp(1.12rem,2.6vw,1.32rem);letter-spacing:-.02em;line-height:1.2;margin:2.9rem 0 .9rem;text-wrap:balance}
p{margin:0 0 1.05rem;color:var(--muted)}
.lead{color:var(--text);font-size:clamp(1.02rem,2vw,1.14rem);border-left:2px solid var(--credit);padding-left:1.1rem;margin-bottom:2.4rem}
strong{color:var(--text);font-weight:600}
ul{margin:0 0 1.05rem;padding-left:1.15rem;color:var(--muted)}
li{margin-bottom:.5rem}
a{color:var(--credit);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{color:#4BEA9C}
.selo{margin-top:3.4rem;padding-top:1.5rem;border-top:1px solid var(--line-soft);font-family:var(--mono);font-size:.76rem;letter-spacing:.06em;color:var(--muted-dim);text-transform:uppercase}
.rodape{border-top:1px solid var(--line-soft);padding-block:2.2rem;margin-top:3rem}
.rodape .wrap{display:flex;flex-wrap:wrap;gap:1.4rem;font-size:.88rem}
.rodape a{color:var(--muted);text-decoration:none}
.rodape a:hover{color:var(--credit)}
.aviso{color:var(--muted-dim);font-size:.82rem;line-height:1.55;margin-top:1.4rem}
`;

function paginaLegal(p, lic = null) {
  let miolo = fs.readFileSync(path.join(__dirname, 'legal', p.arq), 'utf8');
  if (lic) miolo = legalDoLicenciado(miolo, lic);
  const base = lic ? '/' + lic.slug : '';
  const outros = LEGAIS.filter(x => x.slug !== p.slug);
  const contato = lic
    ? `<a href="https://wa.me/${lic.whatsapp}" target="_blank" rel="noopener">WhatsApp ${lic.whatsapp_exibir}</a>`
    : '<a href="mailto:contato@jimmyfenner.com.br">contato@jimmyfenner.com.br</a>';
  const dono = lic ? lic.nome_completo : 'Jimmy Fenner';
  return `<style>${CSS_LEGAL}</style>
<header class="topo"><div class="wrap">
  <a class="marca" href="${base || '/'}">A Nova <b>Profissão</b></a>
  <a class="voltar" href="${base || '/'}">← Voltar ao site</a>
</div></header>
<main><div class="wrap">
${miolo}
<p class="selo">Última atualização: ${ATUALIZADO}</p>
</div></main>
<footer class="rodape"><div class="wrap">
  <a href="${base || '/'}">Início</a>
  ${outros.map(o => `<a href="${base}/${o.slug}">${o.title.split(' | ')[0]}</a>`).join('\n  ')}
  ${contato}
</div>
<div class="wrap"><p class="aviso">Site mantido por ${dono}, licenciado independente da iGreen Energy. Não é o site oficial da iGreen Energy e não representa a empresa.</p></div>
</footer>`;
}

/* ---------------- build ---------------- */
mkdir(out());
mkdir(out('admin'));

/* A home NÃO fica em dist/index.html, de propósito. Na Vercel o arquivo
   ganha dos rewrites: com index.html na raiz, o rewrite por host do
   vercel.json nunca roda e querovendercarregador.com.br mostrava a home.
   Sem arquivo em "/", o vercel.json decide: integradores no domínio deles,
   /home (servida como "/") em todos os outros. /home direto redireciona. */
const home = separaCabeca(fs.readFileSync(path.join(__dirname, 'home.html'), 'utf8'));
mkdir(out('home'));
fs.writeFileSync(out('home', 'index.html'), documento({
  body: home.body, links: home.links,
  title: SITE.title, desc: SITE.desc, canonical: SITE.url + '/',
}));

const admin = separaCabeca(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
fs.writeFileSync(out('admin', 'index.html'), documento({
  body: admin.body, links: admin.links,
  title: 'Painel de Leads | ' + SITE.nome,
  desc: 'Área restrita.', canonical: SITE.url + '/admin/', noindex: true,
}));

/* Página de integradores (eletropostos). Servida em /integradores e, pelo
   rewrite por host do vercel.json, na raiz de querovendercarregador.com.br —
   que é o endereço canônico, porque é o domínio que vai nos anúncios. */
const QVC = 'https://querovendercarregador.com.br';
const integ = separaCabeca(fs.readFileSync(path.join(__dirname, 'integradores.html'), 'utf8'));
mkdir(out('integradores'));
fs.writeFileSync(out('integradores', 'index.html'), documento({
  body: integ.body, links: integ.links,
  title: 'Quero Vender Carregador | Eletropostos iGreen para integradores',
  desc: 'Para integradores, instaladores e eletricistas: conheça a Conexão Mob, a frente de eletropostos da iGreen Energy, e como ela se encaixa na carteira de quem já trabalha com energia.',
  canonical: QVC + '/', siteNome: 'Quero Vender Carregador', comSite: false,
  og: QVC + '/media/og/integradores.jpg',
  ogAlt: 'Quem instala usina vende uma vez. Quem conecta eletroposto participa de cada recarga.',
}));

/* Página "Transição energética". Servida em /transicao-energetica e, pelo
   rewrite por host do vercel.json, na raiz de transicaoenergetica.com.br — o
   endereço canônico, porque o nome do domínio é o ativo.
   Os números do setor vêm de dados/transicao.json: cada marcador {{id.campo}}
   do HTML é trocado aqui, e {{fontes}} vira a lista de fontes do rodapé. Se
   sobrar marcador sem dado, o build PARA — é a trava contra uma atualização
   quinzenal que apague ou renomeie um campo e publique a página com buraco. */
const TE = 'https://transicaoenergetica.com.br';
const teDados = JSON.parse(fs.readFileSync(path.join(__dirname, 'dados', 'transicao.json'), 'utf8'));
const dataBR = iso => iso.split('-').reverse().join('/');
const escHtml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function renderTransicao(src) {
  const itens = teDados.itens;
  const fontes = [];
  const vistos = new Set();
  Object.values(itens).forEach(d => {
    const chave = d.fonte + '|' + d.url;
    if (!d.url || vistos.has(chave)) return;
    vistos.add(chave);
    fontes.push(`<li><a href="${escHtml(d.url)}" target="_blank" rel="noopener nofollow">${escHtml(d.fonte)}</a>${d.referencia ? ' · ' + escHtml(d.referencia) : ''}</li>`);
  });
  let html = src
    .replace(/\{\{atualizado\}\}/g, dataBR(teDados.atualizado_em))
    .replace(/\{\{fontes\}\}/g, '<ol>' + fontes.join('') + '</ol>')
    .replace(/\{\{([a-z0-9_]+)\.([a-z_]+)\}\}/g, (m, id, campo) =>
      itens[id] && itens[id][campo] != null && itens[id][campo] !== '' ? escHtml(itens[id][campo]) : m);
  const sobra = html.match(/\{\{[^}]+\}\}/g);
  if (sobra) {
    console.error('ERRO: transicao-energetica.html tem marcadores sem dado em dados/transicao.json:', [...new Set(sobra)].join(', '));
    process.exit(1);
  }
  return html;
}
const te = separaCabeca(renderTransicao(fs.readFileSync(path.join(__dirname, 'transicao-energetica.html'), 'utf8')));
mkdir(out('transicao-energetica'));
fs.writeFileSync(out('transicao-energetica', 'index.html'), documento({
  body: te.body, links: te.links,
  title: 'Transição energética no Brasil: o que muda e como empreender',
  desc: 'Abertura do mercado livre, geração distribuída e carros elétricos: entenda a transição energética no Brasil e as frentes para empreender nela com o ecossistema da iGreen Energy.',
  canonical: TE + '/', siteNome: 'Transição Energética', comSite: false,
  og: TE + '/media/og/transicao.jpg',
  ogAlt: 'A energia do Brasil está mudando de forma. E essa mudança precisa de gente.',
}));

/* vídeos e capas da página da transição: arquivos estáticos, copiados como estão */
const MEDIA = path.join(__dirname, 'media');
// fontes próprias (ver FONTES)
mkdir(out('fonts'));
fs.readdirSync(path.join(__dirname, 'fonts')).forEach(f => fs.copyFileSync(path.join(__dirname, 'fonts', f), out('fonts', f)));
(function copia(dir, rel) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const de = path.join(dir, e.name), para = out('media', rel, e.name);
    if (e.isDirectory()) return copia(de, path.join(rel, e.name));
    mkdir(path.dirname(para));
    fs.copyFileSync(de, para);
  });
})(MEDIA, '');

LEGAIS.forEach(p => {
  mkdir(out(p.slug));
  fs.writeFileSync(out(p.slug, 'index.html'), documento({
    body: paginaLegal(p), title: p.title, desc: p.desc,
    canonical: SITE.url + '/' + p.slug,
  }));
});

/* ---------------- Publicador do YouTube ----------------
   Páginas públicas que o Google exige para o app OAuth "Publicador Jimmy
   Fenner" (projeto publicador-youtube-jimmy, studio/tools/publicar_youtube_api.py)
   e que a auditoria da API do YouTube confere: página inicial, privacidade e
   termos. Fontes só com o miolo em publicador/, no shell das páginas
   jurídicas. noindex: não têm nada a ver com o recrutamento. */
const PUBLICADOR = [
  { slug:'', arq:'index.html', nome:'Início',
    title:'Publicador Jimmy Fenner',
    desc:'Ferramenta pessoal que publica e agenda os vídeos do canal de YouTube do Jimmy Fenner.' },
  { slug:'privacidade', arq:'privacidade.html', nome:'Política de Privacidade',
    title:'Política de Privacidade | Publicador Jimmy Fenner',
    desc:'Quais dados do YouTube o Publicador acessa, onde eles ficam e como revogar o acesso.' },
  { slug:'termos', arq:'termos.html', nome:'Termos de Uso',
    title:'Termos de Uso | Publicador Jimmy Fenner',
    desc:'As condições de uso do Publicador, a ferramenta pessoal de publicação no YouTube do Jimmy Fenner.' },
];

function paginaPublicador(p) {
  const miolo = fs.readFileSync(path.join(__dirname, 'publicador', p.arq), 'utf8');
  return `<style>${CSS_LEGAL}</style>
<header class="topo"><div class="wrap">
  <a class="marca" href="/publicador">Publicador <b>Jimmy Fenner</b></a>
  <a class="voltar" href="https://www.youtube.com/@jimmyfenner" target="_blank" rel="noopener">Canal no YouTube →</a>
</div></header>
<main><div class="wrap">
${miolo}
<p class="selo">Última atualização: ${ATUALIZADO_PUBLICADOR}</p>
</div></main>
<footer class="rodape"><div class="wrap">
  ${PUBLICADOR.map(o => `<a href="/publicador${o.slug && '/' + o.slug}">${o.nome}</a>`).join('\n  ')}
  <a href="mailto:contato@jimmyfenner.com.br">contato@jimmyfenner.com.br</a>
</div>
<div class="wrap"><p class="aviso">Ferramenta pessoal de Jimmy Fenner. Usa os Serviços de API do YouTube.</p></div>
</footer>`;
}

PUBLICADOR.forEach(p => {
  const dir = p.slug ? ['publicador', p.slug] : ['publicador'];
  mkdir(out(...dir));
  fs.writeFileSync(out(...dir, 'index.html'), documento({
    body: paginaPublicador(p), title: p.title, desc: p.desc,
    canonical: SITE.url + '/' + dir.join('/'), noindex: true, autor: 'Jimmy Fenner',
  }));
});

/* ---------------- espelhos para licenciados ----------------
   anovaprofissao.com.br/<slug>: a home com o contato, o link de cadastro, a
   apresentação e as páginas jurídicas do licenciado (dados/licenciados.json).
   Os blocos que pertencem ao Jimmy estão marcados na home.html com
   <!--lic:nome-->...<!--/lic:nome-->; o resto é igual para todos.
   noindex: o espelho é quase idêntico à home e não pode disputar a busca com
   ela. Ao final, o build PARA se sobrar no espelho qualquer coisa do Jimmy
   (nome visível, WhatsApp, ID de cadastro) — é a trava contra uma edição da
   home que esqueça de marcar um bloco novo. */
const RESERVADOS = new Set(['admin', 'home', 'integradores', 'transicao-energetica', 'transicaoenergetica',
  'privacidade', 'termos', 'aviso-legal', 'media', 'fonts', 'seo', 'dados', 'og', 'api', 'blog', 'publicador', 'apresentacao']);
const LICS = JSON.parse(fs.readFileSync(path.join(__dirname, 'dados', 'licenciados.json'), 'utf8')).licenciados;
const esc = escHtml;

function trocaBloco(html, nome, novo) {
  const re = new RegExp(`<!--lic:${nome}-->[\\s\\S]*?<!--\\/lic:${nome}-->`, 'g');
  if (!re.test(html)) { console.error(`ERRO: bloco <!--lic:${nome}--> não encontrado na home.html`); process.exit(1); }
  return html.replace(re, novo);
}
function trocaExato(html, de, para) {
  if (!html.includes(de)) { console.error(`ERRO: trecho esperado não encontrado na home.html: ${de.slice(0, 60)}`); process.exit(1); }
  return html.split(de).join(para);
}
function legalDoLicenciado(miolo, lic) {
  const zap = `<a href="https://wa.me/${lic.whatsapp}" target="_blank" rel="noopener">${lic.whatsapp_exibir}</a>`;
  const operador = ` A página é hospedada e operada tecnicamente por Jimmy Fenner, também licenciado independente da iGreen Energy, que atua como operador: armazena os dados em nome do responsável, apenas para viabilizar o funcionamento do site e o aviso de novos contatos.`;
  return miolo
    .replace(/<strong>Jimmy Fenner<\/strong>, licenciado independente da iGreen Energy, estabelecido em Balneário Camboriú, Santa Catarina\./,
      `<strong>${esc(lic.nome_completo)}</strong>, licenciado independente da iGreen Energy, estabelecido em ${esc(lic.cidade)}, ${esc(lic.estado)}.${operador}`)
    .replace(/use o e-mail <a href="mailto:contato@jimmyfenner\.com\.br">contato@jimmyfenner\.com\.br<\/a> ou o WhatsApp <a[^>]*>[^<]*<\/a>/,
      `use o WhatsApp ${zap}`)
    .replace(/basta escrever para <a href="mailto:contato@jimmyfenner\.com\.br">contato@jimmyfenner\.com\.br<\/a>/,
      `basta mandar mensagem para o WhatsApp ${zap}`)
    .replace(/Dúvidas sobre estes termos: <a href="mailto:contato@jimmyfenner\.com\.br">contato@jimmyfenner\.com\.br<\/a>/,
      `Dúvidas sobre estes termos: WhatsApp ${zap}`)
    .replace(/comarca de Balneário Camboriú, Santa Catarina/, `comarca de ${esc(lic.cidade)}, ${esc(lic.estado)}`)
    .replace(/Jimmy Fenner(?!, também licenciado)/g, esc(lic.nome_completo));
}
function homeDoLicenciado(src, lic) {
  const n = esc(lic.nome), nc = esc(lic.nome_curto);
  const zapMsg = encodeURIComponent(`Olá ${lic.nome_curto}! Vi a sua página A Nova Profissão e quero entender melhor a oportunidade.`);
  const redes = [
    lic.instagram && `<a href="https://instagram.com/${esc(lic.instagram.replace(/^@/, ''))}" target="_blank" rel="noopener" data-ev="instagram_rodape">Instagram</a>`,
    lic.youtube && `<a href="${esc(lic.youtube)}" target="_blank" rel="noopener" data-ev="youtube_rodape">YouTube</a>`,
  ].filter(Boolean).join('\n          ');
  const pessoa = `<div class="person">
      <div class="person__photo reveal">
        <img src="${esc(lic.foto)}" alt="${esc(lic.foto_alt)}" width="760" height="950" decoding="async" loading="lazy">
      </div>
      <div class="reveal">
        <h3 style="font-size:clamp(1.35rem,3vw,1.9rem);font-weight:700">${esc(lic.nome_completo)}</h3>
        <div class="creds">
          <span class="chip">Licenciado desde ${esc(lic.desde_curto)}</span>
          <span class="chip">Qualificação ${esc(lic.qualificacao)}</span>
          <span class="chip">${esc(lic.cidade)}, ${esc(lic.uf)}${lic.regiao ? ' · ' + esc(lic.regiao) : ''}</span>
        </div>
        <div class="prose" style="margin-top:1.6rem">
          ${lic.bio.map(t => `<p>${esc(t)}</p>`).join('\n          ')}
          <div class="verme">
            <p>Se preferir conversar antes de fazer a avaliação, me chame no WhatsApp.</p>
            <div class="btn-row">
              <a class="btn btn--ghost" href="https://wa.me/${lic.whatsapp}?text=${zapMsg}" target="_blank" rel="noopener" data-ev="whatsapp_licenciado">WhatsApp ${esc(lic.whatsapp_exibir)}</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  let h = src;
  h = trocaBloco(h, 'ctx', `<p class="hero__ctx">Uma oportunidade profissional desenvolvida através do modelo de licenciamento da <b>iGreen Energy</b>.<br>Esta página é de <a href="#jimmy" style="color:var(--muted);font-weight:500;text-decoration:none;border-bottom:1px solid var(--line)">${n}</a>, licenciado independente da iGreen Energy em ${esc(lic.cidade)}/${esc(lic.uf)}.</p>`);
  h = trocaBloco(h, 'pessoa', pessoa);
  h = trocaBloco(h, 'redes', redes);
  h = trocaBloco(h, 'dono', esc(lic.nome_completo));
  h = trocaBloco(h, 'cidade', `${esc(lic.cidade)}, ${esc(lic.uf)}`);
  h = trocaExato(h, '"Jimmy, isso é pirâmide?"', `"${nc}, isso é pirâmide?"`);
  h = trocaExato(h, '<span>Falar com Jimmy</span>', `<span>Falar com ${nc}</span>`);
  h = h.replace(/vídeo do Jimmy/g, `vídeo do ${nc}`);
  // a âncora aparece na barra de endereço de quem clica em "Quem acompanha"
  h = h.replace(/href="#jimmy"/g, 'href="#quem-acompanha"').replace('<section id="jimmy">', '<section id="quem-acompanha">')
       .replace('<!-- JIMMY -->', '<!-- QUEM ACOMPANHA -->');
  // configuração do script: nem o número nem o ID do Jimmy ficam no espelho
  h = h.replace(/var WHATSAPP = "\d+";/, `var WHATSAPP = "${lic.whatsapp}";`)
       .replace(/var NOME {5}= "Jimmy";/, `var NOME     = "${lic.nome_curto}";`)
       .replace(/var LINK_CADASTRO = "[^"]*";/, `var LINK_CADASTRO = "${lic.link_cadastro}";`);
  // páginas jurídicas do próprio licenciado
  h = h.replace(/href="\/(privacidade|termos|aviso-legal)"/g, `href="/${lic.slug}/$1"`);
  const dados = { slug: lic.slug, nome: lic.nome, nome_curto: lic.nome_curto, whatsapp: lic.whatsapp,
                  link_cadastro: lic.link_cadastro, link_grupo: lic.link_grupo || '', meta_pixel: lic.meta_pixel || '' };
  return `<script>window.ANP_LIC=${JSON.stringify(dados)};</script>\n` + h;
}
function conferirEspelho(html, slug) {
  const visivel = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
  const restos = [];
  if (/Jimmy|Fenner/.test(visivel)) restos.push('nome do Jimmy no texto: ' + (visivel.match(/.{0,40}(Jimmy|Fenner).{0,40}/) || [''])[0].trim());
  if (/5548991067007|99106-7007/.test(html)) restos.push('WhatsApp do Jimmy');
  if (/[?&]id=1971\b/.test(html)) restos.push('ID de cadastro do Jimmy');
  if (/jimmyfenner|minerandoosol/.test(html)) restos.push('rede social do Jimmy');
  if (restos.length) { console.error(`ERRO: o espelho /${slug} ainda tem coisas do Jimmy: ` + restos.join(' | ')); process.exit(1); }
}

const espelhos = [];
Object.entries(LICS).forEach(([slug, l]) => {
  if (!l.ativo) return;
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || RESERVADOS.has(slug)) {
    console.error(`ERRO: "${slug}" não pode ser endereço de licenciado (formato inválido ou nome reservado).`); process.exit(1);
  }
  const lic = Object.assign({ slug }, l);
  const corpo = homeDoLicenciado(home.body, lic);
  conferirEspelho(corpo, slug);
  mkdir(out(slug));
  fs.writeFileSync(out(slug, 'index.html'), documento({
    body: corpo, links: home.links,
    title: `${lic.nome} · A Nova Profissão | Licenciamento iGreen Energy`,
    desc: SITE.desc, canonical: SITE.url + '/' + slug, noindex: true, autor: lic.nome_completo,
    ogAlt: `A venda acontece uma vez. A conta do cliente chega todo mês. ${lic.nome}, licenciado independente iGreen Energy.`,
  }));
  LEGAIS.forEach(p => {
    const corpoLegal = paginaLegal(p, lic);
    const sobra = corpoLegal.replace(/operada tecnicamente por Jimmy Fenner/, '').match(/Jimmy|jimmyfenner|99106|Balneário/);
    if (sobra) { console.error(`ERRO: /${slug}/${p.slug} ainda cita o Jimmy (${sobra[0]}).`); process.exit(1); }
    mkdir(out(slug, p.slug));
    fs.writeFileSync(out(slug, p.slug, 'index.html'), documento({
      body: corpoLegal, title: p.title.replace(SITE.nome, `${SITE.nome} · ${lic.nome}`), desc: p.desc,
      canonical: SITE.url + '/' + slug + '/' + p.slug, noindex: true, autor: lic.nome_completo,
    }));
  });
  espelhos.push(slug);
});

/* ---------------- /apresentacao: deck do Plano de Negócios ----------------
   Arquivo único já com <head> (fonte e imagens embutidas), copiado como está
   de apresentacao/. Só ganha noindex — é material de apoio compartilhado por
   link, não página de recrutamento — e Open Graph para a prévia no WhatsApp.
   O PDF ao lado é servido no mesmo caminho. */
const APRES = path.join(__dirname, 'apresentacao');
if (fs.existsSync(APRES)) {
  mkdir(out('apresentacao'));
  fs.readdirSync(APRES).forEach(f => {
    if (f === 'index.html') {
      const html = fs.readFileSync(path.join(APRES, f), 'utf8').replace('<head>', `<head>
<meta name="robots" content="noindex,nofollow">
<meta property="og:title" content="Plano de Negócios iGreen 2026 — apresentação">
<meta property="og:description" content="Energia, telecom, seguros e eletropostos: como funciona o licenciamento iGreen, produto a produto.">
<meta property="og:url" content="${SITE.url}/apresentacao">
<meta property="og:type" content="website">
<link rel="canonical" href="${SITE.url}/apresentacao">`);
      fs.writeFileSync(out('apresentacao', 'index.html'), html);
    } else if (!f.startsWith('.')) {
      fs.copyFileSync(path.join(APRES, f), out('apresentacao', f));
    }
  });
}

/* ---------------- robots.txt e sitemap.xml por domínio ----------------
   São três domínios no mesmo projeto, e cada um tem o próprio canônico. O
   Google lê o robots.txt e o sitemap de cada host: por isso os arquivos ficam
   em dist/seo/<dominio>/ e o vercel.json os entrega por host (na raiz eles
   ganhariam dos rewrites, como aconteceu com a home).
   lastmod = data do último commit que mexeu na página (ou nos dados dela);
   sem histórico do git disponível, cai para a data do build. */
const { execSync } = require('child_process');
const hoje = new Date().toISOString().slice(0, 10);
function ultimaMudanca(...arquivos) {
  try {
    const d = execSync(`git log -1 --format=%cs -- ${arquivos.map(a => JSON.stringify(a)).join(' ')}`,
      { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : hoje;
  } catch (e) { return hoje; }
}
const DOMINIOS = {
  'anovaprofissao.com.br': [
    { loc: SITE.url + '/', mod: ultimaMudanca('home.html'), freq: 'weekly', pri: '1.0' },
    ...LEGAIS.map(p => ({ loc: SITE.url + '/' + p.slug, mod: ultimaMudanca('legal/' + p.slug + '.html'), freq: 'yearly', pri: '0.3' })),
  ],
  'querovendercarregador.com.br': [
    { loc: QVC + '/', mod: ultimaMudanca('integradores.html'), freq: 'weekly', pri: '1.0' },
  ],
  'transicaoenergetica.com.br': [
    { loc: TE + '/', mod: ultimaMudanca('transicao-energetica.html', 'dados/transicao.json'), freq: 'weekly', pri: '1.0' },
  ],
};
Object.entries(DOMINIOS).forEach(([dom, urls]) => {
  mkdir(out('seo', dom));
  fs.writeFileSync(out('seo', dom, 'robots.txt'),
`User-agent: *
Allow: /
Disallow: /admin/

Sitemap: https://${dom}/sitemap.xml
`);
  fs.writeFileSync(out('seo', dom, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.mod}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>
`);
});

const faq = faqSchema(home.body);
const n = faq ? faq.mainEntity.length : 0;
console.log('dist/home/index.html ', (fs.statSync(out('home', 'index.html')).size / 1024).toFixed(0) + ' KB');
console.log('dist/admin/index.html', (fs.statSync(out('admin', 'index.html')).size / 1024).toFixed(0) + ' KB');
const faqInteg = faqSchema(integ.body);
console.log('dist/integradores/index.html', (fs.statSync(out('integradores', 'index.html')).size / 1024).toFixed(0) + ' KB · FAQ: ' + (faqInteg ? faqInteg.mainEntity.length : 0) + ' perguntas');
const faqTe = faqSchema(te.body);
console.log('dist/transicao-energetica/index.html', (fs.statSync(out('transicao-energetica', 'index.html')).size / 1024).toFixed(0) + ' KB · FAQ: ' + (faqTe ? faqTe.mainEntity.length : 0) + ' perguntas · dados de ' + dataBR(teDados.atualizado_em));
LEGAIS.forEach(p => console.log('dist/' + p.slug + '/index.html'));
console.log('espelhos de licenciados: ' + (espelhos.length ? espelhos.map(s => '/' + s).join(', ') : 'nenhum'));
console.log('dist/seo/<dominio>/robots.txt e sitemap.xml: ' + Object.keys(DOMINIOS).join(', '));
if (fs.existsSync(APRES)) console.log('dist/apresentacao: deck do Plano de Negócios (noindex)');
console.log('FAQPage schema: ' + n + ' perguntas extraídas da própria página');
