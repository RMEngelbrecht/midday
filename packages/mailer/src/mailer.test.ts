import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { resolveDefaultFrom, resolveFrom } from "./address";
import {
  createConsoleDriver,
  createSmtpDriver,
  formatConsoleMessage,
  selectDriver,
} from "./drivers";
import { createMailer } from "./mailer";

const Otp = ({ code }: { code: string }) =>
  createElement(
    "div",
    null,
    createElement("p", null, `Your code is ${code}`),
    createElement("a", { href: "http://localhost:3001/verify?c=1" }, "Sign in"),
  );

describe("driver selection", () => {
  test("smtp only with a connection string", () => {
    expect(selectDriver("smtp://u:p@localhost:1025")).toBe("smtp");
    expect(selectDriver("")).toBe("console");
    expect(selectDriver("  ")).toBe("console");
    expect(selectDriver(undefined)).toBe("console");
    expect(selectDriver(null)).toBe("console");
  });

  test("createMailer picks the driver from config", () => {
    expect(createMailer({}).driver).toBe("console");
    const smtp = createMailer({ smtpUrl: "smtp://localhost:1025" });
    expect(smtp.driver).toBe("smtp");
    smtp.close();
  });
});

describe("default from", () => {
  test("MAIL_FROM wins, otherwise noreply@APP_URL host", () => {
    expect(resolveDefaultFrom({ mailFrom: "Acme <a@acme.io>" })).toBe(
      "Acme <a@acme.io>",
    );
    expect(resolveDefaultFrom({ appUrl: "https://app.example.com" })).toBe(
      "Midday <noreply@app.example.com>",
    );
  });

  test("fromName keeps the default address", () => {
    expect(
      resolveFrom(
        { to: "x", subject: "s", fromName: 'Acme "Inc"' },
        "Midday <noreply@a.io>",
      ),
    ).toBe('"Acme Inc" <noreply@a.io>');
    expect(
      resolveFrom({ to: "x", subject: "s", from: "me@a.io" }, "d@a.io"),
    ).toBe("me@a.io");
  });
});

describe("console driver", () => {
  test("prints recipients, subject, readable body with OTP and link", async () => {
    const lines: string[] = [];
    const mailer = createMailer({
      driver: createConsoleDriver((t) => lines.push(t)),
      appUrl: "http://localhost:3001",
    });

    const result = await mailer.send({
      to: ["a@example.com", "b@example.com"],
      subject: "Your sign-in code",
      react: createElement(Otp, { code: "123456" }),
    });

    expect(result.driver).toBe("console");
    const out = lines.join("\n");
    expect(out).toContain("To:      a@example.com, b@example.com");
    expect(out).toContain("Subject: Your sign-in code");
    expect(out).toContain("From:    Midday <noreply@localhost>");
    expect(out).toContain("Your code is 123456");
    expect(out).toContain("http://localhost:3001/verify?c=1");
  });

  test("formatConsoleMessage lists attachments", () => {
    const out = formatConsoleMessage(
      {
        to: "a@b.c",
        subject: "S",
        text: "hi",
        attachments: [{ filename: "x.pdf" }],
      },
      "f@b.c",
    );
    expect(out).toContain("Attachments: x.pdf");
  });
});

describe("smtp driver", () => {
  test("passes rendered message to the transport", async () => {
    const sendMail = mock(() => Promise.resolve({ messageId: "<id@x>" }));
    const mailer = createMailer({
      driver: createSmtpDriver("smtp://localhost:1025", {
        sendMail,
        close: () => {},
      } as never),
      mailFrom: "Acme <a@acme.io>",
    });

    const result = await mailer.send({
      to: "u@example.com",
      subject: "Hello",
      react: createElement(Otp, { code: "999" }),
      replyTo: "r@example.com",
    });

    expect(result).toEqual({ driver: "smtp", messageId: "<id@x>" });
    const arg = (sendMail.mock.calls[0] as unknown[])[0] as Record<string, any>;
    expect(arg.from).toBe("Acme <a@acme.io>");
    expect(arg.to).toEqual(["u@example.com"]);
    expect(arg.replyTo).toBe("r@example.com");
    expect(arg.html).toContain("Your code is 999");
    expect(arg.text).toContain("Your code is 999");
  });

  test("sendMany reports failures per message", async () => {
    let n = 0;
    const sendMail = mock(() => {
      n++;
      return n === 2
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ messageId: `<${n}>` });
    });
    const mailer = createMailer({
      concurrency: 1,
      driver: createSmtpDriver("smtp://localhost:1025", {
        sendMail,
        close: () => {},
      } as never),
    });

    const res = await mailer.sendMany(
      ["a", "b", "c"].map((to) => ({
        to: `${to}@x.io`,
        subject: to,
        text: to,
      })),
    );

    expect(res.sent).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.results[1]?.ok).toBe(false);
  });
});
