-- SQL functions and triggers the application relies on.
--
-- Recovered from the Supabase dumps (git 67418536af:apps/api/supabase/migrations)
-- and reconciled with the current schema, or written from the call sites
-- where no definition was ever committed. Signatures match
-- packages/supabase/src/types/db.ts (the last generated snapshot of prod).
-- Every statement is CREATE OR REPLACE / DROP IF EXISTS, so re-running is safe.

------------------------------------------------------------------------------
-- Tracker projects (computed fields called with a whole tracker_projects row)
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.total_duration(public.tracker_projects)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(te.duration), 0)::integer
  FROM public.tracker_entries te
  WHERE te.project_id = $1.id;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_project_total_amount(public.tracker_projects)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN $1.rate IS NULL THEN 0
    ELSE COALESCE(
      (SELECT ROUND(SUM(te.duration) * $1.rate / 3600, 2)
       FROM public.tracker_entries te
       WHERE te.project_id = $1.id),
      0
    )
  END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_assigned_users_for_project(public.tracker_projects)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT json_agg(
       json_build_object(
         'user_id', u.id,
         'full_name', u.full_name,
         'avatar_url', u.avatar_url
       )
     )
     FROM (
       SELECT DISTINCT u.id, u.full_name, u.avatar_url
       FROM public.users u
       JOIN public.tracker_entries te ON u.id = te.assigned_id
       WHERE te.project_id = $1.id
     ) u),
    '[]'::json
  );
$$;--> statement-breakpoint

------------------------------------------------------------------------------
-- Bank accounts
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bank_account_currencies(team_id uuid)
RETURNS TABLE(currency text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ba.currency
  FROM public.bank_accounts ba
  WHERE ba.team_id = get_bank_account_currencies.team_id
    AND ba.currency IS NOT NULL
  ORDER BY ba.currency;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.get_team_bank_accounts_balances(team_id uuid)
RETURNS TABLE(id uuid, currency text, balance numeric, name text, logo_url text)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ba.id,
    ba.currency,
    COALESCE(ba.balance, 0) AS balance,
    ba.name,
    bc.logo_url
  FROM public.bank_accounts ba
  LEFT JOIN public.bank_connections bc ON bc.id = ba.bank_connection_id
  WHERE ba.team_id = get_team_bank_accounts_balances.team_id
    AND ba.enabled = true
  ORDER BY COALESCE(ba.balance, 0) DESC;
$$;--> statement-breakpoint

------------------------------------------------------------------------------
-- Documents
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.match_similar_documents_by_title(
  source_document_id uuid,
  p_team_id uuid,
  match_threshold double precision,
  match_count integer
)
RETURNS TABLE(
  id uuid,
  name text,
  metadata jsonb,
  path_tokens text[],
  tag text,
  title text,
  summary text,
  title_similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  WITH source AS (
    SELECT COALESCE(NULLIF(d.title, ''), d.name) AS title
    FROM public.documents d
    WHERE d.id = source_document_id AND d.team_id = p_team_id
  )
  SELECT
    d.id,
    d.name,
    d.metadata,
    d.path_tokens,
    d.tag,
    d.title,
    d.summary,
    similarity(COALESCE(NULLIF(d.title, ''), d.name), s.title)::double precision AS title_similarity
  FROM public.documents d, source s
  WHERE d.team_id = p_team_id
    AND d.id <> source_document_id
    AND s.title IS NOT NULL
    AND d.name NOT LIKE '%.folderPlaceholder'
    AND similarity(COALESCE(NULLIF(d.title, ''), d.name), s.title) >= match_threshold
  ORDER BY title_similarity DESC
  LIMIT match_count;
$$;--> statement-breakpoint

------------------------------------------------------------------------------
-- Search
------------------------------------------------------------------------------

-- Turns free text into a prefix tsquery ("acme inv" -> 'acme':* & 'inv':*).
-- Returns NULL for empty input. p_operator is '&' (all words) or '|' (any).
CREATE OR REPLACE FUNCTION public.build_search_tsquery(
  p_term text,
  p_lang regconfig DEFAULT 'english',
  p_operator text DEFAULT '&'
)
RETURNS tsquery
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN string_agg(w, '') IS NULL THEN NULL
    ELSE to_tsquery(
      p_lang,
      string_agg(quote_literal(w) || ':*', ' ' || p_operator || ' ')
    )
  END
  FROM regexp_split_to_table(
    lower(regexp_replace(COALESCE(p_term, ''), '[^[:alnum:]]+', ' ', 'g')),
    '\s+'
  ) AS w
  WHERE w <> '';
$$;--> statement-breakpoint

-- Text search config from a name like 'english' or 'swedish'; anything
-- unknown (including ISO codes like 'en') falls back to english.
CREATE OR REPLACE FUNCTION public.resolve_search_config(p_lang text)
RETURNS regconfig
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT c.oid::regconfig FROM pg_catalog.pg_ts_config c WHERE c.cfgname = lower(p_lang) LIMIT 1),
    'english'::regconfig
  );
