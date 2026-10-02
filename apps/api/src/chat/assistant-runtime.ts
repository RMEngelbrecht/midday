import {
  buildPrepareStep,
  createExecutionClient,
  ensureToolIndex,
  getSearchTool,
  getToolDefinitions,
} from "@api/chat/tools";
import { getComposioTools } from "@api/composio/client";
import type { McpContext } from "@api/mcp/types";
import { getModel, getWebSearchTool } from "@midday/ai";
import { logger } from "@midday/logger";
import {
  type ModelMessage,
  smoothStream,
  stepCountIs,
  ToolLoopAgent,
} from "ai";

export async function streamMiddayAssistant(params: {
  mcpCtx: McpContext;
  systemPrompt: string;
  modelMessages: Array<ModelMessage>;
}) {
  const { mcpCtx, systemPrompt, modelMessages } = params;

  await ensureToolIndex(mcpCtx);

  const [resolvedClient, composioMetaTools] = await Promise.all([
    createExecutionClient(mcpCtx),
    getComposioTools(mcpCtx.userId),
  ]);

  let closed = false;
  const closeClient = async () => {
    if (closed) return;
    closed = true;
    await resolvedClient.close().catch(() => {});
  };

  try {
    const mcpTools = resolvedClient.toolsFromDefinitions(getToolDefinitions());
    const composioToolNames = Object.keys(composioMetaTools);

    if (composioToolNames.length > 0) {
      logger.info("[chat] Composio tools available:", {
        tools: composioToolNames,
      });
    }

    const webSearch = getWebSearchTool({
      country: mcpCtx.countryCode ?? undefined,
      timezone: mcpCtx.timezone ?? undefined,
    });

    const agent = new ToolLoopAgent({
      model: getModel("chat"),
      instructions: systemPrompt,
      tools: {
        ...mcpTools,
        ...composioMetaTools,
        search_tools: getSearchTool(),
        ...(webSearch ? { [webSearch.name]: webSearch.tool } : {}),
      },
      prepareStep: buildPrepareStep({
        maxTools: 12,
        alwaysActive: [
          ...(webSearch ? [webSearch.name] : []),
          "search_tools",
          ...composioToolNames,
        ],
      }),
      stopWhen: stepCountIs(10),
      onFinish: closeClient,
    });

    const result = await agent.stream({
      messages: modelMessages,
      experimental_transform: smoothStream(),
    });

    return Object.assign(result, { cleanup: closeClient });
  } catch (error) {
    await closeClient();
    throw error;
  }
}
