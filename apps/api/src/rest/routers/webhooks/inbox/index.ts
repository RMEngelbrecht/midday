import { ENV } from "@api/env";
import type { Context } from "@api/rest/types";
import { createAdminClient } from "@api/services/supabase";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getInboxIdFromEmail, inboxWebhookPostSchema } from "@midday/inbox";
import { processInboundEmail } from "@midday/inbox/ingest";
import { logger } from "@midday/logger";
import { getDefaultFromAddress } from "@midday/mailer";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import { POSTMARK_IP_RANGE } from "./utils";

const app = new OpenAPIHono<Context>();

// HTTP Basic Authentication
// Postmark supports basic auth by including credentials in the webhook URL:
// https://username:password@domain.com/webhook/inbox
if (ENV.INBOX_WEBHOOK_USERNAME && ENV.INBOX_WEBHOOK_PASSWORD) {
  app.use(
    "*",
    basicAuth({
      username: ENV.INBOX_WEBHOOK_USERNAME,
      password: ENV.INBOX_WEBHOOK_PASSWORD,
    }),
  );
}

// IP address validation
app.use("*", async (c, next) => {
  if (ENV.APP_ENV === "development") {
    await next();
    return;
  }

  const clientIp = c.get("clientIp");

  logger.info("Inbox webhook IP validation", {
    clientIp,
    path: c.req.path,
    method: c.req.method,
  });

  if (!clientIp) {
    logger.warn("Inbox webhook IP validation failed - no client IP in context");
    throw new HTTPException(403, { message: "Invalid IP address" });
  }

  const isValidIp = POSTMARK_IP_RANGE.includes(
    clientIp as (typeof POSTMARK_IP_RANGE)[number],
  );

  if (!isValidIp) {
    logger.warn(
      "Inbox webhook IP validation failed - IP not in allowed range",
      {
        receivedIp: clientIp,
        allowedIps: POSTMARK_IP_RANGE,
      },
    );
    throw new HTTPException(403, { message: "Invalid IP address" });
  }

  logger.info("Inbox webhook IP validation successful", {
    validatedIp: clientIp,
  });

  await next();
});

app.openapi(
  createRoute({
    method: "post",
    path: "/",
    summary: "Inbox webhook",
    operationId: "inboxWebhook",
    description: "Webhook endpoint for receiving inbox emails from Postmark",
    tags: ["Webhooks"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z.any(), // Schema validated manually using inboxWebhookPostSchema
          },
        },
      },
    },
    responses: {
      200: {
        description: "Webhook processed successfully",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
            }),
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
              errors: z
                .array(
                  z.object({
                    path: z.string(),
                    message: z.string(),
                  }),
                )
                .optional(),
            }),
          },
        },
      },
      403: {
        description: "Invalid IP address",
      },
      500: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: z.object({
              error: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const body = await c.req.json();
    const parsedBody = inboxWebhookPostSchema.safeParse(body);

    if (!parsedBody.success) {
      const errors = parsedBody.error.issues.map((error) => ({
        path: error.path.join("."),
        message: error.message,
      }));

      return c.json(
        {
          error: "Invalid request body",
          errors,
        },
        400,
      );
    }

    const {
      MessageID,
      FromFull,
      Subject,
      Attachments,
      OriginalRecipient,
      TextBody,
      HtmlBody,
    } = parsedBody.data;

    const inboxId = getInboxIdFromEmail(OriginalRecipient);

    if (!inboxId) {
      throw new HTTPException(400, {
        message: "Invalid OriginalRecipient email",
      });
    }

    logger.info("Inbox webhook received", {
      messageId: MessageID,
      inboxId,
      senderEmail: FromFull.Email,
      attachmentCount: Attachments?.length ?? 0,
    });

    try {
      const result = await processInboundEmail(
        c.get("db"),
        {
          messageId: MessageID,
          inboxId,
          from: { name: FromFull.Name, email: FromFull.Email },
          subject: Subject,
          text: TextBody,
          html: HtmlBody,
          attachments: Attachments ?? [],
        },
        {
          storage: await createAdminClient(),
          ownAddress: getDefaultFromAddress(),
        },
      );

      if (result.status === "unknown-inbox") {
        throw new HTTPException(404, {
          message: `Team not found for inbox_id: ${inboxId}`,
        });
      }

      return c.json({ success: true });
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      logger.error("Inbox webhook processing failed", {
        inboxId,
        messageId: MessageID,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new HTTPException(500, {
        message: `Failed to process webhook for inbox_id: ${inboxId}`,
      });
    }
  },
);

export { app as inboxWebhookRouter };
