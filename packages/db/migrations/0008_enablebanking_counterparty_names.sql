-- Enable Banking transactions used to be named after the bank's free-form
-- remittance text (ING: "Naam Fluitshop Omschrijving … Iban …") even when the
-- bank reported a counterparty. Name them after the counterparty and keep the
-- old text as the description. Only rows whose name still contains the
-- counterparty are touched, so names edited by hand stay as they are.
UPDATE "transactions" AS t
SET
  "name" = t."counterparty_name",
  "description" = COALESCE(t."description", t."name")
FROM "bank_accounts" AS a
JOIN "bank_connections" AS c ON c."id" = a."bank_connection_id"
WHERE t."bank_account_id" = a."id"
  AND c."provider" = 'enablebanking'
  AND t."counterparty_name" IS NOT NULL
  AND t."counterparty_name" <> ''
  AND t."name" <> t."counterparty_name"
  AND position(lower(t."counterparty_name") IN lower(t."name")) > 0;
