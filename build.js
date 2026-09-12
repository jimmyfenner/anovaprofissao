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
const limpa = s => s.replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function schemas(html) {
  const pessoa = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Jimmy Fenner',
    jobTitle: 'Licenciado iGreen Energy',
    url: SITE.url,
    sameAs: ['https://youtube.com/@jimmyfenner'],
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
  return [site, pessoa, faqSchema(html)].filter(Boolean)
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

function documento({ body, title, desc, canonical, noindex, links = '' }) {
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
<meta property="og:site_name" content="${SITE.nome}">
<meta property="og:locale" content="${SITE.locale}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE.url}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${SITE.url}/og.png">
${noindex ? '' : schemas(body)}
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

/* ---------------- build ---------------- */
mkdir(out());
mkdir(out('admin'));

const home = separaCabeca(fs.readFileSync(path.join(__dirname, 'home.html'), 'utf8'));
fs.writeFileSync(out('index.html'), documento({
  body: home.body, links: home.links,
  title: SITE.title, desc: SITE.desc, canonical: SITE.url + '/',
}));

const admin = separaCabeca(fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8'));
fs.writeFileSync(out('admin', 'index.html'), documento({
  body: admin.body, links: admin.links,
  title: 'Painel de Leads | ' + SITE.nome,
  desc: 'Área restrita.', canonical: SITE.url + '/admin/', noindex: true,
}));

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
</urlset>
`);

const faq = faqSchema(home.body);
const n = faq ? faq.mainEntity.length : 0;
console.log('dist/index.html      ', (fs.statSync(out('index.html')).size / 1024).toFixed(0) + ' KB');
console.log('dist/admin/index.html', (fs.statSync(out('admin', 'index.html')).size / 1024).toFixed(0) + ' KB');
console.log('dist/robots.txt, dist/sitemap.xml');
console.log('FAQPage schema: ' + n + ' perguntas extraídas da própria página');
