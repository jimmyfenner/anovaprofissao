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
- E-mail via Resend no mesmo fluxo do WhatsApp. Um destinatário pode ter
  numero, email ou os dois (tabela notificacao_destinatarios).
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
| Notificações | Supabase Edge Function `whatsapp` → Evolution API + Resend |
| Painel de leads | `anovaprofissao.com.br/admin` (login Supabase do Jimmy) |
| Pixel da Meta | ID `1752542589367351`, chave `meta_pixel` no `site_config` |

## Segredos — o que nunca circula

- `service_role` do Supabase, API key da Evolution e API key do Resend
  vivem **só** nos Secrets do Supabase. Nunca no repositório, nunca no
  chat, nem para o Jimmy.
- A `anon key` do Supabase é pública por projeto — está no código do site
  de propósito e isso é seguro; quem protege os dados é a RLS + os grants
  por coluna.
- O PAT do GitHub usado nesta máquina está em `~/.git-credentials`. Numa
  máquina nova é preciso autenticar de novo (`gh auth login` ou PAT novo).
  Convém rotacionar o antigo.

## Migrações SQL pendentes (o Jimmy cola no SQL Editor)

Nenhuma. 13 (espelhos de licenciados) aplicada e testada em 23/out/2026.
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

Três momentos (19/10/2026, pedido do Jimmy): a página fala com quem quer
**somar** um produto ao que já vende, com quem viu **as vendas caírem** e com
quem pensa em **mudar de ramo** — nunca "quebrado" ou "desesperado". O bloco
"Em que momento você está?" (`#momento`) leva cada um à sua parte (`#papel`,
`#orcamentos`, `#transicao`) e marca a resposta no formulário. A dor vai com
fatos (Fio B da Lei 14.300, inversão de fluxo, kit a preço de custo), sem
política: nada de governo ou partido, nem em anúncio. A pergunta do formulário
grava na coluna `momento` (já existia, migração 08); o painel mostra, a
mensagem pronta do WhatsApp leva, e o aviso `corpoInteg` tem a linha no código
— só aparece no aviso depois de republicar a Edge Function `whatsapp`.

Corte do Carlos Evangelista (fundador da ABGD, sócio da Vértice) liberado
pelo Jimmy para esta página em 19/10/2026: seção `#carlos`, logo depois da
dor, com o mesmo arquivo da transição (`/media/transicao/te-34-fundador-abgd.mp4`)
e a nota de correção das datas (ele diz "15 de novembro").

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

- **Ficha** em `dados/licenciados.json` (nome, WhatsApp, link de cadastro, foto
  em `media/licenciados/<slug>.jpg` 760x950, apresentação, redes, pixel). O
  **e-mail não fica na ficha** (o site é público): fica só na tabela
  `licenciados` do Supabase, que recebe os avisos. Para criar um espelho:
  ficha + foto + linha na tabela `licenciados` (migração 13 tem o modelo).
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

Deck HTML animado (25 slides, 16:9, setas/passador) que o Jimmy usa ao vivo
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
- Slides de campanha (11 "Bônus Extra Garantido" e 22 "Campanhas do mês",
  mais as etiquetas "Out/26" em Seguros e Livre) vencem em 31/10/2026 e são
  refeitos a cada export novo do Academy; os valores de GP são de licenciado
  PRO (regra por vertical). Pendências e histórico do deck: memória
  `apresentacao-plano-negocios-igreen` do Claude.
- **Mapa de cobertura (slide 9)**: SVG dos 27 estados (malha do IBGE, a mesma
  de `mapa-conexao-green/componente/geometria-ufs.js`) com as distribuidoras
  por estado vindas de `mapa-conexao-green/regras.json` (gerado do backup do
  Academy) mais as exceções que o Jimmy passou em 27/10/2026: sem cobertura em
  AC, AM, AP, DF, RO e RR; em SP não atende Enel SP, EDP São Paulo e CPFL
  Piratininga; no RJ não atende Light. Dica ao passar o mouse/tocar; clique
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
