import { render, toPlainText } from "@react-email/render";
import type { MailMessage } from "./types";

export type RenderedMessage = Omit<MailMessage, "react"> & {
  html?: string;
  text?: string;
};

/** Resolve `react` into `html` and a plain text fallback. */
export async function renderMessage(
  message: MailMessage,
): Promise<RenderedMessage> {
  const { react, ...rest } = message;

  if (react === undefined || react === null) {
    return {
      ...rest,
      text: rest.text ?? (rest.html ? toPlainText(rest.html) : undefined),
    };
  }

  const html = await render(react as React.ReactElement);
  return { ...rest, html, text: rest.text ?? toPlainText(html) };
}
