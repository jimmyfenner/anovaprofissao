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

0. **O preço da licença está fixo no FAQ de `home.html`** (R$ 1.997 à vista
   ou 12x R$ 197,41, licença Connect Full), autorizado pelo Jimmy em set/2026.
   **A licença é anual: R$ 1.997 por ano, paga todos os anos** (confirmado
   pelo Jimmy em 19/10/2026). Ele não quer isso escancarado, mas o texto tem
   que dizer: "R$ 1.997 por ano" no FAQ e "licença anual" no quiz. Nunca
   escrever "investimento único" ou "custo de entrada único". A Connect Full
   dá acesso a energia, telecom, seguros e à **Conexão Mob** (vender
   eletropostos). O vídeo de integradores (tgoz7p85QIY) diz certo
   "R$ 1.997 por ano" aos 12:58; a legenda automática do YouTube escreve
   "R$997" porque come o "mil". Conferir pelo áudio, não pela legenda.
   Fica no código e não no painel de propósito: "quanto custa ser licenciado
   iGreen" é uma das buscas-alvo, e o número precisa estar no HTML servido
   para ranquear — além de entrar no FAQPage schema. Quando mudar, editar ali.
   Existe também uma licença de R$ 997 (telefone + seguros, sem energia) que
   o Jimmy optou por NÃO exibir no site.
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
- E-mail no mesmo fluxo do WhatsApp, pelo **Forward Email** desde nov/2026
  (secret `FORWARDEMAIL_API_TOKEN`, o mesmo de Projects/monitor-hub-igreen/.env).
  Remetente conforme a página: "A Nova Profissão <no-reply@anovaprofissao.com.br>"
  (domínio adicionado pelo Jimmy no Forward Email em 03/11/2026, envio liberado
  no mesmo dia: MX, SPF, DKIM, Return-Path `fe-bounces` e DMARC na Cloudflare)
  ou "Quero Vender Carregador <no-reply@querovendercarregador.com.br>" para
  integradores (`FE_REMETENTES` na função). Se o Forward Email falhar, a mesma
  mensagem tenta o Resend. O MX do anovaprofissao.com.br aponta para o Forward
  Email: e-mail recebido em @anovaprofissao.com.br segue as regras de
  encaminhamento de lá. Um destinatário pode ter numero, email ou os dois
  (tabela notificacao_destinatarios).
- `notificacoes_log` registra TODA tentativa, com o erro quando falha, e o
  painel mostra as 40 últimas na aba Notificações. Foi criada depois de um
  lead (Moacir) não gerar aviso e não haver como descobrir o motivo — sem o
  log, diagnosticar isso vira adivinhação.
- Cada lead no painel tem "Reenviar aviso", que chama a função com lead_id e
  refaz o envio. Serve para recuperar avisos perdidos.
- O GATILHO NÃO É UM DATABASE WEBHOOK. A tela de Webhooks do Supabase falha
  neste projeto com: schema "supabase_functions" does not exist — a
  infraestrutura que ela assume não está instalada. O disparo é um trigger
  próprio em public.leads chamando net.http_post (pg_net) para a Edge
  Function, com a service_role key guardada na tabela `private_config`
  (sem policy nenhuma: inalcançável pela API, só pelo banco por dentro).
  O trigger captura exceção e devolve NEW mesmo em erro — um aviso que falha
  jamais pode derrubar a gravação do lead.
- ATENÇÃO ao diagnosticar "não recebi o aviso": o botão "Enviar teste" NÃO
  passa pelo Database Webhook. Testar por ele e concluir que o fluxo está bom
  é o erro clássico — confirme sempre que o webhook existe em Database >
  Webhooks, tabela leads, evento Insert, tipo Supabase Edge Functions.

Limitação do ambiente: o domínio supabase.co é bloqueado pela política de
egresso tanto na nuvem quanto no VM do Mac. Não dá para testar a API do
Supabase a partir de nenhuma sessão do Claude — a verificação tem que ser
feita pelo Jimmy, usando o site publicado.

## Conteúdo editável pelo painel (aba "Conteúdo")

Tabelas `site_config` (chave/valor) e `depoimentos`, mais o bucket `publico`
do Storage para as fotos. O site lê essas duas tabelas em tempo de execução
com a chave anon (leitura liberada; escrita só com login).

O que é editável: os quatro vídeos (hero, pirâmide, resumo da apresentação e
apresentação completa), o WhatsApp de destino dos leads, e os depoimentos com
nome, cidade, tempo, texto e foto.

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

