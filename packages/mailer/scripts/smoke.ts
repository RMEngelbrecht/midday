/**
 * Sends every email template through the SMTP driver and verifies delivery via
 * Mailpit's API. Usage (Mailpit on smtp 1045 / api 8045):
 *
 *   SMTP_URL=smtp://localhost:1045 APP_URL=https://app.example.test \
 *   MAILPIT_API=http://localhost:8045 varlock run -- bun scripts/smoke.ts
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ENV } from "../src/env";
import { send } from "../src/index";

const emailsDir = join(import.meta.dir, "../../email/emails");
const api = process.env.MAILPIT_API ?? "http://localhost:8045";
const appUrl = ENV.APP_URL;

if (!ENV.SMTP_URL) throw new Error("SMTP_URL must be set");

await fetch(`${api}/api/v1/messages`, { method: "DELETE" });

const templates = readdirSync(emailsDir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(".tsx", ""))
  .sort();

for (const name of templates) {
  const mod = await import(join(emailsDir, `${name}.tsx`));
  const Template = mod.default;
  const result = await send({
    to: "smoke@example.com",
    subject: `smoke:${name}`,
    react: Template({ locale: "en" }),
  });
  if (result.driver !== "smtp")
    throw new Error(`${name}: driver ${result.driver}`);
}

const list = await (await fetch(`${api}/api/v1/messages?limit=200`)).json();
const subjects = new Set<string>(list.messages.map((m: any) => m.Subject));
let failures = 0;

for (const name of templates) {
  if (!subjects.has(`smoke:${name}`)) {
    console.log(`MISSING ${name}`);
    failures++;
  }
}

let imgChecked = 0;
for (const message of list.messages) {
  const full = await (
    await fetch(`${api}/api/v1/message/${message.ID}`)
  ).json();
  const imgs: string[] = [
    ...(full.HTML as string).matchAll(/<img[^>]+src="([^"]+)"/g),
  ].map((m) => m[1] as string);
  for (const src of imgs) {
    imgChecked++;
    if (
      src.includes("midday.ai") ||
      (src.startsWith("http") && !src.startsWith(appUrl))
    ) {
      console.log(`BAD IMG ${message.Subject}: ${src}`);
      failures++;
    }
  }
  if (!full.Text?.trim()) {
    console.log(`NO TEXT PART ${message.Subject}`);
    failures++;
  }
}

console.log(
  `templates sent: ${templates.length}, received: ${list.messages.length}, images checked (all under ${appUrl}): ${imgChecked}`,
);
console.log([...subjects].sort().join("\n"));
process.exit(failures ? 1 : 0);
