# A Nova Profissão — contexto do projeto

Site de recrutamento de licenciados iGreen Energy do **Jimmy Fenner**.
Domínio: **anovaprofissao.com.br**

Leia este arquivo antes de mexer em qualquer coisa. Ele existe para que
qualquer sessão futura do Claude continue o trabalho sem recomeçar do zero.

## Como o projeto funciona

- `home.html` e `admin.html` são os **fontes**. Contêm só o conteúdo do
  `<body>` (sem doctype/html/head) — o mesmo formato aceito pela ferramenta
  de Artifact, o que permite publicar prévia e site a partir do mesmo arquivo.
- `build.js` envolve cada fonte com o `<head>` completo (SEO, Open Graph,
  JSON-LD) e escreve `dist/`. O schema **FAQPage é extraído da própria
  página** por regex, então nunca fica dessincronizado do texto visível.
- `dist/` não vai pro Git. A Vercel roda `node build.js` a cada push.
- Deploy: push na branch `main` → Vercel publica sozinha.

Para alterar o site: edite `home.html`, rode `node build.js` para conferir,
`git commit` e `git push`. Republique também o Artifact de prévia
(mesmo caminho de arquivo mantém a mesma URL).

## Regras de conteúdo — inegociáveis

1. **Nunca inventar dado comercial.** Valores de licença, percentuais de
   comissão, coberturas de seguro, nome de seguradora, regras do plano de
   carreira. Se não foi o Jimmy que forneceu, o texto diz que as condições
   vigentes são apresentadas na conversa.
2. **Nenhum depoimento fictício.** Os espaços de prova social ficam vazios e
   marcados como reservados até o Jimmy trazer pessoas reais e autorizadas.
3. **Nenhuma promessa de renda.** Sem "liberdade financeira", "mude sua
   vida", "últimas vagas", cronômetro ou escassez artificial.
4. **O aviso de site independente fica.** Jimmy é licenciado independente;
   este não é o site oficial da iGreen Energy. Aparece no hero e no rodapé.
5. Estética anti-MMN. O briefing inteiro do cliente é sobre isso.

## Fatos de produto (corrigidos pelo Jimmy)

- Produtos de **receita** do licenciado: Conexão Green, Conexão Livre,
  Conexão Placas, Telecom, Conexão Seguros (seguro veicular mensal).
- **iGreen Club NÃO é fonte de renda.** É um presente/cortesia para todo
  cliente de energia, telecom e seguros, para o cliente se sentir valorizado
  e melhorar a aceitação dos demais produtos. Existe a possibilidade de
  vender avulso a R$ 19,90/mês, mas é último recurso. Ele tem bloco próprio
  na página, separado da lista de produtos — não devolva ele para a lista.
- Qualificação do Jimmy na iGreen: **Acionista**. Licenciado desde 2022.
- WhatsApp que recebe os leads: **48 99106-7007**.

## Backend dos leads

Arquitetura simplificada (set/2026): o site grava **direto** no Supabase via
PostgREST, sem Edge Function no meio. Foi uma decisão deliberada — o Jimmy é
leigo e a função exigia passos demais. A segurança não mudou:

- `db/schema.sql` — tabela `leads` + RLS. O papel `anon` só tem INSERT, e só
  nas colunas do formulário (grant por coluna). Não lê, não altera status, não
  mexe em anotações. SELECT e UPDATE exigem `authenticated`, ou seja, login.
- URL e chave anon ficam em `home.html` e `admin.html`. A chave anon é pública
  por natureza; quem protege os dados é a RLS.
- `supabase/functions/whatsapp/` — avisos de lead novo por WhatsApp via
  Evolution API. Guarda a chave da Evolution nos Secrets do Supabase. Ações:
  connect (cria instância NOVA a cada conexão, nome `anovaprofissao-<data>`,
  apagando a anterior — o Jimmy não quer nome fixo nem acúmulo de instâncias),
  status, disconnect, notify e teste. Destinatários ficam na tabela
  `notificacao_destinatarios`, gerenciados pelo painel. Disparo: Database
  Webhook em INSERT na tabela leads.
- Escrita às cegas: supabase.co e o host da Evolution são bloqueados pela
  política de egresso em toda sessão do Claude. Só github.com passa. Por isso
  o envio de mensagem tenta o formato v2 e cai para o v1 — não deu para
  descobrir a versão do servidor. Qualquer ajuste depende do Jimmy testar e
  trazer o erro.
- E-mail (Resend) continua pendente para depois.

Limitação do ambiente: o domínio supabase.co é bloqueado pela política de
egresso tanto na nuvem quanto no VM do Mac. Não dá para testar a API do
Supabase a partir de nenhuma sessão do Claude — a verificação tem que ser
feita pelo Jimmy, usando o site publicado.

## Conteúdo editável pelo painel (aba "Conteúdo")

Tabelas `site_config` (chave/valor) e `depoimentos`, mais o bucket `publico`
do Storage para as fotos. O site lê essas duas tabelas em tempo de execução
com a chave anon (leitura liberada; escrita só com login).

O que é editável: os três vídeos (hero, pirâmide, apresentação), o WhatsApp
de destino dos leads, e os depoimentos com nome, cidade, tempo, texto e foto.

O que NÃO é editável e é proposital: FAQ, headlines e textos dos produtos
ficam no código. Esses textos precisam estar no HTML servido, senão o Google
não os lê na primeira passada — e o FAQPage schema é extraído deles no build.
Se algum dia forem para o banco, o build precisa buscá-los em tempo de build
(Vercel alcança o Supabase) e não em tempo de execução.

A seção de depoimentos nasce com `hidden` e só aparece quando existe pelo
menos um depoimento ativo — nunca mostrar espaço reservado a visitante real.
Vídeos usam fachada: miniatura + botão, e o iframe só carrega no clique, para
não pesar no Core Web Vitals.

## Pendências conhecidas

- Proteção anti-spam no formulário (honeypot + limite por IP). O endpoint de
  gravação é público; antes de apontar o domínio real, fechar isso.
- Avisos de lead novo (fase 2, ver acima).
- Domínio anovaprofissao.com.br ainda não apontado — o Jimmy mantém o domínio
  em outro destino até o site estar 100%.

## Sistema visual

Grafite com viés verde (`--ink #0A0D0C`), verde elétrico `--credit #34DB8B`
usado com sentido: é o **verde de crédito de um extrato**, não um destaque
decorativo. Tipos: Archivo (display), Instrument Sans (texto),
IBM Plex Mono (dados). O elemento estrutural que se repete é a **linha de
extrato** — rótulo à esquerda, valor à direita, separados por fio.
Tema escuro único e deliberado; todas as cores são pintadas explicitamente.

## Roadmap combinado

Feito: home completa, quiz com captura de origem, painel de leads, backend.
Próximo: /blog em Markdown para os artigos de SEO, sitemap dinâmico,
dados estruturados de artigo. Depois: simulador (baixa prioridade, precisa
de revisão jurídica — simulador de ganhos em modelo tipo iGreen é
exatamente o que fiscalização olha primeiro).