**Desde 03/11/2026 a home, a página de integradores e o /agendar usam o kit do
igreencel.com.br e do querocarregador.com.br** (pedido do Jimmy: "ficou feio
comparado aos demais sistemas"): verde-escuro `--ink #09110E` com fundo vivo
(`.aurora`, três manchas de luz que andam devagar, e `.grao`), malha `.grade` no
alto do hero, cabeçalho em pílula de vidro com `.brand__ico`, botões
arredondados (primário em degradê verde `#21CA70`, fantasma em vidro),
sobrancelha `.eyebrow` em pílula com ponto, caixas em vidro (raio 20 px,
degradê leve e filete claro), moldura com sombra verde no que é ação (vídeo,
avaliação, formulário), `.brilho` numa frase do H1 e entrada `.surgir`/`.reveal`
com `--ease-suave` e um leve desfoque. Fontes **Raleway** (títulos, 800) e
**Outfit** (texto e rótulos), servidas pelo próprio site; o body tem
`font-variant-numeric: lining-nums` porque a Raleway traz algarismos antigos.
As superfícies (`--surface`, `--line`) são translúcidas para o fundo aparecer.
A **linha de extrato** continua como elemento da home. Não voltar ao grafite
chapado nem aos cantos retos. Painel, transição e páginas jurídicas seguem com
o visual antigo (Archivo/Instrument Sans/Plex Mono).

## Roadmap combinado

Feito: home completa, quiz com captura de origem, painel de leads, backend.
Próximo: /blog em Markdown para os artigos de SEO, sitemap dinâmico,
dados estruturados de artigo. Depois: simulador (baixa prioridade, precisa
de revisão jurídica — simulador de ganhos em modelo tipo iGreen é
exatamente o que fiscalização olha primeiro).

## Páginas jurídicas

`legal/privacidade.html`, `legal/termos.html` e `legal/aviso-legal.html` trazem
só o miolo do texto. O `build.js` envolve cada uma no shell visual (`CSS_LEGAL`
+ `paginaLegal`) e publica em `/privacidade`, `/termos` e `/aviso-legal`.
A constante `ATUALIZADO` é a data de revisão dos textos e é **fixa de
propósito** — atualize à mão sempre que o conteúdo de `legal/` mudar, nunca
deixe ela seguir a data do build.

Os textos são redação padrão de mercado, escritos pelo Claude, não por
advogado. Se mudar a forma de coletar dados (novo campo no formulário, nova
ferramenta de medição, novo destino dos dados), a Política de Privacidade tem
que mudar junto — é ela que descreve o tratamento real.

## Cadastro direto

Quem já chega decidido não passa pelo quiz: clica em "quero me cadastrar",
deixa **nome, e-mail e WhatsApp** num modal (`#cdmodal`) e é redirecionado
para `LINK_CADASTRO`. O lead entra com `tipo = 'direto'` e recebe aviso com
cabeçalho próprio no WhatsApp e no e-mail, além de selo no painel.

**CPF não é coletado, de propósito.** O link de cadastro não aceita CPF como
parâmetro, a iGreen pede o dado no próprio checkout, e guardar CPF aqui só
aumentaria a exposição sem nenhum ganho. Não reintroduza.

A ida para o cadastro nunca espera o banco: há um timeout de 2,5s que segue
mesmo se a gravação falhar. Perder o lead é ruim; perder a pessoa decidida
na porta do checkout é pior.

Migração necessária: `db/02-cadastro-direto.sql` (colunas `email` e `tipo`).

## Exclusão de lead

O painel exclui lead de verdade (DELETE), em dois toques: o primeiro arma o
botão, o segundo apaga, e ele desarma sozinho em 5s. Não é só limpeza de
teste — é o que atende pedido de exclusão previsto na LGPD e prometido na
Política de Privacidade. Exige `db/03-excluir-lead.sql` aplicado.

Os campos de identificação (nome, whatsapp, email, cidade, uf) são
editáveis no detalhe; ao mudar o whatsapp, o `whatsapp_e164` é recalculado
junto. As respostas do quiz continuam somente leitura de propósito — são a
declaração da pessoa, e é o que permite saber depois qual perfil converte.

## Foto do depoimento

O painel recorta antes de subir: canvas 320 de prévia com máscara circular,
arraste + zoom (slider e roda do mouse), e o que vai para o Storage é um
JPEG 480x480 já enquadrado (`cropBlob()` → `subirFoto(blob)`). O site exibe
a foto em círculo, então enquadrar no painel evita cabeça cortada e evita
guardar arquivo grande de celular. `subirFoto` recebe Blob, não File.

## Royalties x multinível (fato fornecido pelo Jimmy)

No multinível tradicional o plano limita até qual nível de profundidade se
recebe. Na iGreen a remuneração de estrutura é paga como **royalties sobre o
consumo dos clientes** e, enquanto houver royalties disponíveis, o licenciado
tem direito **independentemente do nível de profundidade** do cliente.

Isso está na FAQ como pergunta própria — não misture com a resposta sobre
pirâmide, que ganha força por responder uma coisa só (de onde vem o dinheiro).
E não escreva que é "melhor que multinível": o fato dito seco convence mais e
não convida à discussão. Percentuais e critérios nunca vão para o site.

## Exibição dos depoimentos

Duas chaves em `site_config`: `depo_modo` (`fixo` | `aleatorio`) e `depo_qtd`.
No modo fixo o site mostra todos os ativos na ordem da coluna `ordem`; no
aleatório sorteia `depo_qtd` entre os ativos a cada carregamento da página.
O painel ordena gravando a posição na lista (troca com o vizinho) e o botão
Ocultar alterna `ativo` — depoimento oculto continua cadastrado.

A home só busca os depoimentos **depois** de ler a config, senão o modo
chegaria tarde demais e o sorteio nunca aconteceria.

## Depoimento fixo

Coluna `fixo` em `depoimentos` (migração `db/04-depoimento-fixo.sql`). No modo
aleatório os fixos entram sempre, na ordem, e o sorteio preenche as vagas que
sobram até `depo_qtd`. Se os fixos já ocupam todas as vagas, não sobra sorteio
— é comportamento esperado, não bug.

## Depoimento em vídeo

Colunas `video_url` e `video_formato` em `depoimentos` (migração
`db/05-depoimento-video.sql`). Quando há vídeo, o card monta um `.vslot` e
chama o mesmo `montarVideo()` dos vídeos da página — miniatura automática,
9:16 quando vertical e player em tela cheia. O texto continua embaixo: vídeo
não substitui o depoimento escrito, porque nem todo visitante dá play.

## Meta Pixel

Chave `meta_pixel` em `site_config` (só números). Um pixel para o site todo —
duas audiências saem de dois eventos, não de dois pixels. Eventos padrão
disparados: `PageView` (toda visita), `Lead` (quiz_complete), `ViewContent`
(quiz_start) e `CompleteRegistration` (cadastro direto). Todo evento interno
continua indo como `trackCustom` também.

Sem ID configurado, nenhum script da Meta é carregado — o site não sai
chamando a Meta à toa. **A Política de Privacidade descreve esse tratamento
(item 8)**: se mudar o que é rastreado, ela muda junto, e a data de revisão
(`ATUALIZADO` no build.js) é atualizada à mão.

## Instagram no depoimento

Colunas `instagram` e `instagram_mostrar` (migração `db/06-depoimento-instagram.sql`).
O painel aceita `@usuario`, `usuario` ou a URL inteira; a home normaliza. O
ícone só aparece com o campo preenchido E a chave ligada — desligar guarda o
perfil sem exibir. O link sai com `rel="noopener nofollow"` e evento
`depoimento_instagram`, para dar para medir quanta gente sai por ali.

## Prova social no hero

Logo abaixo do H1 existe uma linha de prova (`.hero__prova`) seguida do selo
`.hero__vaga` ("Tem vaga"). Texto atual, informado pelo Jimmy:

> **6.900** pessoas no Brasil conectaram pelo menos uma conta de energia a um
> DESCONTO em julho de 2026 — e recebem ate 7% toda vez que essa conta e paga.
> Todos os meses. E energia e so uma das varias solucoes recorrentes que temos.

Regras:

- O **6.900** mede licenciados que cadastraram pelo menos um cliente novo em
  julho de 2026. O mes fica explicito no texto. Para atualizar, e preciso um
  numero novo com a mesma definicao e o mes correspondente, vindo do Jimmy.
  Nao estimar, nao extrapolar, nao arredondar para cima.
- **Ate 7%** e percentual de remuneracao informado pelo Jimmy. Se o plano da
  iGreen mudar, esta linha fica errada e precisa ser corrigida junto.
- Manter separados os dois papeis: o **desconto** e do cliente, a **comissao**
  e do licenciado. Nao escrever de forma que pareca que a mesma pessoa recebe
  os dois.

## Filtro de investimento no quiz

A penúltima pergunta do quiz (`investimento`) declara o custo da licença
— licença anual de R$ 1.997 ou 12x de R$ 197,41 no cartão — antes de pedir o
contato. Motivo: evitar que alguém chegue ao WhatsApp achando que é
emprego e só ali descubra que há investimento.

Opções e o que cada uma faz:

| Resposta | Desfecho |
|---|---|
| Consigo à vista | resultado "Sim, é para você" + CTAs de licença |
| Consigo parcelado no cartão | idem |
| Quero entender melhor antes de decidir | idem |
| Hoje não consigo investir | resultado alternativo: oferta GRATUITA de economia na conta de luz, porta aberta para voltar |

Regras:

- A pergunta fica **no fim**, nunca no começo. Antes de saber o preço a
  pessoa precisa entender o que estaria comprando.
- Quem responde "Hoje não consigo investir" **não** dispara o evento
  `Lead` da Meta — dispara `quiz_complete_sem_investimento`. Misturar os
  dois contamina o público de conversão e piora a otimização dos anúncios.
- O desfecho de quem não pode investir é uma **oferta real** (desconto na
  conta de luz, sem custo), não um agradecimento educado. E diz
  explicitamente que a licença continua disponível quando fizer sentido.
- Os valores da licença vêm do plano da iGreen. Se mudarem, mudam aqui,
  no CLAUDE.md e na pergunta do quiz.
- Migração: `db/07-investimento.sql` (coluna `investimento` + grants).

### Pergunta condicional "momento"

Quem responde "Hoje não consigo investir" recebe **uma pergunta a mais**:
o "não" é de agora ou é definitivo? É a única pergunta condicional do quiz
— `so_se` no objeto da pergunta e `fluxo()` (PERGUNTAS filtrado) é o que o
`passo` indexa. Qualquer pergunta condicional nova segue esse padrão; nunca
indexar PERGUNTAS direto.

Desfechos:

- **"É só agora"** → economia gratuita + convite para o canal/grupo de
  espera (chave `link_grupo` no site_config, editável no painel) + a frase
  de porta aberta.
- **"Não é para mim"** → só a economia gratuita, sem convite e sem insistir.

Recomendação registrada: usar **canal** do WhatsApp, não grupo. Em grupo
todos os leads veem o número uns dos outros — exposição dos dados deles e
porta aberta para concorrente. O campo aceita os dois; o texto do site fala
em canal.

Migração: `db/08-momento.sql` (coluna `momento` + grants).

## Contador de visitas

Tabela `visitas` (migração `db/09-visitas.sql`), aba **Visitas** do painel.
Uma linha por sessão do navegador, gravada pela home com a chave anon (só
INSERT, por coluna). Sem IP e sem user agent: `vid` é um código aleatório no
`localStorage` (`anp_vid`) que só separa visita de visitante. `referrer` guarda
apenas o domínio, e a navegação interna não conta como origem.

O painel não lê as linhas: chama a função `resumo_visitas()`, que devolve tudo
somado (hoje, 7 e 30 dias, série diária, origens, aparelhos, leads em 30 dias
para a taxa de conversão), com os dias no horário de Brasília. `security
invoker`, então a RLS vale — e a carga do painel não cresce com o volume.

Não contam: robôs (`navigator.webdriver` e user agent), e o navegador do
Jimmy. Entrar no `/admin` grava `anp_admin` no `localStorage` do mesmo domínio,
e abrir o site com `?naocontar=1` faz o mesmo (serve para o celular dele).

A Política de Privacidade (item 8) descreve essa contagem. Se mudar o que é
gravado, ela muda junto, e `ATUALIZADO` no build.js também.

**Por página** (migração `db/11-visitas-por-pagina.sql`, out/2026): a mesma
tabela recebe a home e a página de integradores. `visita_pagina(landing)`
classifica (`integradores` se o landing tem querovendercarregador ou
`/integradores`, senão `home`) e `resumo_visitas(pagina)` aceita `null`, `home`
ou `integradores` — o filtro vale para números, gráfico, origens, aparelhos e
conversão (leads de integrador contra os demais). O quadro `paginas` vem
sempre com as duas, para comparar. A versão sem parâmetro foi removida: com as
duas, a chamada sem argumento ficaria ambígua. O `anp_admin` é por domínio:
no querovendercarregador é preciso abrir `?naocontar=1` lá também.

---

# Estado atual e pendências (atualizado em 30/set/2026)

Esta seção é o ponto de retomada. Quem abrir o projeto numa sessão nova
— inclusive no Claude Code, na máquina do Jimmy — começa por aqui.

## Onde as coisas moram

| O quê | Onde |
|---|---|
| Código | GitHub `jimmyfenner/anovaprofissao` (privado), branch `main` |
| Deploy | Vercel, automático a cada push em `main` (`node build.js` → `dist/`) |
| DNS | Cloudflare, CNAME para a Vercel |
| Banco / auth / storage | Supabase (projeto `buapklmgdjcoyzrmhhcd`) |
| Notificações | Supabase Edge Function `whatsapp` → Evolution API + Forward Email (Resend de reserva) |
| Painel de leads | `anovaprofissao.com.br/admin` (login Supabase do Jimmy) |
| Pixel da Meta | ID `1752542589367351`, chave `meta_pixel` no `site_config` |
| API de Conversões da Meta | Supabase Edge Function `conversao-meta`, só lead de integrador |
| Disparo de mensagens | Supabase Edge Function `disparos` + `pg_cron` (fila em `disparo_envios`) |

## Segredos — o que nunca circula

- `service_role` do Supabase, API key da Evolution, API key do Resend e
  `META_CAPI_TOKEN` vivem **só** nos Secrets do Supabase. Nunca no repositório,
  nunca no chat, nem para o Jimmy. O token da Meta é ele quem gera, no
  Gerenciador de Eventos, e cola direto nos Secrets.
- A `anon key` do Supabase é pública por projeto — está no código do site
  de propósito e isso é seguro; quem protege os dados é a RLS + os grants
  por coluna.
- O PAT do GitHub usado nesta máquina está em `~/.git-credentials`. Numa
  máquina nova é preciso autenticar de novo (`gh auth login` ou PAT novo).
  Convém rotacionar o antigo.

## Migrações SQL pendentes (o Jimmy cola no SQL Editor)

Nenhuma. 20 (licenciados cadastrados pelo /admin) aplicada em 04/nov/2026 com o "sim"
do Jimmy: o modo automático barrou o `db query`, então o Jimmy rodou um script com a
migração, o upload da foto do Mario (`supabase storage cp ... ss:///licenciados/<arquivo>
--content-type image/jpeg --experimental`) e o `update` da coluna `foto`. Junto: deploy
hook `admin-licenciados` (id d6Q0rBCrRU, branch main) criado com `vercel deploy-hooks
create` e gravado como secret `VERCEL_DEPLOY_HOOK` sem passar pela tela, e a função
`painel` republicada (lic_* sem login dão 403). Conferido: `licenciados_publicos()`
devolve o Mario sem e-mail, a foto é pública, a tabela segue fechada para anon, e as 4
páginas do Mario geradas do banco são idênticas às do ar (fora o nome da foto e a versão).
19 (painel dos licenciados) aplicada em 04/nov/2026 com o "pode aplicar" do
Jimmy, com as funções `painel` (nova) e `whatsapp` publicadas pela CLI. Conferido no ar:
token falso dá 401, config sem login dá 403, número sem acesso não gera código, e o
código pedido para 5548991067007 saiu pela instância 1575 (`envio_ok`).
18 (disparo de mensagens) aplicada em 03/nov/2026 com o "pode aplicar" do
Jimmy: `pg_cron` instalado, fila criada e job `disparos-processar` rodando a cada
minuto (conferido: a função responde 200). Função `disparos` publicada com
`supabase functions deploy disparos --remote=buapklmgdjcoyzrmhhcd --use-api --no-verify-jwt --yes`
(a única daqui com `verify_jwt` desligado, ver "Disparo de mensagens pelo painel").
Teste real no mesmo dia: um disparo de 1 mensagem para o número do Jimmy, montado
direto no banco, saiu pela instância dos avisos em 2,4 s com "boa noite, Jimmy". A
CLI nova pede `--remote=<ref>` e `--yes` para gravar em produção.

17 (agendamento) aplicada em 03/nov/2026, com os secrets `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (os mesmos do querocarregador) e
`FORWARDEMAIL_API_TOKEN` gravados pelo Jimmy (o Claude é barrado de copiar
credencial entre projetos) e as funções `agenda` (nova) e `whatsapp` publicadas
pela CLI. Teste real no mesmo dia: reunião marcada pela página, evento com Meet,
WhatsApp e e-mail (Forward Email, no-reply@anovaprofissao.com.br) chegaram, e o
evento e o lead de teste foram apagados. 16 (API de Conversões da Meta) aplicada em 30/out/2026, com a Edge Function
`conversao-meta` publicada na versão 1. 14 (vídeo assistido) e 15 (resultados)
aplicadas e testadas em 30/out/2026, com a Edge Function `whatsapp` publicada na versão 14. A CLI do Supabase desta máquina
alcança o projeto: `supabase db query --linked --project-ref buapklmgdjcoyzrmhhcd -f arquivo`
e `supabase functions deploy whatsapp --project-ref buapklmgdjcoyzrmhhcd --use-api`
(sem Docker; manter `verify_jwt`). Instale a CLI uma vez numa pasta: `npx --yes` a cada
chamada reinstala tudo e chamadas simultâneas falham com "Lock compromised". O modo
automático do Claude só aplica em produção com autorização do Jimmy.

13 (espelhos de licenciados) aplicada e testada em 23/out/2026.
12 (terceira página no contador, transição energética) aplicada e
testada em 19/out/2026. 10 (tipo integrador) e 11 (visitas por página) aplicadas em
17/out/2026, junto com o deploy da Edge Function com `corpoInteg`, e testadas.
07 e 08 foram aplicadas em 30/set/2026 (e a Edge Function
`whatsapp` publicada no mesmo dia já com `investimento` e `momento`); 09
(visitas) em 02/out/2026, testada de ponta a ponta: o site grava (201), anon
é barrado na tabela e no resumo (401), e a visita de teste foi apagada.

Verificar antes de qualquer coisa:
`select column_name from information_schema.columns where table_name='leads';`

## Outras pendências

- **Cadastro em etapas nos integradores** (nome e WhatsApp primeiro, rascunho, aviso
  único depois de 10 min parado, selo "Incompleto", como no igreencel): pedido e adiado
  em 30/out/2026 por falta de dado. As etapas só começaram a contar nesse dia, com
  `eventos_funil` em 0 linhas, ~17 visitas/dia e 8 leads no total. Reabrir com o
  "Onde as pessoas param" do painel, quando houver pelo menos 30 `form_inicio`: só vale
  mudar o formulário se muita gente começa e não envia.
- **Anúncios da Meta parados desde 14/10/2026** (as visitas caíram de
  ~350/dia para ~3). E de 11 a 13/10 vieram ~1.000 visitas de anúncio e
  nenhum lead — o quiz e a gravação foram testados e funcionam, então a
  conversa é público/oferta, não técnica.
- **Depoimentos reais** ainda não subiram — a seção segue vazia por regra.
- **Proteção anti-spam** no endpoint público de escrita: adiada de
  propósito pelo Jimmy.
- **`/blog`** em Markdown para o cluster de SEO: não começado.
- **Públicos da Meta** criados na conta `1403817359857284`: "Visitantes do
  site" e "Lead - completou o quiz", ambos 180 dias. Uso correto:
  incluir Visitantes e **excluir** Lead no conjunto de anúncios. Ainda sem
  volume — só faz sentido depois de rodar tráfego frio por algumas semanas.
- **Posse da conta de anúncios**: a `1403817359857284` ainda é "propriedade
  individual"; a transferência para a Fennergy esbarrou no limite de contas.

## Armadilhas já pagas (não repetir)

- **Clone do repositório**: manter fora de pastas sincronizadas/montadas.
  Dentro de mount o git falha em lock/unlink.
- **DELETE bloqueado por RLS volta 204**, não erro. Sempre usar `.select()`
  para confirmar que apagou de verdade.
- **Database Webhooks não existem neste projeto** (sem schema
  `supabase_functions`). A notificação sai por trigger com `pg_net`.
- **Secrets da Edge Function só valem no próximo deploy.** Mudou secret ou
  código, faz deploy — senão a versão antiga continua rodando.
- **O navegador do Jimmy bloqueia `fbevents.js`.** Testar pixel ali dá
  falso negativo; usar outro navegador/dispositivo.
- **"Recebido pela última vez" no Gerenciador de Eventos ignora o filtro de
  data.** Já gerou diagnóstico errado uma vez.
- **SQL Editor do Supabase pede confirmação** ("Potential issue detected")
  para qualquer `drop`, `revoke` ou `delete`, mesmo `drop policy if exists`
  numa tabela nova. É aviso genérico, não erro: ler o SQL e confirmar.
- **Colar código no editor do Supabase**: `pbcopy` sem `LANG=en_US.UTF-8`
  grava o texto como Mac Roman e os acentos viram "√ß√£o". Isso quebra
  comparações como `"Hoje não consigo investir"` sem dar erro nenhum.
  Antes de clicar em "Deploy updates", conferir se não há "√" no código.
  O botão fica embaixo do editor e só aparece depois que o código muda.
- **Montagem das mensagens de aviso**: linha opcional ausente é `null`,
  linha em branco é `""`. Filtrar com `Boolean` apaga as duas — foi assim
  que os avisos perderam o espaçamento sem ninguém notar.
- **Perguntas condicionais no quiz**: indexar sempre `fluxo()`, nunca
  `PERGUNTAS` direto.

## As três portas de contato (e qual grava lead)

| Caminho | Grava em `leads`? | Mensagem que chega no WhatsApp |
|---|---|---|
| Quiz completo | sim | com nome, objetivo, tempo, experiência, investimento, momento |
| Cadastro direto | sim | com nome, e-mail e WhatsApp |
| Botão flutuante `#float-wa` | **não** | genérica + rastro de origem |

O botão flutuante é um link `wa.me` puro: não passa por formulário e por
isso **nunca** aparece no painel. Isso é esperado, não é bug — já gerou
confusão uma vez. Como compensação, `msgFlutuante()` acrescenta ao texto
uma linha `— vim de: <utm ou referrer> · <página> · <device>`, lida de
`origem` (sessionStorage `anp_origem`). Assim a conversa não chega anônima.

Se algum dia o botão precisar virar lead de verdade, aí sim entra
formulário antes — e aí ele deixa de ser o atalho de baixo atrito que é
hoje. Decisão consciente: mantido sem formulário.

## Quem chama o lead (31/out/2026)

Copiado do igreencel, onde o aviso "a Débora vai te chamar deste número"
melhorou muito a taxa de resposta. Depois do cadastro, a página diz **quem**
vai chamar e **de que número**, e manda desconsiderar qualquer outro contato.

- `home.html`: `QUEM_CHAMA` na configuração editável ({nome, curto, papel,
  numeros}); `avisoQuemChama()` monta o bloco `.quem` e entra nos dois
  resultados do quiz (apto e sem investimento), depois dos botões. Jimmy:
  (48) 99106-7007 principal e (47) 98809-2413 como "também pode vir". Nos
  espelhos (`ANP_LIC`, que agora leva `nome_completo`) o bloco nomeia o
  licenciado e só o número dele; os números do Jimmy ficam na linha
  `var QUEM_CHAMA_NUMEROS = [...]`, que o build esvazia no espelho (senão a
  trava `conferirEspelho` para o build). É fixo de propósito: **não** segue o
  `whatsapp_destino` do painel, porque esse campo diz quem recebe o lead, não
  quem chama.
- `integradores.html`: bloco estático `#ok-quem` dentro de `#form-ok`, mesmo
  texto e números do Jimmy. `hidden` quando o lead **não** foi gravado
  (`ok` falso): sem gravação não há quem chamar, e o título já pede para a
  pessoa chamar.
- Mesmo padrão no querocarregador (`src/components/QuemChama.tsx`), com o
  (47) 98809-2413 como principal lá.

## Painel de resultados (30/out/2026)

Pedido do Jimmy, tomando o painel do igreencel.com.br como régua. No topo da
tela de leads do `/admin`, valendo para home, integradores, transição e espelhos:

- **Período** (Hoje, 7, 30, Tudo; padrão 30) e **página**. Valem para números e
  lista; a busca procura em todas as datas.
- **Fila:** "N leads esperando contato · o mais antigo há X", de qualquer data;
  o botão filtra status novo, mais antigos primeiro.
- **Seis números:** visitantes, leads, visita → lead, chamados, ganhos e mediana
  do 1º contato. Os de leads são somados na tela, para mudarem com o status.
- **Onde as pessoas param:** etapas por página (`ETAPAS`, `A_PARTE` em admin.html),
  com o selo "maior queda" (a partir de 5 pessoas na etapa anterior).
- **Por anúncio:** visitas e leads pela chave fonte + campanha + conjunto + anúncio.
- **Chamar** em cada lead: mensagem pronta (`linkChamar`) e, se o status é novo,
  passa para contatado e grava `contatado_em`. Sem isso o número de chamados não
  reflete o trabalho: em 30/out os 16 leads estavam todos como novo.
- Atualiza sozinho a cada minuto, menos com anotação em edição.

Banco: `db/15-resultados.sql` (`visitas.utm_term/utm_content`, tabela
`eventos_funil`, função `resumo_resultados`). Os sites marcam etapas por
`marcarFunil`, uma por sessão, só dos eventos em `ETAPAS_FUNIL`; o nome do evento
é a mesma coisa que o `track` usa. Sem a migração: a visita grava sem os campos
novos e o painel usa `resumo_visitas`, sem etapas nem anúncios. Aplicada em 30/out/2026:
os anúncios e as etapas só existem daí em diante.

Comparar com cuidado: chip grátis e licença de R$ 1.997 não convertem igual.
Linha de base de 30/out/2026: igreencel 260 visitas e 49 leads (18,8%);
integradores 251 e 8 (3,2%); home ~3.900 e 6 (0,15%, quase tudo anúncio frio).

## Apresentação completa na home (30/out/2026)

Pedido do Jimmy: a apresentação completa (Vimeo 1232661752, "Outubro de 2026",
38 min, 16:9) entrou na seção `#apresentacao` da home, ao lado do resumo de 5 min
que já estava lá (`video_apresentacao`, vertical). Chaves novas no `site_config`:
`video_completo` e `video_completo_formato`, editáveis na aba Conteúdo do painel
(campo "Vídeo da apresentação completa"). Se ele gravar uma versão nova por mês,
é só trocar o link no painel.

- **Duração automática:** `capaDoVimeo` passou a devolver também `duration` do
  oEmbed; `montarVideo` põe o selo `.vslot__dur` ("38 min") no cartão e preenche
  qualquer `[data-dur-for="<id do slot>"]` da página (as legendas da seção). Nada
  de duração escrita à mão no HTML: trocou o vídeo, troca o número. YouTube não
  informa duração pelo oEmbed, então o vídeo da pirâmide fica sem selo.
- **Mês da gravação:** a legenda da completa mostra "outubro de 2026 · 38 min",
  com o mês vindo de `upload_date` do oEmbed (`[data-mes-for]`, `mesLegivel`).
  Motivo: o vídeo é amarrado ao mês (campanhas de Conexão Green, Telecom e
  Seguros, "dia 20 de outubro", recuperar a licença em 10 dias) e traz simulações
  e promessas de ganho ("50 a 100 mil por mês", "mais de R$ 300 mil por mês").
  É conteúdo dele, falado em vídeo; **nenhum desses números vai para o texto do
  site**, e a legenda avisa que as condições vigentes são confirmadas na
  conversa. Transcrição com tempos feita em 30/10/2026 (mlx-whisper), roteiro
  na memória do Claude; o vídeo diz "R$ 1.997 por um ano" aos 27:57, igual ao FAQ.
- **Layout:** `.apres-grid` com a completa (16:9) à esquerda e o resumo (9:16) em
  24% à direita, alturas quase iguais a partir de 860px; empilhados no celular.
  `.apres-grid .vslot{width:100%}` é obrigatório: numa coluna flex, o
  `margin-inline:auto` do vertical encolhia o cartão a 2px.
- **Player:** o `embutir` passou a mandar `dnt=1` ao Vimeo (como integradores) e a
  só tratar como código de vídeo não listado o `vimeo.com/ID/CODIGO` ou `?h=`;
  antes, `?share=copy` do link copiado virava `h=share`. O CTA de cadastro dentro
  do player (`cta_video_*`) vale para o resumo e para a completa.
- **Menu:** ganhou "Apresentação" entre "Quem acompanha" e "Perguntas" (cabe a
  partir de 940px, onde os links aparecem).
- Política de Privacidade, item 8: parágrafo "Vídeos da página principal" (Vimeo com
  dnt, YouTube sem cookies, consulta pública de capa/duração ao abrir a página).
- Corrigido de passagem: o quiz dizia "Seis perguntas rápidas" e tem sete (oito
  para quem responde que não consegue investir).

## Como retomar no Claude Code

```
git clone https://github.com/jimmyfenner/anovaprofissao.git
cd anovaprofissao && npm i -g @anthropic-ai/claude-code   # se ainda não tiver
claude
```

O `CLAUDE.md` é lido automaticamente. Primeira mensagem útil: pedir para
ler este arquivo inteiro e listar as pendências acima antes de propor
qualquer coisa.

## Mobilidade elétrica no ecossistema

Recarga de veículos elétricos e venda de eletropostos entram como o
**primeiro card do ecossistema**, em destaque visual (`.prod--destaque`,
selo `.prod__novo`). Decisão do Jimmy em out/2026: é a frente que ele já
vende na prática (carregadores DC comerciais) e a que mais diferencia o
site dos concorrentes.

Como o texto trata o assunto:

- São **duas frentes distintas** e o texto não as mistura: a *venda do
  eletroposto* (equipamento, ticket maior, projeto dimensionado) e a
  *recarga* que a estação vende depois de instalada.
- O argumento central é que é a única frente em que o licenciado entra na
  empresa falando de um **ativo que ela vai operar**, não de uma conta que
  ela já paga.
- O texto **não afirma** percentuais, prazos, potências, modelos nem como
  a remuneração do licenciado é calculada nessa frente — nada disso foi
  informado. A ressalva padrão ("variam conforme o projeto, a análise
  técnica do local e as condições vigentes") fecha o card e o FAQ.
- O FAQ assume abertamente que essa frente exige mais estudo técnico. É
  honesto e funciona como filtro — e vira vantagem no argumento seguinte
  ("quase nenhum concorrente sabe ter essa conversa hoje").

Aparece também: lede do hero, opção do quiz (`solucao`), listas de
"Pequena empresa" e "Empresa de maior consumo", faixa de soluções e o FAQ
"O que faz um licenciado iGreen?".

## Página de integradores — querovendercarregador.com.br (out/2026)

Fonte `integradores.html` (mesmo formato da home: só o corpo, `<title>` e
fontes no topo). O `build.js` publica em `dist/integradores/` e o
`vercel.json` reescreve `/` para `/integradores` quando o host é
`querovendercarregador.com.br` (com ou sem www). Para isso funcionar a home
**não** pode existir como `dist/index.html`: na Vercel o arquivo tem
precedência sobre os rewrites, e o domínio novo mostrava a home (aconteceu
em 16/10/2026). O build gera a home em `dist/home/`, e o `vercel.json` faz
`/` virar `/integradores` nesse host e `/home` nos demais; `/home` acessado
direto redireciona para `/`. O DNS do domínio está na Cloudflare (A para
216.198.79.1 e CNAME `www`, ambos sem proxy), verificado na Vercel por TXT
`_vercel`, porque o domínio já tinha sido ligado a outra conta Vercel. O canônico é esse domínio,
porque é o que vai nos anúncios do Google; `anovaprofissao.com.br/integradores`
continua funcionando como espelho.

Público: integradores solares, instaladores, eletricistas. Assunto: a
**Conexão Mob** (eletropostos, lançamento oficial 20/10/2026, 20h) como
produto novo para a carteira de quem já trabalha com energia. O selo do hero
troca sozinho de "Lançamento oficial" para "lançada em 20/10/2026" depois da
data (`LANCAMENTO` no script).

Regras de conteúdo (as mesmas da home, mais estas):

- Modelos e capacidades (Mob 7 kW / Mob Fast 7+40 kW / Mob Ultra Fast 80 kW; até
  5 / 30 / 43 carros por dia) vêm do material de lançamento e do simulador
  oficial. Os nomes são os do site oficial igreenmob.com.br, decididos pelo
  Jimmy em 19/10/2026 para todos os sites (aqui, transição e QueroCarregador);
  "Lento / DUO / Ultra rápido" do simulador não se usa mais.
  **Preço de cada modelo e percentuais de comissão não vão para a
  página** — ainda "a confirmar" e, no caso da Licença Mob, vender
  participação em SCP com projeção de retorno chama atenção da CVM.
- Nenhuma marca de carregador (nem a que o Jimmy representa) e nenhum
  concorrente.
- O vídeo embutido, desde 22/10/2026, é "Como ganhar com eletroposto sem ter
  carregador" (Vimeo 1238447338, 9:35), com capa e player que só carrega no
  clique (`dnt=1`). Se trocar o vídeo, ajustar também o título da seção e a
  duração na legenda. O antigo (YouTube `tgoz7p85QIY`, 15:47) citava médias
  de ganho por nível e saiu da página.

Termos com cara de serviço financeiro ficam fora desta página (crédito, juros,
investimento, B3/código de ação, relações com investidores, "como ganhar",
"carteira recorrente"): em out/2026 o Google Ads limitou um anúncio por
"Verificação de serviços financeiros", e ele lê texto e destino.

Três momentos (19/10/2026, pedido do Jimmy): a página fala com quem quer
**somar** um produto ao que já vende, com quem viu **as vendas caírem** e com
quem pensa em **mudar de ramo** — nunca "quebrado" ou "desesperado". O bloco
"Em que momento você está?" (`#momento`) leva cada um à sua parte (`#papel`,
`#orcamentos`, `#transicao`) e marca a resposta no formulário. A dor vai com
fatos (Fio B da Lei 14.300, inversão de fluxo, kit a preço de custo), sem
política: nada de governo ou partido, nem em anúncio. A pergunta do formulário
grava na coluna `momento` (já existia, migração 08); o painel mostra, a
mensagem pronta do WhatsApp leva, e o aviso `corpoInteg` mostra a linha.

Corte do Carlos Evangelista (fundador da ABGD, sócio da Vértice) liberado
pelo Jimmy para esta página em 19/10/2026: seção `#carlos`, logo depois da
dor, com o mesmo arquivo da transição (`/media/transicao/te-34-fundador-abgd.mp4`)
e a nota de correção das datas (ele diz "15 de novembro").

Apresentação assistida (28/10/2026, pedido do Jimmy): a página mede quantos
segundos da apresentação do Vimeo a pessoa realmente tocou (pulos não contam;
`player.js` do Vimeo carregado só no clique) e grava a porcentagem em
`leads.video_pct` junto com o formulário (migração `db/14-video-assistido.sql`).
90% ou mais = "assistiu completo": selo "Viu o vídeo" na lista do painel, linha
"Apresentação" no detalhe e no aviso `corpoInteg`. Os segundos vistos ficam no localStorage (`qvc_video_<id>`),
então quem assistiu num dia e preenche no outro continua contando no mesmo
navegador. Sem a API (bloqueador), `video_pct` vai null, nunca 0. Marcos
25/50/75/90 viram eventos `video_NN` do Pixel. Se trocar o vídeo, atualizar
`data-vimeo`, `data-duracao` e a capa. Política de Privacidade: itens 2 e 8.

Sem botão flutuante de WhatsApp (30/10/2026, pedido do Jimmy): nesta página todo
contato passa pelo formulário, e o WhatsApp só abre na tela final. A home mantém o dela.

Leads: mesma tabela `leads`, `tipo = 'integrador'` (migração
`db/10-integradores.sql`). Mapeamento das respostas: `experiencia` = o que
faz hoje, `perfil` = quantos clientes já atendeu, `objetivo` = interesse,
`solucao` = "Eletroposto (Conexão Mob) — página de integradores". Se a
migração ainda não rodou, o banco recusa o tipo e a página grava de novo sem
ele; o painel e o aviso reconhecem esses leads pelo texto de `solucao`.
O painel mostra o selo "Integrador" e tem o filtro "Todos os tipos" (quiz,
cadastro direto, integradores) ao lado do de status; a Edge Function `whatsapp` tem o aviso
próprio (`corpoInteg`), publicado em 17/10/2026.

A página só grava no banco a partir dos domínios reais (querovendercarregador,
anovaprofissao, *.vercel.app). Em prévia local ou Artifact o formulário
funciona inteiro, mas não cria lead. Conversão do Google Ads (conta
210-448-8503, "Minerando o Sol"): ação **"Lead integrador
(querovendercarregador)"**, categoria Enviar formulário de lead, primária,
contagem "Uma", criada em 18/10/2026. Tag `AW-10947392047`, rótulo
`mVgkCO79kKEdEK_kj-Qo` (com a letra O). Ficam em `GADS_ID`/`GADS_LABEL` no
script; a tag só carrega nos domínios reais e a conversão só dispara depois que
o banco confirma a gravação do lead. A Política de Privacidade (item 8) descreve
a tag; `ATUALIZADO` foi para 18/10/2026.

## API de Conversões da Meta — lead de integrador (30/out/2026)

Pedido do Jimmy, tomando o igreencel.com.br como régua: o lead chega à Meta mesmo
quando o navegador bloqueia o pixel. Vale só para `tipo = 'integrador'`; quiz e
cadastro direto da home continuam só no pixel.

- **Sem contar em dobro:** a página gera o id do lead (`novoId`) e manda o mesmo id
  ao banco e ao pixel (`eventID`). A função usa esse id como `event_id`.
- **Caminho:** gatilho `envia_conversao_meta` em `leads` (`db/16-conversao-meta.sql`)
  → `net.http_post` → função `conversao-meta`, como no aviso de lead. Se o lead foi
  gravado, a conversão sai; se o envio falha, o lead fica. A página não chama a função
  e o gatilho captura qualquer erro.
- **Dados enviados:** WhatsApp, e-mail, nome, cidade e estado em SHA-256; `fbp` e `fbc`
  como vêm (`leads.meta_fbp`, `meta_fbc`; sem cookie `_fbc`, a página monta o valor com
  o `fbclid` guardado em `qvc_fbc`); IP e navegador lidos dos cabeçalhos da gravação
  (`cf-connecting-ip`, conferido em produção com o IP real), sem ficar em coluna nenhuma.
- **Pixel:** a função lê `meta_pixel` do `site_config`, então trocar no painel troca os
  dois. O token só envia eventos: ler o pixel com ele dá "Missing Permission", é normal.
- **Registro:** toda tentativa vira linha em `notificacoes_log`, canal `meta`, e aparece
  na aba Notificações (o detalhe, só quando falha). `leads.meta_conversao_enviada`:
  vazio = não tentou, `false` = falhou, `true` = enviado. Só a função escreve nessa
  coluna, e ela não reenvia lead já `true`.
- **Quem pode chamar:** a verificação de JWT da plataforma também aceita a chave anon,
  que é pública. Por isso a função compara o `Authorization` com a `service_key` de
  `private_config`. Essa chave é `sb_secret`, não um JWT: conferir o papel nela barrava
  o próprio gatilho, o que só apareceu no primeiro teste real. Chamadas sem chave e com a
  chave anon voltam 401 (conferido em produção). Esse 401 vem antes do registro e não
  vira linha no log: lead de integrador com `meta_conversao_enviada` vazio é chamada que
  não chegou a rodar.
- **Reenviar um lead que falhou** (sem IP e navegador, que não ficam guardados):
  `select net.http_post(url := 'https://buapklmgdjcoyzrmhhcd.supabase.co/functions/v1/conversao-meta', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select valor from private_config where chave='service_key')), body := jsonb_build_object('lead_id','<id>'));`
- **Testar sem sujar:** o mesmo comando com `body` `{"action":"teste","test_event_code":"<código>"}`,
  usando o código da aba **Testar eventos** com ela aberta. Código de sessão fechada é
  processado como conversão real. Lead fictício, sem linha em `leads`. Em 30/out/2026 a
  Meta respondeu 200 com o token atual, o Jimmy viu o evento na aba e o log ficou com `ok`; o caminho com lead real
  (gatilho → função → Meta) só se confirma no primeiro lead depois dessa data.
- **Testar a gravação:** `begin; set local role anon; insert ...; rollback`. O rollback
  também desfaz a chamada do `pg_net`, então não sai aviso nem conversão. Formulário no
  ar: abrir com `?naocontar=1` e substituir `fetch`, `fbq` e `gtag` antes de enviar, ou
  sai conversão falsa no Google Ads e na Meta.
- Se o banco recusar as colunas novas, a página grava de novo sem `id`, `meta_fbp` e
  `meta_fbc`. A Política de Privacidade descreve o envio nos itens 2, 5 e 8.

## Página "Transição energética" — transicaoenergetica.com.br (out/2026)

Fonte `transicao-energetica.html`, publicada em `dist/transicao-energetica/` e,
pelo rewrite por host do `vercel.json`, na raiz de `transicaoenergetica.com.br`
(canônico; o nome do domínio é o ativo). `anovaprofissao.com.br/transicao-energetica`
é espelho e `/transicaoenergetica` redireciona para ele. Domínio na Vercel desde
19/10/2026 (verificado sem TXT). DNS na Cloudflare, como o querovendercarregador
(A `@` → 216.198.79.1 e CNAME `www` → cname.vercel-dns.com, ambos sem proxy); a
troca de servidores no Registro.br foi publicada no .br em 19/10/2026 às 17:31.

Conteúdo: a transição em números, os quatro movimentos (fonte, quem gera, quem
escolhe, o que consome), o cronograma da abertura do mercado, as perguntas do
consumidor, a **órbita das 5 frentes** (Conexão Green, Conexão Livre, Conexão
Placas, Licença Mob = ter um eletroposto, Conexão Mob = vender eletropostos e
conectar motoristas) e 3 cortes do **Carlos Evangelista** (fundador e
ex-presidente da ABGD, licenciado iGreen, sócio da Vértice), usados com
autorização. Não tem formulário: os botões levam à avaliação da home com
`utm_source=transicaoenergetica`, e é por essa origem que o lead é atribuído à
página no painel (`lead_pagina()`, migração `db/12-visitas-transicao.sql`).

Regras específicas:

- **Licença Mob sem retorno**: a página fala só da existência da solução.
  Nenhuma estimativa de faturamento, payback ou rentabilidade (CVM: é
  participação em SCP). Decisão do Jimmy em 19/10/2026.
- **Números só em `dados/transicao.json`**, nunca no HTML. O build troca os
  marcadores `{{id.campo}}` e monta a lista de fontes do rodapé; marcador sem
  dado **trava o build**. Só fonte primária oficial (EPE, ANEEL, MME, CCEE,
  Planalto, ABSOLAR, ABVE), arredondando só para baixo. Fonte que é empresa
  concorrente (ex.: rede de recarga) não aparece nem como crédito.
- **Revisão quinzenal automática** (tarefa agendada `revisar-dados-transicao`,
  dias 1 e 16, 9h): pesquisa as fontes, atualiza o JSON quando houver dado
  oficial mais novo, roda o build, publica e avisa o Jimmy.
- **Datas oficiais da abertura**: 25/11/2027 (industriais e comerciais) e
  25/11/2028 (demais consumidores), Decreto nº 13.097/2026, com base na Lei
  nº 15.269/2025 (conversão da MP 1.304, não da 1.300). No corte 34 o Carlos
  diz "15 de novembro": a página tem uma nota de correção embaixo do vídeo.
  O corte 42 ("nunca vi setor crescer") ficou de fora por dizer "pessoas que
  estão mudando a sua vida".
- Vídeos em `media/transicao/` (720p, ~10 MB cada, capa .jpg), copiados para
  `dist/media/` pelo build e tocados com `<video>` só no toque.

## SEO e Google (out/2026)

- **Search Console**: propriedades de domínio para os três domínios na conta
  do Jimmy (up.novos.cadastros@gmail.com), criadas em 19/10/2026. Verificação
  por TXT `google-site-verification=...` na Cloudflare de cada domínio (não
  apagar esses TXT: sem eles a verificação cai). Verificadas, sitemaps
  enviados e processados (4, 1 e 1 páginas) e indexação das três páginas
  principais solicitada em 19/10/2026. Nesse dia a home e o querovender já
  constavam como indexados; a transição ainda não.
- **robots.txt e sitemap.xml por domínio**: o build gera
  `dist/seo/<dominio>/robots.txt|sitemap.xml` e o `vercel.json` entrega por
  host (na raiz do dist eles ganhariam dos rewrites). `lastmod` = data do
  último commit da página (`git log -1 --format=%cs`), não a do build.
- **Imagem de compartilhamento** por página em `media/og/` (1200x630): fundo
  gerado no Higgsfield (Nano Banana 2, 2k, 2 créditos cada, sem texto, sem
  marca) e título composto por cima com HTML + Chrome headless. O build passa
  `og`/`ogAlt` por página; legal e admin usam a da home.
- **Fontes próprias** em `fonts/` (woff2, só latino; Archivo e Instrument Sans
  variáveis). O build tira o `<link>` do Google Fonts de todas as páginas e
  injeta preload + `@font-face`. Antes, a fonte travava a primeira pintura em
  ~2 s no celular (LCP 4,2 s na home e 6,0 s em integradores). Cache longo em
  `/fonts/*` pelo `vercel.json`.
- **Endereço principal**: `anovaprofissao.com.br` sem www (é o que o canônico,
  o sitemap e as imagens usam). O www redireciona para ele desde 19/10/2026
  (antes era o contrário e contradizia o canônico). Trocado pelo Jimmy no
  painel da Vercel. Conferir que o redirecionamento do www é **308
  (permanente)**, não 307.
- O FAQPage schema continua, mas o Google só mostra FAQ expandido para sites de
  governo e saúde desde 2023: serve para entender a página, não para destaque.

## Espelhos para licenciados — anovaprofissao.com.br/<slug> (out/2026)

Pedido do Jimmy em 23/10/2026: licenciados podem usar o site com os próprios
contatos. Primeiro espelho: **/mariogomes** (Mario Henrique Gomes da Silva,
Santos/SP, licenciado desde dez/2025, qualificação Sênior, ID iGreen 114882).

- **Ficha**: desde 04/11/2026 fica na tabela `licenciados` do Supabase e a
  foto no bucket público `licenciados` (ver "Cadastro de licenciados pelo
  /admin" abaixo). `dados/licenciados.json` e `media/licenciados/` saíram do
  repositório. O e-mail fica só no banco (recebe os avisos), nunca no site.
- **Build**: gera `dist/<slug>/` a partir da home, trocando os blocos
  marcados `<!--lic:ctx|pessoa|redes|dono|cidade-->` e alguns trechos exatos
  ("Jimmy, isso é pirâmide?", "Falar com Jimmy"), troca a configuração do
  script e injeta `window.ANP_LIC`. Gera também as três páginas jurídicas do
  licenciado em `/<slug>/privacidade|termos|aviso-legal` (responsável pelos
  dados = o licenciado; Jimmy aparece como operador técnico; contato público
  = WhatsApp; foro = cidade dele). O build **para** se sobrar no espelho nome
  visível, WhatsApp, ID de cadastro ou rede social do Jimmy. Ao editar a home,
  qualquer bloco novo que fale do Jimmy precisa de marcador, senão o build
  trava (é a intenção).
- **Na home**, `LIC = window.ANP_LIC`: com ele, nada do painel (`site_config`)
  sobrepõe WhatsApp, link de cadastro, canal ou Pixel; o Pixel do Jimmy não
  carrega (usa o do licenciado, se houver); depoimentos não aparecem; o lead
  sai com `licenciado = <slug>`. Vídeos: os mesmos da home (decisão padrão,
  o Jimmy não se opôs).
- **noindex** em todos os espelhos: são quase iguais à home e não podem
  disputar a busca com ela. Slugs reservados no build (`RESERVADOS`).
- **Banco** (`db/13-licenciados.sql`, aplicada e testada em 23/10/2026):
  `leads.licenciado` com chave estrangeira para `licenciados(slug)` (slug
  inventado é recusado), `licenciados` só legível com login,
  `visita_pagina` e `lead_pagina` classificam como `licenciados`.
- **Aviso**: a Edge Function `whatsapp` manda o lead do espelho para o
  WhatsApp/e-mail do licenciado (linha "Via a sua pagina ..."), não para os
  destinatários do Jimmy. Licenciado inativo ou sem cadastro: cai para o Jimmy.
  O WhatsApp sai pela instância conectada do Jimmy.
- **Painel**: selo "Via <nome>", filtro "Espelhos de licenciados" em tipos,
  opção na aba Visitas e linha "Espelho" no detalhe do lead.

## Publicador do YouTube — anovaprofissao.com.br/publicador (out/2026)

Três páginas públicas exigidas pelo Google para o app OAuth "Publicador Jimmy
Fenner" (projeto Google Cloud `publicador-youtube-jimmy`, script
`studio/tools/publicar_youtube_api.py`) e conferidas na auditoria da API do
YouTube: `/publicador` (página inicial do app), `/publicador/privacidade` e
`/publicador/termos`. Fontes só com o miolo em `publicador/`, no shell das
páginas jurídicas (`paginaPublicador` no build.js), em português e inglês,
`noindex` (não têm nada a ver com o recrutamento). Data de revisão própria:
`ATUALIZADO_PUBLICADOR`. `publicador` está nos slugs reservados.

A política descreve o tratamento real do script: lê nome e estatísticas do
canal (`channels.list`), envia vídeos (`videos.insert`) e muda status/horário
(`videos.update`); token e registro das publicações só no Mac do Jimmy. Se o
script passar a usar outra chamada da API ou guardar dados de outro jeito, a
política muda junto, antes, e a data também. Nada de script, pixel ou
contador nessas páginas: a política diz que não há cookies.

## Apresentação do Plano de Negócios — anovaprofissao.com.br/apresentacao (out/2026)

Deck HTML animado (26 slides, 16:9, setas/passador) que o Jimmy usa ao vivo
e manda por link. Pedido dele em 27/10/2026. A fonte **não é deste repo**: o
original fica em `/Volumes/Sandisk/Claude/apresentacao-igreen-2026/` (HTML de
arquivo único, com fonte Montserrat e imagens embutidas, e o PDF gerado por
Chrome headless). `apresentacao/index.html` e `apresentacao/iGreen-2026-apresentacao.pdf`
são cópias idênticas; para atualizar, copiar os dois de novo e dar push.

- O build copia a pasta como está (`APRES` no build.js) e só injeta `noindex`
  + Open Graph + canonical no HTML. Não entra no sitemap. `apresentacao` está
  nos slugs reservados.
- **Exceção consciente às regras de conteúdo deste site**: o deck traz
  percentuais de comissão, simulações de ganho ("simulação ilustrativa, não
  constitui promessa de ganho" em todas), preços dos modelos Mob e a divisão
  da recarga (82% investidor / 10% software / 8% comercial). É material de
  apresentação fechada, por isso `noindex`. **Desde 28/10/2026 a home tem
  link para ele**, pedido do Jimmy: botão "Ver a apresentação em slides"
  logo abaixo do vídeo da seção `#apresentacao` (abre em aba nova, evento
  `apresentacao_slides`). Continua fora do Google e do sitemap. Os espelhos
  de licenciados herdam o botão: o deck não pode ganhar WhatsApp, link de
  cadastro ou rede social do Jimmy, senão o visitante do espelho cai no
  contato dele (o `conferirEspelho` do build não olha o deck). Linkar das
  outras páginas (integradores, transição) segue sendo decisão a reabrir com
  o Jimmy (CVM/SCP na Licença Mob, ver "Transição energética").
- A capa traz o aviso de licenciado independente, como a home.
- Slides de campanha (11 "Bônus Extra Garantido" e 23 "Campanhas do mês",
  mais as etiquetas "Nov/26" em Seguros e Livre e a legenda ⚡ do mapa)
  vencem em 30/11/2026. Desde 03/11/2026 a fonte é a newsletter do mês
  (`~/Downloads/Newsletter_<Mês>-2026.pdf`, a de novembro tem 81 páginas);
  o Academy completa os regulamentos. Os valores de GP são de licenciado PRO
  (regra por vertical). Pendências e histórico do deck: memória
  `apresentacao-plano-negocios-igreen` do Claude.
- **Mapa de cobertura (slide 9)**: SVG dos 27 estados (malha do IBGE, a mesma
  de `mapa-conexao-green/componente/geometria-ufs.js`) com as distribuidoras
  por estado vindas de `mapa-conexao-green/regras.json` (gerado do backup do
  Academy) mais as exceções que o Jimmy passou em 27/10/2026: sem cobertura em
  AC, AM, AP, DF, RO e RR; em SP não atende Enel SP e CPFL Piratininga; no RJ
  não atende Light. A EDP São Paulo voltou em novembro/2026 (newsletter:
  reabertura a partir de 350 kWh, 2 boletos, energia limitada) e aparece com
  a etiqueta "Reaberta". Dica ao passar o mouse/tocar; clique
  fixa. **Marcadores ⚡ (âmbar)** = distribuidoras da campanha Bônus Extra
  Green do mês (tabela `BONUS` no `patch_mapa.py`, tirada do regulamento no
  export do Academy; `2` = só com troca de titularidade). É o padrão visual
  combinado em 28/10/2026 para mostrar onde uma campanha vale: marcador no
  mapa + chip na dica + legenda. **Zoom só no mapa**: roda do mouse aproxima
  no ponto do cursor (até 7×), arrasto move, pinça no toque, duplo clique ou
  o botão "Brasil inteiro" volta; a página não dá zoom. Para atualizar:
  regerar `regras.json` com o backup novo, ajustar `BONUS`/`BONUS_VIGENCIA`
  e rodar `patch_mapa.py` (idempotente: refaz só o slide 9, o CSS e o JS do
  mapa).
- **Teste do estado final dos números**: `?static&pop#N` renderiza o slide
  com a classe `pop` (fim da contagem) aplicada. Em 28/10/2026 o pulso do
  número virava o `.big` em `inline-block` e ele subia para a linha da
  etiqueta, empurrando o texto para fora da caixa (slide Seguros); o render
  estático comum não mostra isso porque não conta. Hoje só `span.pop` vira
  inline-block, e o cartão do 300% tem coluna de texto que encolhe e pílulas
  que quebram linha — as métricas de fonte variam um pouco entre navegadores
  (no Chromium do app sobravam 45 px para fora), então nada ali é `nowrap`
  rígido.
- **Slide 18 "Na prática"**: os exemplos do treinamento da Conexão Mob
  (Manual de Negócio + Academy: Gestor Base vendendo um Mob Fast, liberação
  por etapa, royalty pela diferença, requisito das recargas, fidelidade de 90
  dias, troca de bandeira e carteira). A projeção de retorno do investidor
  fica de fora de propósito (CVM/SCP); ela mora na apresentação do investidor
  em querocarregador.com.br/apresentacao e /simulador.
- **Descontos e bônus na dica do mapa (02/11/2026)**: cada estado mostra, por
  distribuidora, os descontos com o bônus (A 4%, B 2%, C 1%, D 0,4%, GP de
  licenciado PRO) e, quando a faixa exige, o consumo mínimo ("1.000+ kWh").
  Distribuidoras com as mesmas faixas ficam agrupadas. **Desde 03/11/2026 o
  hub de pós-venda da Gabi prevalece** (decisão do Jimmy): as faixas vêm da
  tabela `pvRawData` de gaabiislva.github.io/index (pública no código da
  página), copiada em `apresentacao-igreen-2026/fontes/hub-gabi-pv.json`, via
  `faixas()` no `patch_mapa.py`. Distribuidora do Academy que não está no hub
  sai do mapa (PR Celesc e SC Copel). Para atualizar, baixar a tabela de novo
  e substituir o JSON. Nome de fornecedora nunca entra nesses dados.
- **Teste de boot obrigatório**: `verificar_boot.sh` (junto do deck) abre o
  HTML sem `?static`, como o público vê, e falha se o slide 1 não ativar; o
  `gerar_pdf.sh` roda esse teste antes de tudo. Motivo: em 28/10/2026 o deck
  foi ao ar em branco porque a caixa dos avisos push tinha sido removida junto
  com o último slide e o script parava num erro antes de ativar o slide 1 —
  os testes com `?static` não pegam isso, porque nesse modo os avisos nem
  iniciam. Toda publicação do deck passa por esse teste.
- Avisos estilo push (canto superior direito, aleatórios, rotulados
  "exemplo"): tecla N liga/desliga; `?semavisos` abre sem eles.
- **Último slide = chamada com dois caminhos** (pedido de 28/10/2026): "Como
  você quer começar?" → Licença Mob (igreenmob.com.br com o `ref` do Jimmy) ou
  Connect FULL (expansao.igreenenergy.com.br, `id=1971&checkout=true&tipolicenca=CONNECT`),
  com o selo "Ao clicar, você se cadastra com o licenciado Jimmy Fenner · ID
  1971". Os dois cartões são `<a target="_blank">`; no PDF viram anotações de
  link (o `gerar_pdf.sh` do deck mede os cartões com `?medir` e sobrepõe `<a>`
  nas páginas antes do `--print-to-pdf`). Se os links mudarem, trocar no HTML
  do deck e regerar o PDF com o script; nunca editar só o `index.html` daqui.

## Agendamento de reunião — /agendar (nov/2026)

Pedido do Jimmy em 03/11/2026: o mesmo agendamento do querocarregador.com.br/agendamento
nos dois sites deste repo.

- **anovaprofissao.com.br/agendar** — apresentação da iGreen Energy. Antes do
  horário, a pessoa precisa marcar "Sei que, para ser licenciado, existe um
  investimento de R$ 1.997 por ano" (exigência dele; a caixa mostra também 12x
  de R$ 197,41). Sem a marca, nem o site nem a função aceitam.
- **querovendercarregador.com.br/agendar** — Conexão Mob para integradores.
  Exige o vídeo de apresentação (o mesmo Vimeo da página, lido do
  `data-vimeo`/`data-duracao` de integradores.html no build). "Já assisti" pede
  a confirmação numa caixa; "Ainda não" abre o vídeo ali e só libera com 90% dos
  segundos realmente tocados (mesma contagem e mesma chave `qvc_video_<id>` da
  página, então quem já assistiu lá passa direto). Sem a API do Vimeo, a caixa
  de confirmação aparece depois do tempo do vídeo. Pergunta também "O que você
  faz hoje?" (mesmas opções do formulário).
- **Fonte única** `agendar.html`; blocos `<!--so:home-->` e `<!--so:integ-->` e
  `window.AGENDA` injetado no build. A da home é gerada em `dist/home-agendar`
  (o arquivo ganharia dos rewrites em /agendar) e o `vercel.json` faz `/agendar`
  virar uma ou outra por domínio; `/agendamento`, `/agenda` e `/home-agendar`
  redirecionam para `/agendar`. Ambas `noindex`. Fora dos domínios reais a
  marcação é **simulada** (prévia local não cria reunião).
- **Função `agenda`** (`supabase/functions/agenda`, verify_jwt ligado: o site
  chama com a chave anon): `slots`, `book` e `excluir` (este só com o login do
  painel). Regras iguais às do querocarregador: 30 min, seg 9–19, **ter 9–16**,
  qua–sex 9–19, aviso mínimo de 4 h, 14 dias à frente, ocupado lido do Google
  `freeBusy`. **A agenda é a mesma** (primary de contato@jimmyfenner.com.br, com
  os mesmos secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
  `GOOGLE_REFRESH_TOKEN` do querocarregador): uma reunião marcada num site some
  do outro. Cria o evento com Meet e convite (`sendUpdates=all`) **antes** de
  gravar o lead; se o lead não grava, apaga o evento. Uma reunião futura por
  WhatsApp/e-mail. Campo-isca `site` contra robô.
- **Banco** (`db/17-agendamento.sql`): o agendamento é um lead `tipo =
  'agendamento'` com `agenda_inicio`, `agenda_fim`, `agenda_meet`,
  `agenda_evento` e `agenda_aceite`; índice único no horário; o anon não tem
  grant nessas colunas e um lead 'agendamento' sem horário é recusado. O de
  integradores leva "página de integradores" na `solucao`, então conta como de lá
  no painel e no contador.
- **Aviso**: sai pelo gatilho de sempre (`avisa_lead_novo` → função `whatsapp`),
  que só dispara quando o lead é gravado, ou seja, com a reunião já criada.
  Mensagem própria (`corpoAgenda`: quando, Meet, o que confirmou, atuação, vídeo
  medido), e o e-mail vai **sempre também para contato@jimmyfenner.com.br**
  (pedido dele), pelo Forward Email, de no-reply@anovaprofissao.com.br (apresentação)
  ou no-reply@querovendercarregador.com.br (integradores). A pessoa recebe o
  convite do próprio Google.
- **Painel**: selo "Reunião dd/mm às hh:mm", filtro "Reuniões agendadas",
  linhas Reunião/Confirmou/Veio por no detalhe, botão "Abrir o Meet", Chamar
  com mensagem da reunião, e **Excluir chama a função `agenda`**, que apaga o
  evento (com cancelamento ao convidado se ainda não aconteceu) e o lead.
- **Botões**: home (seção Apresentação, fechamento e resultado do quiz) e
  integradores (hero, abaixo do vídeo e fechamento; `data-agendar` troca o link
  para `/agendar` no domínio deles). **Nos espelhos de licenciado não há
  agenda** (é a do Jimmy): bloco `<!--lic:agenda-->` some, o do quiz depende do
  `LIC`, e o build trava se sobrar `href="/agendar"` no espelho.
- Política de Privacidade atualizada (itens 2, 3 e 5; `ATUALIZADO` 3/11/2026).

## Disparo de mensagens pelo painel (nov/2026)

Pedido do Jimmy em 03/11/2026 (primeiro uso: convidar os leads para a live do
dia): mandar WhatsApp pelo painel para um lead ou para vários, com variáveis e
espera aleatória entre uma mensagem e a próxima. Vale para todos os leads deste
painel (home, integradores do querovendercarregador, transição, reuniões). O
querocarregador.com.br/admin ganhou o mesmo recurso, com a mesma especificação e
os mesmos testes do renderizador.

- **Onde está no painel:** caixa no começo de cada linha de lead; "Selecionar os
  N da lista" e "Limpar seleção" junto dos filtros; barra fixa no rodapé "N
  selecionados · Escrever mensagem"; botão "Enviar mensagem" no detalhe; e a
  tela **Disparos** no topo (instância padrão, número de teste e o
  acompanhamento, com Pausar, Retomar, Cancelar e a lista de cada pessoa, que se
  atualiza a cada 5 s enquanto houver disparo ativo).
- **Selo "mensagem agendada"** (pedido de 03/11/2026): quem está na fila de um
  disparo ativo ou pausado ganha um pill na linha, embaixo do nome e da cidade
  (dentro de `.lead__who`: entre 561 e ~880 px a linha não quebra, e no meio dos
  outros pills ele apagava o nome) ("Agendada hoje 18:00", "A
  partir de amanhã 09:30", "Na fila", "Pausada" ou "Enviando", com o texto
  completo no `title`) e a linha "Mensagem" no detalhe com "Ver em Disparos",
  lido com o login do painel em `disparos`/`disparo_envios` pelo `whatsapp_e164`
  ao abrir, a cada minuto, ao voltar para a lista e logo depois de criar,
  pausar, retomar ou cancelar, e some quando a mensagem sai; o cálculo é a
  função pura `painel/selo.mjs` (ES5, colada pelo build no lugar de
  `/*@@SELO@@*/`, testes em `tests/selo.test.mjs`).
- **Compositor** (modal próprio, fecha com Esc e no fundo): instância (lista da
  Evolution com perfil, número e nome, só as conectadas podem ser escolhidas; a
  escolhida pode virar padrão em `disparo_config`; sem padrão, vem a dos avisos,
  `whatsapp_config.instancia`), mensagem com botões de variável, aviso de
  variável desconhecida e de "N pessoas sem cidade", prévia por pessoa ‹ 1/N ›,
  intervalo (só com 2+ pessoas; padrão 40 a 90 s; 5 ≤ X ≤ Y ≤ 3600; estimativa de
  término), início agora ou agendado (horário de Brasília), "marcar como
  contatado" e "Mandar teste para mim". Rascunho e intervalo ficam no
  localStorage (`anp_disp_rascunho`, `anp_disp_min`, `anp_disp_max`). Enquanto
  o pedido está entrando na fila, o compositor não fecha (Esc, fundo e ✕ só
  avisam para esperar). Cada compositor gera uma `chave` que vai no "criar"
  (coluna única em `disparos`): se a resposta se perde e ele manda de novo, a
  função devolve o mesmo disparo ("já estava na fila") em vez de criar outro.
- **Variáveis:** `{primeiro_nome}`, `{nome}`, `{cidade}`, `{uf}` (ou `{estado}`)
  e `{saudacao}` (bom dia 5h–11h59, boa tarde 12h–17h59, boa noite 18h–4h59, na
  hora em que cada mensagem sai). Plano B `{cidade|sua cidade}`; variação
  `{Oi|Olá|E aí}` sorteada por mensagem. Nome todo em maiúsculas ou todo em
  minúsculas vira "João da Silva"; valor que abre frase ganha maiúscula.
  **Renderizador único** em `supabase/functions/_shared/mensagem.mjs`, ES5 de
  propósito: a função importa o arquivo e o `build.js` cola o mesmo conteúdo,
  sem as palavras de exportação, no script do painel, no lugar de
  `/*@@MENSAGEM@@*/` (o build para se o marcador sumir). Mexeu no renderizador,
  mexe no do querocarregador junto e roda `node --test tests/` (inclui um teste
  que roda o build e confere o painel).
- **Regras:**
  - **Espelho de licenciado fica fora.** A página disse ao lead que quem chama é
    o licenciado e para desconsiderar qualquer outro contato: caixa e botão
    desligados com o motivo, e a função confere no banco (`leads.licenciado`) e
    recusa com "lead de licenciado".
  - **Intervalo:** sorteado no servidor para cada pessoa (inteiro entre X e Y) e
    contado do fim do envio anterior. Uma mensagem por vez por instância, mesmo
    com dois disparos nela. Na Evolution, "digitando" de 1,2 a 3 s.
  - **Teste para mim:** vai na hora, fora da fila, para o número de teste (padrão
    5548991067007, editável na tela Disparos), com os dados da pessoa da prévia.
  - Número repetido na seleção sai uma vez só e marca todos os leads dele.
    Máximo 500 pessoas por disparo.
  - **Contatado:** se ligado, o servidor passa de "novo" para "contatado" (e grava
    `contatado_em` se estava vazio) só depois que a mensagem daquela pessoa sai.
  - **LGPD:** excluir lead apaga antes as linhas de `disparo_envios` daquele
    número e as que apontam para o lead em `refs` (pega o número antigo, se o
    WhatsApp foi corrigido no detalhe), nos dois caminhos (comum e reunião); se
    não conseguir, não apaga nada. Apagar no meio de um disparo não trava a fila:
    o gatilho `disparo_envios_apagado` tira a pessoa do total e agenda a próxima
    (ou conclui o disparo que ficou vazio).
- **Fila e pg_cron** (`db/18-disparos.sql`): tabelas `disparo_config`,
  `disparos` e `disparo_envios`; o painel só lê e apaga, quem grava é a função
  (service role), e as funções SQL (`disparo_reservar`, `disparo_concluir`,
  `disparo_devolver`, `disparo_pausar`, `disparo_retomar`, `disparo_cancelar`,
  `disparo_proximo`, `disparo_painel`) só rodam com a service role. A migração
  **instala o `pg_cron`** (não estava instalado neste banco) e agenda
  `disparos-processar`, a cada minuto, chamando a função com
  `{"action":"processar"}` por `net.http_post`. Cada chamada anda a fila por até
  55 s. Sem resposta da Evolution em 75 s, ou "enviando" há mais de 4 min, vira
  "Sem confirmação" (pode ter saído) e a fila segue. Número sem WhatsApp vira
  "Não enviado" e segue. Instância caída, inexistente ou sem permissão **pausa o
  disparo** com o motivo e devolve a pessoa para a fila sem perder a vez: conectar
  o número e tocar em Retomar.
- **Função `disparos`** (`supabase/functions/disparos`): ações `instancias`,
  `config`, `criar`, `teste`, `lista`, `pausar`, `retomar`, `cancelar` (todas com
  o login do painel) e `processar` (pública e inofensiva: só envia o que já está
  na fila e no horário). Por isso é a única daqui com **`verify_jwt` desligado**.
  Usa os mesmos secrets da `whatsapp` (`EVOLUTION_URL`, `EVOLUTION_APIKEY`); o
  token das instâncias nunca sai da função. Publicar:
  `supabase functions deploy disparos --project-ref buapklmgdjcoyzrmhhcd --use-api --no-verify-jwt`.
  O limite de parede vale para o worker, que o Supabase reaproveita entre
  chamadas (Free: encerrado aos 150 s, sem chamada nova depois dos 75 s; pagos:
  400 s e 200 s). Nenhum envio espera a Evolution além do fim do worker: perto
  dele a espera encolhe até 15 s e o que passar vira "Sem confirmação". A função
  supõe 150 s e passa a 400 s quando recebe chamada num worker com mais de 80 s.
  Parar de reservar cedo foi descartado: deixava a fila parada quase um minuto
  a cada dois.
- **Modo demonstração:** instâncias falsas e fila simulada (anda um por consulta,
  de vez em quando um número "sem WhatsApp"), para ver as telas sem login.
- **Testado em 03/11/2026, sem tocar em produção:** renderizador e build
  (`node --test tests/`), SQL em PGlite (migração rodada duas vezes, fila,
  espera, pausa, retomada, cancelamento, recuperação de "enviando", contatado só
  de "novo", uma instância sem dois envios, acesso por papel), função no Deno
  contra Evolution e banco falsos, e as telas em jsdom no modo demonstração.
  Falta: aplicar a 18, publicar a função e mandar o primeiro teste para o
  número dele antes do primeiro disparo real.

## Painel dos licenciados — anovaprofissao.com.br/painel (nov/2026)

Pedido do Jimmy em 04/11/2026: os licenciados com espelho (hoje o Mario) e os
próximos que ele criar entram num painel próprio, com login por código no
WhatsApp, como o /painel do igreencel.com.br.

- **Login**: a pessoa digita o WhatsApp cadastrado na tabela `licenciados`
  (com ou sem o 9, com ou sem 55), recebe um código de 6 números e entra. O
  código fica só como hash (`acessos_painel`), vale 10 min e 5 tentativas,
  no máximo 3 pedidos por número a cada 15 min; a resposta é a mesma para
  qualquer número. A sessão é um token aleatório de 30 dias no localStorage
  (`anp_painel`), e o banco guarda só o hash (`sessoes_painel`); "Sair" encerra.
- **O número que manda os códigos** é configurável no /admin (botão
  **Licenciados**, lista vinda da Evolution pela função `disparos`) e fica em
  `painel_config.instancia_codigos`. Começa em `1575` (o número do Jimmy final
  1575, pedido dele); sem escolha, usa a instância dos avisos de lead.
  "Mandar teste para mim" manda uma mensagem por ela para (48) 99106-7007. A
  tela mostra também os últimos códigos pedidos (enviado, não saiu, entrou).
- **O que o licenciado vê**: visitas da página dele (30 dias), leads (30 dias),
  quantos esperam contato, e a lista dos leads da página dele (um por linha),
  com detalhe, status, anotações e "Chamar" (marca como contatado). Não apaga
  lead: pedido de exclusão passa pelo Jimmy.
- **O Jimmy** (5548991067007, fixo em `ADMINS` na função) entra no mesmo
  painel e escolhe de qual licenciado ver.
- **Acesso por licenciado**: coluna `licenciados.painel_ativo`, ligada por
  padrão; o /admin liga e desliga, e desligar tira a pessoa na hora (a função
  confere a cada pedido). `ultimo_acesso_painel` aparece no /admin.
- **Função `painel`** (verify_jwt ligado): ações codigo, entrar, dados, lead e
  sair com o token no corpo; config, config_salvar e config_teste com o login
  do /admin. Migração `db/19-painel-licenciados.sql`. Página `painel.html`
  (`noindex`, `painel` nos slugs reservados). O aviso de lead do espelho
  termina com "Seus leads: anovaprofissao.com.br/painel".
- **Para dar acesso a um licenciado novo**: basta a linha dele em
  `licenciados` com o WhatsApp certo (o mesmo cadastro do espelho).

## Cadastro de licenciados pelo /admin (nov/2026)

Pedido do Jimmy em 04/11/2026: ele mesmo cria e edita os licenciados, sem
pedir ao Claude. /admin > **Licenciados** > **Novo licenciado** (ou Editar).

- **Formulário**: nome completo, nome na página, como é chamado, tratamento
  (licenciado/licenciada), endereço (`/<slug>`, não muda depois de criado),
  WhatsApp, e-mail, cidade, UF, região, link de cadastro da iGreen ou só o ID
  (com só o ID sai `?id=<ID>&checkout=true&tipolicenca=CONNECT`, igual ao
  dele), desde (mês), qualificação, apresentação (vazia = texto modelo),
  Instagram, YouTube, grupo, Pixel e a foto. A foto é recortada no navegador
  em 4:5 (arrasta e aproxima) e sai JPEG 760x950. "Testar link" abre o link
  de cadastro para ele conferir se o ID é mesmo da pessoa.
- **Função `painel`**, ações com o login do /admin: `lic_salvar` valida tudo
  (a mesma trava do build: nada de Jimmy/Fenner, do número, do ID 1971 nem das
  redes dele; WhatsApp único entre licenciados; endereço livre e fora de
  `RESERVADOS`, que precisa ficar igual ao do build.js), sobe a foto no bucket
  (`<slug>-<ms>.jpg`, apaga a antiga), grava a ficha e chama o deploy hook;
  `lic_ativo` põe/tira a página do ar (coluna `ativo`, que também decide para
  quem vão os leads); `lic_publicar` só publica de novo.
- **Publicação**: deploy hook da Vercel `admin-licenciados` (branch main), no
  segredo `VERCEL_DEPLOY_HOOK` da função. O build roda `tools/licenciados.mjs`,
  que lê `licenciados_publicos()` com a chave anon (só ativos com ficha
  completa, sem e-mail), baixa as fotos para `dist/media/licenciados/` (nome
  com data: o /media tem cache de 30 dias) e devolve as fichas. Se o Supabase
  falhar, o build para e a versão anterior fica no ar (de propósito: publicar
  sem um licenciado apagaria a página dele).
- **Acompanhamento**: a página leva `versao` em `window.ANP_LIC`; o /admin
  consulta `/<slug>` a cada 10 s até ver a versão nova (ou o 404, ao tirar do
  ar) e avisa "No ar"; em 6 min sem mudança, avisa que a versão anterior
  continua no ar e manda tocar em "Publicar de novo".
- **Build local sem banco**: `LICENCIADOS_TESTE=tests/fixtures/licenciados node build.js`
  (os testes usam isso). Sem a variável, o build lê o banco de produção.
- **Gênero**: `feminino` troca "licenciado/estabelecido" por "licenciada/
  estabelecida" no topo, nos selos, no rodapé e nas páginas jurídicas.
  "Licenciado desde" e "Qualificação" somem quando vazios.
- Migração `db/20-licenciados-no-admin.sql` (colunas da ficha, bucket,
  `licenciados_publicos()`, índice único do WhatsApp e a ficha do Mario).

