-- =========================================================
-- A NOVA PROFISSÃO — leads da página de integradores
--
-- A página querovendercarregador.com.br (fonte: integradores.html)
-- grava na mesma tabela de leads com tipo = 'integrador'.
-- O check de tipo só aceitava 'quiz' e 'direto'; esta migração
-- acrescenta o terceiro valor. Nenhuma coluna nova: a página usa
-- as colunas que o site já podia gravar (experiencia = atuação,
-- perfil = quantos clientes atendeu, objetivo = interesse).
--
-- Enquanto ela não rodar, a página grava o lead sem o tipo
-- (cai no padrão 'quiz') para não perder ninguém.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode rodar mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.leads drop constraint if exists leads_tipo_check;
alter table public.leads
  add constraint leads_tipo_check check (tipo in ('quiz', 'direto', 'integrador'));
