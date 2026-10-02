/** Minimal vision check: image bytes -> small structured object. Usage: bun scripts/vision-check.ts <image> */
import { readFile } from "node:fs/promises";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { getModel } from "../src";

const image = new Uint8Array(await readFile(process.argv[2]!));
const t = Date.now();
const { object } = await generateObject({
  model: getModel("vision"),
  schema: z.object({
    store_name: z.string(),
    total_amount: z.number(),
    currency: z.string(),
  }),
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Extract store name, total amount and currency from this receipt.",
        },
        { type: "image", image },
      ],
    },
  ],
  abortSignal: AbortSignal.timeout(500_000),
});
console.log(`vision (${Date.now() - t}ms):`, JSON.stringify(object));
