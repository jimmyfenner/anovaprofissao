-- Campo de capacidade de investimento, respondido no quiz.
-- Serve para separar quem pode assumir a licença de quem deve receber,
-- por ora, apenas a solução gratuita de economia na conta de luz.

alter table public.leads
  add column if not exists investimento text;

-- o site (anon) precisa poder gravar essa coluna no insert
grant insert (investimento) on public.leads to anon;

-- o painel (authenticated) já lê tudo; garante a leitura da nova coluna
grant select (investimento) on public.leads to authenticated;
