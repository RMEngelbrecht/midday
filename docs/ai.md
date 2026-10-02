# AI configuration

AI is optional. With no AI env set, `features.ai` is false: chat, insights, AI tax-rate lookup and natural-language search fallback are disabled/hidden, document extraction marks files processed with no extracted fields, transaction enrichment and embeddings are skipped, and CSV import maps columns by header name.

## Env

| Key | Purpose |
|---|---|
| `AI_PROVIDER` | `openai`, `openai-compatible`, `google`, `anthropic`, `mistral`. Inferred from a legacy key (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`) when unset. |
| `AI_BASE_URL`, `AI_API_KEY` | Endpoint and key. `openai-compatible` needs a base URL and `AI_MODEL_CHAT`; the key is optional. |
| `AI_MODEL_CHAT` / `_FAST` / `_VISION` / `_EXTRACTION` | Model per role. Provider defaults live in `packages/ai/src/config.ts`. `fast` and `vision` fall back to chat for openai-compatible. Extraction tries `_EXTRACTION` (if set), then `_VISION`. |
| `AI_EMBEDDING_PROVIDER` / `_BASE_URL` / `_API_KEY` / `_MODEL` | Optional separate embedding provider. |

Example (Ollama): `AI_PROVIDER=openai-compatible AI_BASE_URL=http://ollama:11434/v1 AI_MODEL_CHAT=qwen2.5vl:7b AI_EMBEDDING_MODEL=nomic-embed-text`.

## Embeddings

Vectors are stored in `vector(768)` columns, so the model must produce 768 dimensions (`nomic-embed-text`, OpenAI `text-embedding-3-*` with `dimensions`, `gemini-embedding-001`). Other sizes throw `EmbeddingDimensionError`. The `model` column records the model used; after changing `AI_EMBEDDING_MODEL`, existing rows are stale (vectors from different models are not comparable) and must be re-generated: delete the rows in `transaction_category_embeddings` / `document_tag_embeddings` and they are recreated on use. There is no automatic re-embed job.

## Documents

Files are downloaded and sent to the model as bytes. Images work with any vision model. PDFs are sent as files to openai/google/anthropic/mistral; with `openai-compatible` the embedded text layer is extracted and sent as text, so scanned PDFs need a PDF-capable provider. Domain lookup needs a provider web-search tool (openai, google) and is skipped otherwise, as is chat `web_search`.
Self-hosted models are slow on CPU, so extraction timeouts are multiplied by 15 for `openai-compatible`.
