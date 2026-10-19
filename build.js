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
const ATUALIZADO = '19 de outubro de 2026';

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
    .replace(/<link\b[^>]*>\s*/gi, m => { links.push(m.trim()); return ''; });
  return { body: body.trimStart(), links: links.join('\n') };
}

function documento({ body, title, desc, canonical, noindex, links = '', siteNome = SITE.nome, comSite = true }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="${SITE.theme}">
<meta name="author" content="${SITE.autor}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large">'}
<link rel="canonical" href="${canonical}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
${links}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${siteNome}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE.url}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${SITE.url}/og.png">
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

function paginaLegal(p) {
  const miolo = fs.readFileSync(path.join(__dirname, 'legal', p.arq), 'utf8');
  const outros = LEGAIS.filter(x => x.slug !== p.slug);
  return `<style>${CSS_LEGAL}</style>
<header class="topo"><div class="wrap">
  <a class="marca" href="/">A Nova <b>Profissão</b></a>
  <a class="voltar" href="/">← Voltar ao site</a>
</div></header>
<main><div class="wrap">
${miolo}
<p class="selo">Última atualização: ${ATUALIZADO}</p>
</div></main>
<footer class="rodape"><div class="wrap">
  <a href="/">Início</a>
  ${outros.map(o => `<a href="/${o.slug}">${o.title.split(' | ')[0]}</a>`).join('\n  ')}
  <a href="mailto:contato@jimmyfenner.com.br">contato@jimmyfenner.com.br</a>
</div>
<div class="wrap"><p class="aviso">Site mantido por Jimmy Fenner, licenciado independente da iGreen Energy. Não é o site oficial da iGreen Energy e não representa a empresa.</p></div>
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
}));

/* vídeos e capas da página da transição: arquivos estáticos, copiados como estão */
const MEDIA = path.join(__dirname, 'media');
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

fs.writeFileSync(out('robots.txt'),
`User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${SITE.url}/sitemap.xml
`);

const hoje = new Date().toISOString().slice(0, 10);
fs.writeFileSync(out('sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE.url}/</loc><lastmod>${hoje}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
${LEGAIS.map(p => `  <url><loc>${SITE.url}/${p.slug}</loc><lastmod>${hoje}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`).join('\n')}
</urlset>
`);

const faq = faqSchema(home.body);
const n = faq ? faq.mainEntity.length : 0;
console.log('dist/home/index.html ', (fs.statSync(out('home', 'index.html')).size / 1024).toFixed(0) + ' KB');
console.log('dist/admin/index.html', (fs.statSync(out('admin', 'index.html')).size / 1024).toFixed(0) + ' KB');
const faqInteg = faqSchema(integ.body);
console.log('dist/integradores/index.html', (fs.statSync(out('integradores', 'index.html')).size / 1024).toFixed(0) + ' KB · FAQ: ' + (faqInteg ? faqInteg.mainEntity.length : 0) + ' perguntas');
const faqTe = faqSchema(te.body);
console.log('dist/transicao-energetica/index.html', (fs.statSync(out('transicao-energetica', 'index.html')).size / 1024).toFixed(0) + ' KB · FAQ: ' + (faqTe ? faqTe.mainEntity.length : 0) + ' perguntas · dados de ' + dataBR(teDados.atualizado_em));
LEGAIS.forEach(p => console.log('dist/' + p.slug + '/index.html'));
console.log('dist/robots.txt, dist/sitemap.xml');
console.log('FAQPage schema: ' + n + ' perguntas extraídas da própria página');
