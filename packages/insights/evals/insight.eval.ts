/**
 * Eval for weekly insight quality
 *
 * Tests that generated insights are personal, well-formatted, and have appropriate tone
 */
import "dotenv/config";
import { getModel } from "@midday/ai";
import { generateText } from "ai";
import { evalite } from "evalite";
import {
  buildStoryPrompt,
  buildSummaryPrompt,
  buildTitlePrompt,
} from "../src/content/prompts/index";
import type { InsightSlots } from "../src/content/prompts/slots";
import { allFixtures } from "./fixtures";
import { allScorers } from "./scorers";

/**
 * Generate a complete insight from slots
 */
async function generateInsight(slots: InsightSlots) {
  const [title, summary, story] = await Promise.all([
    generateText({
      model: getModel("chat"),
      prompt: buildTitlePrompt(slots),
      temperature: 0.25,
    }),
    generateText({
      model: getModel("chat"),
      prompt: buildSummaryPrompt(slots),
      temperature: 0.25,
    }),
    generateText({
      model: getModel("chat"),
      prompt: buildStoryPrompt(slots),
      temperature: 0.3,
    }),
  ]);

  return {
    title: title.text.trim(),
    summary: summary.text.trim(),
    story: story.text.trim(),
  };
}

evalite("Weekly Insight Quality", {
  data: allFixtures.map((f) => ({
    input: f.slots,
    name: f.name,
  })),

  task: async (slots) => {
    return generateInsight(slots);
  },

  scorers: allScorers,
});
