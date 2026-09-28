-- Resposta de follow-up de quem disse que hoje não consegue investir:
-- o "não" é temporal (quer voltar) ou definitivo?

alter table public.leads
  add column if not exists momento text;

grant insert (momento) on public.leads to anon;
grant select (momento) on public.leads to authenticated;
