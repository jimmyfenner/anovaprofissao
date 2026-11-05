-- =========================================================
-- A NOVA PROFISSÃO — licenciados cadastrados pelo /admin (nov/2026)
--
-- Até aqui a ficha da página de cada licenciado (anovaprofissao.com.br/<slug>)
-- ficava no código (dados/licenciados.json) e a foto em media/licenciados/.
-- Agora a ficha fica nesta tabela e a foto no Storage (bucket "licenciados"):
--
--   /admin > Licenciados > Novo licenciado  ->  função "painel" (lic_salvar)
--     grava a ficha, sobe a foto e chama o deploy hook da Vercel;
--   build.js  ->  tools/licenciados.mjs chama licenciados_publicos() com a
--     chave anon, baixa as fotos e gera as páginas como antes.
--
-- licenciados_publicos() devolve só o que já é público nas páginas (nome,
-- WhatsApp, cidade, link de cadastro, apresentação, foto). O e-mail não sai.
-- Só entram os ativos com a ficha completa.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.licenciados
  add column if not exists nome_pagina   text,      -- como aparece no topo ("Mario Henrique")
  add column if not exists nome_curto    text,      -- como é chamado ("Mario")
  add column if not exists feminino      boolean not null default false,  -- "licenciada"
  add column if not exists cidade        text,
  add column if not exists uf            text check (uf is null or uf ~ '^[A-Z]{2}$'),
  add column if not exists regiao        text,
  add column if not exists link_cadastro text check (link_cadastro is null or link_cadastro ~ '^https://expansao\.igreenenergy\.com\.br/\?id=[0-9]{1,9}(&[a-z]+=[A-Za-z0-9]+)*$'),
  add column if not exists link_grupo    text,
  add column if not exists meta_pixel    text check (meta_pixel is null or meta_pixel ~ '^[0-9]{10,20}$'),
  add column if not exists desde         date,      -- mês em que virou licenciado (dia 1)
  add column if not exists qualificacao  text,
  add column if not exists bio           text[],
  add column if not exists instagram     text,
  add column if not exists youtube       text,
  add column if not exists foto          text check (foto is null or foto ~ '^[a-z0-9-]{3,40}-[0-9]{8,20}\.jpg$'),  -- arquivo no bucket
  add column if not exists atualizado_em timestamptz not null default now();

-- dois licenciados com o mesmo WhatsApp quebrariam o login do /painel
create unique index if not exists licenciados_whatsapp_uk on public.licenciados (whatsapp) where whatsapp is not null;

-- foto: bucket público só de leitura; quem grava é a função "painel" (service role)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('licenciados', 'licenciados', true, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ficha do Mario (era dados/licenciados.json); a foto entra pelo Storage em seguida
update public.licenciados set
  nome_pagina   = 'Mario Henrique',
  nome_curto    = 'Mario',
  cidade        = 'Santos',
  uf            = 'SP',
  regiao        = 'Baixada Santista',
  link_cadastro = 'https://expansao.igreenenergy.com.br/?id=114882&checkout=true',
  desde         = date '2025-12-01',
  qualificacao  = 'Sênior',
  bio = array[
    'Sou Mario Henrique, de Santos, na Baixada Santista, e atuo como licenciado iGreen desde dezembro de 2025, exercendo a função de consultor sênior na empresa.',
    'Atendo clientes em todo o Brasil, oferecendo soluções para economizar na conta de luz, além de energia solar, eletropostos, telecomunicações e oportunidades de negócios.',
    'Meu objetivo é ajudar pessoas e empresas a conhecerem essas soluções e aproveitarem seus benefícios.'
  ]
where slug = 'mariogomes' and nome_pagina is null;

create or replace function public.licenciados_publicos()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(slug, jsonb_build_object(
    'nome',          nome_pagina,
    'nome_curto',    nome_curto,
    'nome_completo', nome,
    'feminino',      feminino,
    'cidade',        cidade,
    'uf',            uf,
    'regiao',        coalesce(regiao, ''),
    'whatsapp',      whatsapp,
    'link_cadastro', link_cadastro,
    'link_grupo',    coalesce(link_grupo, ''),
    'meta_pixel',    coalesce(meta_pixel, ''),
    'desde',         to_char(desde, 'YYYY-MM'),
    'qualificacao',  coalesce(qualificacao, ''),
    'bio',           to_jsonb(coalesce(bio, array[]::text[])),
    'instagram',     coalesce(instagram, ''),
    'youtube',       coalesce(youtube, ''),
    'foto',          foto,
    'versao',        to_char(atualizado_em at time zone 'UTC', 'YYYYMMDD"T"HH24MISS')
  ) order by slug), '{}'::jsonb)
  from licenciados
  where ativo
    and nome_pagina is not null and nome_curto is not null and cidade is not null and uf is not null
    and whatsapp is not null and link_cadastro is not null and foto is not null
    and coalesce(array_length(bio, 1), 0) > 0
$$;
revoke all on function public.licenciados_publicos() from public;
grant execute on function public.licenciados_publicos() to anon, authenticated;

notify pgrst, 'reload schema';