$$;--> statement-breakpoint

-- Global search across the main entities. Result types: customer, invoice,
-- vault, inbox, tracker_project, transaction. `data` is the row as jsonb
-- (snake_case keys), which is what the dashboard search UI reads.
-- With an empty search term it returns the most recent items per type.
DROP FUNCTION IF EXISTS public.global_search(text, uuid, text, integer, integer, double precision);--> statement-breakpoint
CREATE FUNCTION public.global_search(
  p_search_term text DEFAULT NULL,
  p_team_id uuid DEFAULT NULL,
  p_search_lang text DEFAULT 'english',
  p_limit integer DEFAULT 30,
  p_items_per_table_limit integer DEFAULT 5,
  p_relevance_threshold double precision DEFAULT 0.01
)
RETURNS TABLE(
  id uuid,
  type text,
  title text,
  relevance double precision,
  created_at timestamptz,
  data jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_query tsquery := public.build_search_tsquery(
    p_search_term, public.resolve_search_config(COALESCE(p_search_lang, 'english')), '&'
  );
  v_per_table integer := COALESCE(p_items_per_table_limit, 5);
  v_limit integer := COALESCE(p_limit, 30);
  v_threshold double precision := COALESCE(p_relevance_threshold, 0.01);
BEGIN
  IF p_team_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.id, r.type, r.title, r.relevance, r.created_at, r.data
  FROM (
    (SELECT c.id, 'customer'::text AS type, c.name AS title,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(c.fts, v_query) END::double precision AS relevance,
            c.created_at, to_jsonb(c) - 'fts' AS data
     FROM public.customers c
     WHERE c.team_id = p_team_id
       AND (v_query IS NULL OR (c.fts @@ v_query AND ts_rank(c.fts, v_query) >= v_threshold))
     ORDER BY 4 DESC, c.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT i.id, 'invoice'::text, i.invoice_number,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(i.fts, v_query) END::double precision,
            i.created_at, to_jsonb(i) - 'fts'
     FROM public.invoices i
     WHERE i.team_id = p_team_id
       AND (v_query IS NULL OR (i.fts @@ v_query AND ts_rank(i.fts, v_query) >= v_threshold))
     ORDER BY 4 DESC, i.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT d.id, 'vault'::text, COALESCE(NULLIF(d.title, ''), d.name),
            CASE WHEN v_query IS NULL THEN 0
                 ELSE ts_rank(d.fts || to_tsvector('simple', COALESCE(d.name, '')), v_query) END::double precision,
            d.created_at,
            to_jsonb(d) - 'fts' - 'fts_simple' - 'fts_english' - 'fts_language' - 'content' - 'body'
     FROM public.documents d
     WHERE d.team_id = p_team_id
       AND COALESCE(d.name, '') NOT LIKE '%.folderPlaceholder'
       AND (v_query IS NULL OR (
         (d.fts || to_tsvector('simple', COALESCE(d.name, ''))) @@ v_query
         AND ts_rank(d.fts || to_tsvector('simple', COALESCE(d.name, '')), v_query) >= v_threshold
       ))
     ORDER BY 4 DESC, d.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT b.id, 'inbox'::text, COALESCE(b.display_name, b.file_name),
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(b.fts, v_query) END::double precision,
            b.created_at, to_jsonb(b) - 'fts'
     FROM public.inbox b
     WHERE b.team_id = p_team_id
       AND b.status IS DISTINCT FROM 'deleted'
       AND (v_query IS NULL OR (b.fts @@ v_query AND ts_rank(b.fts, v_query) >= v_threshold))
     ORDER BY 4 DESC, b.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT p.id, 'tracker_project'::text, p.name,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(p.fts, v_query) END::double precision,
            p.created_at, to_jsonb(p) - 'fts'
     FROM public.tracker_projects p
     WHERE p.team_id = p_team_id
       AND (v_query IS NULL OR (p.fts @@ v_query AND ts_rank(p.fts, v_query) >= v_threshold))
     ORDER BY 4 DESC, p.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT t.id, 'transaction'::text, t.name,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(t.fts_vector, v_query) END::double precision,
            t.created_at, to_jsonb(t) - 'fts_vector'
     FROM public.transactions t
     WHERE t.team_id = p_team_id
       AND (v_query IS NULL OR (t.fts_vector @@ v_query AND ts_rank(t.fts_vector, v_query) >= v_threshold))
     ORDER BY 4 DESC, t.created_at DESC
     LIMIT v_per_table)
  ) r
  ORDER BY r.relevance DESC, r.created_at DESC
  LIMIT v_limit;
END;
$$;--> statement-breakpoint

-- Filtered search used after an LLM turns a natural-language query into
-- structured filters. `types` uses table names: transactions, invoices,
-- tracker_projects, customers, documents, inbox. Words in the search term
-- are OR-ed so the structured filters do most of the narrowing.
DROP FUNCTION IF EXISTS public.global_semantic_search(uuid, text, text, text, text[], numeric, numeric, numeric, text, text, text, text, text, integer, integer);--> statement-breakpoint
CREATE FUNCTION public.global_semantic_search(
  team_id uuid,
  search_term text DEFAULT NULL,
  start_date text DEFAULT NULL,
  end_date text DEFAULT NULL,
  types text[] DEFAULT NULL,
  amount numeric DEFAULT NULL,
  amount_min numeric DEFAULT NULL,
  amount_max numeric DEFAULT NULL,
  status text DEFAULT NULL,
  currency text DEFAULT NULL,
  language text DEFAULT NULL,
  due_date_start text DEFAULT NULL,
  due_date_end text DEFAULT NULL,
  max_results integer DEFAULT 20,
  items_per_table_limit integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  type text,
  title text,
  relevance double precision,
  created_at timestamptz,
  data jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
#variable_conflict use_variable
DECLARE
  v_team uuid := team_id;
  v_query tsquery := public.build_search_tsquery(
    search_term, public.resolve_search_config(COALESCE(language, 'english')), '|'
  );
  v_types text[] := CASE WHEN types IS NULL OR cardinality(types) = 0
    THEN ARRAY['transactions', 'invoices', 'tracker_projects', 'customers', 'documents', 'inbox']
    ELSE types END;
  v_start date := NULLIF(start_date, '')::date;
  v_end date := NULLIF(end_date, '')::date;
  v_due_start date := NULLIF(due_date_start, '')::date;
  v_due_end date := NULLIF(due_date_end, '')::date;
  v_amount numeric := amount;
  v_amount_min numeric := amount_min;
  v_amount_max numeric := amount_max;
  v_status text := NULLIF(status, '');
  v_currency text := upper(NULLIF(currency, ''));
  v_per_table integer := COALESCE(items_per_table_limit, 5);
  v_limit integer := COALESCE(max_results, 20);
BEGIN
  IF v_team IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.id, r.type, r.title, r.relevance, r.created_at, r.data
  FROM (
    (SELECT t.id, 'transaction'::text AS type, t.name AS title,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(t.fts_vector, v_query) END::double precision AS relevance,
            t.created_at, to_jsonb(t) - 'fts_vector' AS data
     FROM public.transactions t
     WHERE 'transactions' = ANY (v_types)
       AND t.team_id = v_team
       AND (v_query IS NULL OR t.fts_vector @@ v_query)
       AND (v_start IS NULL OR t.date >= v_start)
       AND (v_end IS NULL OR t.date <= v_end)
       AND (v_amount IS NULL OR abs(t.amount) = abs(v_amount))
       AND (v_amount_min IS NULL OR abs(t.amount) >= v_amount_min)
       AND (v_amount_max IS NULL OR abs(t.amount) <= v_amount_max)
       AND (v_currency IS NULL OR upper(t.currency) = v_currency)
     ORDER BY 4 DESC, t.date DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT i.id, 'invoice'::text, i.invoice_number,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(i.fts, v_query) END::double precision,
            i.created_at, to_jsonb(i) - 'fts'
     FROM public.invoices i
     WHERE 'invoices' = ANY (v_types)
       AND i.team_id = v_team
       AND (v_query IS NULL OR i.fts @@ v_query
            OR i.customer_name ILIKE '%' || search_term || '%')
       AND (v_start IS NULL OR COALESCE(i.issue_date, i.created_at)::date >= v_start)
       AND (v_end IS NULL OR COALESCE(i.issue_date, i.created_at)::date <= v_end)
       AND (v_due_start IS NULL OR i.due_date::date >= v_due_start)
       AND (v_due_end IS NULL OR i.due_date::date <= v_due_end)
       AND (v_amount IS NULL OR i.amount = v_amount)
       AND (v_amount_min IS NULL OR i.amount >= v_amount_min)
       AND (v_amount_max IS NULL OR i.amount <= v_amount_max)
       AND (v_status IS NULL OR i.status::text = v_status)
       AND (v_currency IS NULL OR upper(i.currency) = v_currency)
     ORDER BY 4 DESC, i.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT p.id, 'tracker_project'::text, p.name,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(p.fts, v_query) END::double precision,
            p.created_at, to_jsonb(p) - 'fts'
     FROM public.tracker_projects p
     WHERE 'tracker_projects' = ANY (v_types)
       AND p.team_id = v_team
       AND (v_query IS NULL OR p.fts @@ v_query)
       AND (v_start IS NULL OR p.created_at::date >= v_start)
       AND (v_end IS NULL OR p.created_at::date <= v_end)
       AND (v_status IS NULL OR v_status NOT IN ('in_progress', 'completed') OR p.status::text = v_status)
       AND (v_currency IS NULL OR upper(p.currency) = v_currency)
     ORDER BY 4 DESC, p.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT c.id, 'customer'::text, c.name,
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(c.fts, v_query) END::double precision,
            c.created_at, to_jsonb(c) - 'fts'
     FROM public.customers c
     WHERE 'customers' = ANY (v_types)
       AND c.team_id = v_team
       AND (v_query IS NULL OR c.fts @@ v_query)
       AND (v_start IS NULL OR c.created_at::date >= v_start)
       AND (v_end IS NULL OR c.created_at::date <= v_end)
     ORDER BY 4 DESC, c.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT d.id, 'vault'::text, COALESCE(NULLIF(d.title, ''), d.name),
            CASE WHEN v_query IS NULL THEN 0
                 ELSE ts_rank(d.fts || to_tsvector('simple', COALESCE(d.name, '')), v_query) END::double precision,
            d.created_at,
            to_jsonb(d) - 'fts' - 'fts_simple' - 'fts_english' - 'fts_language' - 'content' - 'body'
     FROM public.documents d
     WHERE 'documents' = ANY (v_types)
       AND d.team_id = v_team
       AND COALESCE(d.name, '') NOT LIKE '%.folderPlaceholder'
       AND (v_query IS NULL OR (d.fts || to_tsvector('simple', COALESCE(d.name, ''))) @@ v_query)
       AND (v_start IS NULL OR COALESCE(d.date, d.created_at::date) >= v_start)
       AND (v_end IS NULL OR COALESCE(d.date, d.created_at::date) <= v_end)
     ORDER BY 4 DESC, d.created_at DESC
     LIMIT v_per_table)
    UNION ALL
    (SELECT b.id, 'inbox'::text, COALESCE(b.display_name, b.file_name),
            CASE WHEN v_query IS NULL THEN 0 ELSE ts_rank(b.fts, v_query) END::double precision,
            b.created_at, to_jsonb(b) - 'fts'
     FROM public.inbox b
     WHERE 'inbox' = ANY (v_types)
       AND b.team_id = v_team
       AND b.status IS DISTINCT FROM 'deleted'
       AND (v_query IS NULL OR b.fts @@ v_query)
       AND (v_start IS NULL OR COALESCE(b.date, b.created_at::date) >= v_start)
       AND (v_end IS NULL OR COALESCE(b.date, b.created_at::date) <= v_end)
       AND (v_amount IS NULL OR abs(b.amount) = abs(v_amount))
       AND (v_amount_min IS NULL OR abs(b.amount) >= v_amount_min)
       AND (v_amount_max IS NULL OR abs(b.amount) <= v_amount_max)
       AND (v_currency IS NULL OR upper(b.currency) = v_currency)
     ORDER BY 4 DESC, b.created_at DESC
     LIMIT v_per_table)
  ) r
  ORDER BY r.relevance DESC, r.created_at DESC
  LIMIT v_limit;
END;
$$;--> statement-breakpoint

------------------------------------------------------------------------------
-- Triggers the application depends on
------------------------------------------------------------------------------

-- transaction_categories.slug is part of the primary key and the app
-- inserts user categories without one ("Generated in database").
CREATE OR REPLACE FUNCTION public.slugify(value text)
RETURNS text
LANGUAGE sql
STABLE STRICT
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(lower(unaccent(value)), '[''"]+', '', 'g'),
      '[^a-z0-9_-]+', '-', 'g'
    ),
    '(^-+|-+$)', '', 'g'
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.generate_slug_from_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.slugify(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS generate_category_slug ON public.transaction_categories;--> statement-breakpoint
CREATE TRIGGER generate_category_slug
  BEFORE INSERT ON public.transaction_categories
  FOR EACH ROW EXECUTE FUNCTION public.generate_slug_from_name();--> statement-breakpoint

-- transactions -> transaction_categories has no ON DELETE action; deleting a
-- category un-categorizes its transactions first.
CREATE OR REPLACE FUNCTION public.update_transactions_on_category_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.transactions
  SET category_slug = NULL
  WHERE category_slug = OLD.slug
    AND team_id = OLD.team_id;
  RETURN OLD;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_update_transactions_category ON public.transaction_categories;--> statement-breakpoint
CREATE TRIGGER trigger_update_transactions_category
  BEFORE DELETE ON public.transaction_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_transactions_on_category_delete();--> statement-breakpoint

-- Base-currency amounts for bank accounts and inbox items. Rows written
-- without a base value get one from the team's base currency and
-- exchange_rates; values the app sets explicitly are kept. Transactions get
-- no trigger: the Supabase one was a silent no-op (it referenced
-- base_balance), so report queries treat a NULL base_amount as "not in base
-- currency" and the worker fills base amounts explicitly.
CREATE OR REPLACE FUNCTION public.convert_to_team_base(
  p_team_id uuid,
  p_amount numeric,
  p_currency text,
  OUT base_amount numeric,
  OUT base_currency text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_team_currency text;
  v_rate numeric;
BEGIN
  SELECT t.base_currency INTO v_team_currency FROM public.teams t WHERE t.id = p_team_id;

  IF p_amount IS NULL OR v_team_currency IS NULL OR p_currency IS NULL
     OR upper(p_currency) = upper(v_team_currency) THEN
    base_amount := p_amount;
    base_currency := COALESCE(p_currency, v_team_currency);
    RETURN;
  END IF;

  SELECT er.rate INTO v_rate
  FROM public.exchange_rates er
  WHERE er.base = upper(p_currency) AND er.target = upper(v_team_currency)
  LIMIT 1;

  IF v_rate IS NULL THEN
    base_amount := NULL;
    base_currency := NULL;
  ELSE
    base_amount := round(p_amount * v_rate, 2);
    base_currency := v_team_currency;
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calculate_bank_account_base_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  converted record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.base_balance IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.base_balance IS DISTINCT FROM OLD.base_balance THEN
    RETURN NEW;
  END IF;

  SELECT * INTO converted FROM public.convert_to_team_base(NEW.team_id, NEW.balance, NEW.currency);
  NEW.base_balance := converted.base_amount;
  NEW.base_currency := converted.base_currency;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_calculate_bank_account_base_balance_before_insert ON public.bank_accounts;--> statement-breakpoint
CREATE TRIGGER trigger_calculate_bank_account_base_balance_before_insert
  BEFORE INSERT ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.calculate_bank_account_base_balance();--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_calculate_bank_account_base_balance_before_update ON public.bank_accounts;--> statement-breakpoint
CREATE TRIGGER trigger_calculate_bank_account_base_balance_before_update
  BEFORE UPDATE OF balance ON public.bank_accounts
  FOR EACH ROW WHEN (OLD.balance IS DISTINCT FROM NEW.balance)
  EXECUTE FUNCTION public.calculate_bank_account_base_balance();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.calculate_inbox_base_amount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  converted record;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.base_amount IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.base_amount IS DISTINCT FROM OLD.base_amount THEN
    RETURN NEW;
  END IF;

  SELECT * INTO converted FROM public.convert_to_team_base(NEW.team_id, NEW.amount, NEW.currency);
  NEW.base_amount := converted.base_amount;
  NEW.base_currency := converted.base_currency;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_calculate_inbox_base_amount_before_insert ON public.inbox;--> statement-breakpoint
CREATE TRIGGER trigger_calculate_inbox_base_amount_before_insert
  BEFORE INSERT ON public.inbox
  FOR EACH ROW EXECUTE FUNCTION public.calculate_inbox_base_amount();--> statement-breakpoint

DROP TRIGGER IF EXISTS trigger_calculate_inbox_base_amount_before_update ON public.inbox;--> statement-breakpoint
CREATE TRIGGER trigger_calculate_inbox_base_amount_before_update
  BEFORE UPDATE ON public.inbox
  FOR EACH ROW WHEN (OLD.amount IS DISTINCT FROM NEW.amount OR OLD.currency IS DISTINCT FROM NEW.currency)
  EXECUTE FUNCTION public.calculate_inbox_base_amount();--> statement-breakpoint

-- Every better-auth user gets a Midday profile row (public.users), as the
-- Supabase handle_new_user trigger did for auth.users.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, avatar_url, email)
  VALUES (NEW.id, NULLIF(NEW.name, ''), NEW.image, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth."user";--> statement-breakpoint
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth."user"
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
