-- Realtime change feed and document full-text search.
--
-- 1. documents.fts_simple / fts_english / fts_language were maintained by
--    something on hosted Supabase that never reached the repo. A BEFORE
--    trigger now keeps them in sync with title/summary/body/content/language.
-- 2. Supabase Realtime is replaced by NOTIFY on channel `midday_changes`,
--    which apps/api LISTENs on and fans out over SSE (GET /realtime).
--    Payloads carry ids plus a few small columns the dashboard reads
--    (trigger arguments), never whole rows, so they stay far below the 8KB
--    NOTIFY limit:
--      {"table","type":"INSERT|UPDATE|DELETE","team_id","new":{...},"old":{...}}

------------------------------------------------------------------------------
-- Document full-text search
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.document_tsvector(cfg regconfig, title text, summary text, body text, content text)
RETURNS tsvector
LANGUAGE sql
STABLE
AS $$
  SELECT setweight(to_tsvector(cfg, COALESCE(title, '')), 'A')
      || setweight(to_tsvector(cfg, COALESCE(summary, '')), 'B')
      || setweight(to_tsvector(cfg, concat_ws(' ', body, left(content, 100000))), 'C');
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.documents_fts_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.fts_simple := public.document_tsvector('simple', NEW.title, NEW.summary, NEW.body, NEW.content);
  NEW.fts_english := public.document_tsvector('english', NEW.title, NEW.summary, NEW.body, NEW.content);
  NEW.fts_language := public.document_tsvector(
    public.resolve_search_config(COALESCE(NEW.language, 'english')),
    NEW.title, NEW.summary, NEW.body, NEW.content
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS documents_fts_update ON public.documents;--> statement-breakpoint
CREATE TRIGGER documents_fts_update
  BEFORE INSERT OR UPDATE OF title, summary, body, content, language ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_fts_update();--> statement-breakpoint

-- Backfill (before the notify triggers exist, so this stays silent).
UPDATE public.documents SET title = title WHERE fts_english IS NULL;--> statement-breakpoint

------------------------------------------------------------------------------
-- Realtime: row-level change notifications
------------------------------------------------------------------------------

-- TG_ARGV lists extra columns (besides id and team_id) to include in
-- `new`/`old`. Rows without a team are never broadcast.
CREATE OR REPLACE FUNCTION public.notify_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cols text[] := ARRAY['id', 'team_id'] || TG_ARGV;
  new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  team text := COALESCE(new_row, old_row) ->> 'team_id';
BEGIN
  IF team IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_notify('midday_changes', jsonb_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'team_id', team,
    'new', (SELECT COALESCE(jsonb_object_agg(c, new_row -> c), '{}'::jsonb) FROM unnest(cols) c WHERE new_row IS NOT NULL),
    'old', (SELECT COALESCE(jsonb_object_agg(c, old_row -> c), '{}'::jsonb) FROM unnest(cols) c WHERE old_row IS NOT NULL)
  )::text);

  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Statement-level variant for bulk-written tables: one event per team and
-- statement (no row ids), so a 10k-row import is one notification, not 10k.
-- The trigger must name its transition table `changed_rows`.
CREATE OR REPLACE FUNCTION public.notify_change_per_statement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  team uuid;
BEGIN
  FOR team IN SELECT DISTINCT team_id FROM changed_rows WHERE team_id IS NOT NULL LOOP
    PERFORM pg_notify('midday_changes', jsonb_build_object(
      'table', TG_TABLE_NAME,
      'type', TG_OP,
      'team_id', team,
      'new', jsonb_build_object('team_id', team),
      'old', '{}'::jsonb
    )::text);
  END LOOP;

  RETURN NULL;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change ON public.inbox;--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.inbox
  FOR EACH ROW EXECUTE FUNCTION public.notify_change('status');--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change ON public.documents;--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.notify_change('processing_status');--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change ON public.customers;--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.notify_change('enrichment_status');--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change ON public.activities;--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.notify_change('user_id', 'priority', 'status');--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change ON public.insights;--> statement-breakpoint
CREATE TRIGGER notify_change AFTER INSERT OR UPDATE OR DELETE ON public.insights
  FOR EACH ROW EXECUTE FUNCTION public.notify_change('status');--> statement-breakpoint

-- Transition tables need one trigger per event.
DROP TRIGGER IF EXISTS notify_change_insert ON public.transactions;--> statement-breakpoint
CREATE TRIGGER notify_change_insert AFTER INSERT ON public.transactions
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_change_per_statement();--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change_update ON public.transactions;--> statement-breakpoint
CREATE TRIGGER notify_change_update AFTER UPDATE ON public.transactions
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_change_per_statement();--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_change_delete ON public.transactions;--> statement-breakpoint
CREATE TRIGGER notify_change_delete AFTER DELETE ON public.transactions
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_change_per_statement();
