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
   ou 12x R$ 197,41, licença Connect), autorizado pelo Jimmy em set/2026.
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
— R$ 1.997 à vista ou 12x de R$ 197,41 no cartão — antes de pedir o
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

Nenhuma. 07 e 08 foram aplicadas em 30/set/2026, e a Edge Function
`whatsapp` foi publicada no mesmo dia já com `investimento` e `momento`.

Verificar antes de qualquer coisa:
`select column_name from information_schema.columns where table_name='leads';`

## Outras pendências

- **Leads de teste a apagar** no painel: Jonas, "Teste Claude (ignorar)",
  "Teste 2 (pode apagar)", "Teste Pixel Claude". Exclusão exige login
  (anon não tem DELETE — está correto assim).
- **`link_grupo` vazio** — o convite para o canal de espera só aparece
  quando o Jimmy colar o link no painel. Recomendação registrada: canal,
  não grupo.
- **E-mail de aviso não chegou** no teste de 30/set (o WhatsApp sim).
  Diagnóstico pendente: ver a linha de canal `email` na aba Notificações
  do painel. Suspeita principal: Resend em modo de teste (remetente
  `onboarding@resend.dev` só entrega para o dono da conta Resend).
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

## Como retomar no Claude Code

```
git clone https://github.com/jimmyfenner/anovaprofissao.git
cd anovaprofissao && npm i -g @anthropic-ai/claude-code   # se ainda não tiver
claude
```

O `CLAUDE.md` é lido automaticamente. Primeira mensagem útil: pedir para
ler este arquivo inteiro e listar as pendências acima antes de propor
qualquer coisa.
