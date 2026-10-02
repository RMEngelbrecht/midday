-- Extensions and the helper functions that table definitions in
-- 0001_baseline depend on (column defaults and generated columns).
-- Everything here is idempotent.

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint

-- nanoid(size, alphabet, additionalBytesFactor): URL-safe random id.
-- Used as the default for user_invites.code (nanoid(24)).
CREATE OR REPLACE FUNCTION public.nanoid_optimized(size integer, alphabet text, mask integer, step integer)
RETURNS text
LANGUAGE plpgsql
VOLATILE PARALLEL SAFE
AS $$
DECLARE
  id_builder text := '';
  counter int := 0;
  bytes bytea;
  alphabet_index int;
  alphabet_array text[];
  alphabet_length int;
BEGIN
  alphabet_array := regexp_split_to_array(alphabet, '');
  alphabet_length := array_length(alphabet_array, 1);

  LOOP
    bytes := gen_random_bytes(step);
    FOR counter IN 0..step - 1 LOOP
      alphabet_index := (get_byte(bytes, counter) & mask) + 1;
      IF alphabet_index <= alphabet_length THEN
        id_builder := id_builder || alphabet_array[alphabet_index];
        IF length(id_builder) = size THEN
          RETURN id_builder;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.nanoid(
  size integer DEFAULT 21,
  alphabet text DEFAULT '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  additionalbytesfactor double precision DEFAULT 1.6
)
RETURNS text
LANGUAGE plpgsql
VOLATILE PARALLEL SAFE
AS $$
DECLARE
  alphabet_length int;
  mask int;
  step int;
BEGIN
  IF size IS NULL OR size < 1 THEN
    RAISE EXCEPTION 'The size must be defined and greater than 0!';
  END IF;

  IF alphabet IS NULL OR length(alphabet) = 0 OR length(alphabet) > 255 THEN
    RAISE EXCEPTION 'The alphabet can''t be undefined, zero or bigger than 255 symbols!';
  END IF;

  IF additionalbytesfactor IS NULL OR additionalbytesfactor < 1 THEN
    RAISE EXCEPTION 'The additional bytes factor can''t be less than 1!';
  END IF;

  alphabet_length := length(alphabet);
  mask := (2 << cast(floor(log(alphabet_length - 1) / log(2)) AS int)) - 1;
  step := cast(ceil(additionalbytesfactor * mask * size / alphabet_length) AS int);

  IF step > 1024 THEN
    step := 1024;
  END IF;

  RETURN public.nanoid_optimized(size, alphabet, mask, step);
END
$$;--> statement-breakpoint

-- generate_inbox(size): lowercase alphanumeric id, default for teams.inbox_id.
CREATE OR REPLACE FUNCTION public.generate_inbox(size integer)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  characters text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  bytes bytea := gen_random_bytes(size);
  l int := length(characters);
  i int := 0;
  output text := '';
BEGIN
  WHILE i < size LOOP
    output := output || substr(characters, get_byte(bytes, i) % l + 1, 1);
    i := i + 1;
  END LOOP;
  RETURN output;
END;
$$;--> statement-breakpoint

-- Used by the generated inbox.fts column.
CREATE OR REPLACE FUNCTION public.extract_product_names(products_json json)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT string_agg(value, ',')
  FROM json_array_elements_text(
    CASE WHEN json_typeof(products_json) = 'array' THEN products_json ELSE '[]'::json END
  ) AS arr(value);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.generate_inbox_fts(display_name_text text, product_names text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_tsvector(
    'english'::regconfig,
    coalesce(display_name_text, '') || ' ' || coalesce(product_names, '')
  );
$$;
