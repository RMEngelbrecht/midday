/**
 * Live smoke test against whatever AI_* env is configured:
 *   embeddings (768 dims), categorization on sample transactions, receipt extraction.
 *
 *   AI_PROVIDER=openai-compatible AI_BASE_URL=http://localhost:11444/v1 \
 *   AI_MODEL_CHAT=qwen2.5vl:3b AI_EMBEDDING_MODEL=nomic-embed-text \
 *   varlock run -- bun scripts/live-check.ts [receipt.png]
 */
import { readFile } from "node:fs/promises";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { ReceiptProcessor } from "../../documents/src/processors/receipt/receipt-processor";
import {
  embed,
  embedMany,
  getModel,
  isAIEnabled,
  isEmbeddingEnabled,
} from "../src";

const receiptPath =
  process.argv[2] ??
  new URL(
    "../../../apps/dashboard/public/images/chat-receipt-hemkop.png",
    import.meta.url,
  ).pathname;

console.log(
  "AI enabled:",
  isAIEnabled(),
  "| embeddings:",
  isEmbeddingEnabled(),
);

// 1. Embeddings
const one = await embed("software subscription");
const many = await embedMany(["travel", "office supplies", "meals"]);
console.log(
  `embeddings: model=${one.model} single=${one.embedding.length} dims, batch=${many.embeddings.map((e) => e.length).join(",")} dims`,
);

// 2. Categorization
const categories = [
  "software",
  "travel",
  "meals",
  "office-supplies",
  "rent",
] as const;
const { object } = await generateObject({
  model: getModel("fast"),
  output: "array",
  schema: z.object({
    merchant: z.string(),
    category: z.enum(categories),
  }),
  temperature: 0.1,
  prompt: `Identify the merchant legal name and pick the best category (${categories.join(", ")}) for each transaction, in order:
1. "GITHUB.COM *COPILOT" 19.00 USD
2. "SJ AB TRAIN STOCKHOLM-MALMO" 640.00 SEK
3. "STARBUCKS #1234 SEATTLE" 6.45 USD`,
});
console.log("categorization:", JSON.stringify(object));

// 3. Receipt extraction through the real extraction engine
const bytes = await readFile(receiptPath);
const server = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(bytes, { headers: { "content-type": "image/png" } }),
});
const started = Date.now();
const result = await new ReceiptProcessor().getReceipt({
  documentUrl: `http://localhost:${server.port}/receipt.png`,
  mimetype: "image/png",
});
server.stop();
console.log(
  `receipt extraction (${Date.now() - started}ms):`,
  JSON.stringify(result),
);
