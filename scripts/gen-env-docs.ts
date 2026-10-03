#!/usr/bin/env bun
/**
 * Generates docs/env-reference.md from the Varlock `.env.schema` files, so the
 * reference can't drift from the schemas the apps validate at startup.
 *
 *   bun scripts/gen-env-docs.ts           write docs/env-reference.md
 *   bun scripts/gen-env-docs.ts --check   exit 1 when the file is out of date
 *
 * Parsed per key: the comment block directly above `KEY=value` (description),
 * `@tag(...)`, `@type=...`, `@required`, `@sensitive`, `@example=...`,
 * `@docs(...)`, plus the default value. The root `.env.schema` wins when a key
 * is declared in more than one file; otherwise the first file found wins.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const outFile = join(root, "docs", "env-reference.md");

type Entry = {
  key: string;
  description: string;
  tags: string[];
  type?: string;
  required: boolean;
  sensitive: boolean;
  example?: string;
  docs?: string;
  defaultValue: string;
  source: string;
};

const SECTIONS: [tag: string, title: string, blurb: string][] = [
  ["core", "Core", "URLs, secrets and instance behaviour."],
  ["db", "Database", "Postgres (with pgvector and pg_trgm)."],
  ["redis", "Redis / Valkey", "Cache and BullMQ queues."],
  ["auth", "Authentication", "better-auth, served by the API at `API_URL/auth/*`."],
  ["storage", "Storage", "Local volume or any S3-compatible store."],
  ["mail", "Mail", "Outbound SMTP, inbound IMAP / webhook."],
  ["ai", "AI (optional)", "Disabled until a provider is configured. See docs/ai.md."],
  ["banking", "Banking (optional)", "Each provider is enabled when its keys are set."],
  ["integrations", "Integrations (optional)", "OAuth apps and messaging channels."],
  ["observability", "Observability", "Logging, Sentry, analytics."],
];

function findSchemas(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findSchemas(p, out);
    else if (e.name === ".env.schema") out.push(p);
  }
  return out;
}

function parseSchema(file: string): Entry[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const source = relative(root, file);
  const entries: Entry[] = [];
  let block: string[] = [];
  let inHeader = true;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (inHeader) {
      if (line === "# ---") inHeader = false;
      continue;
    }
    if (line.startsWith("#")) {
      block.push(line.replace(/^#\s?/, ""));
      continue;
    }
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) {
      entries.push(toEntry(m[1]!, m[2]!, block, source));
    }
    block = [];
  }
  return entries;
}

function toEntry(
  key: string,
  defaultValue: string,
  block: string[],
  source: string,
): Entry {
  const description: string[] = [];
  const decorators: string[] = [];
  for (const l of block) {
    if (l.trimStart().startsWith("@")) decorators.push(l);
    else if (!/^-{3,}$/.test(l.trim())) description.push(l);
  }
  const deco = decorators.join(" ");
  const tags = [...deco.matchAll(/@tag\(([^)]*)\)/g)].map((t) => t[1]!.trim());
  const type = deco.match(/@type=((?:[a-z]+\([^)]*\))|\S+)/)?.[1];
  const example = deco.match(/@example=("[^"]*"|\S+)/)?.[1]?.replace(/^"|"$/g, "");
  const docs = deco.match(/@docs\(([^)]*)\)/)?.[1];

  return {
    key,
    // Collapse the hard-wrapped comment into paragraphs; keep indented lines
    // (provider examples) as-is inside a code block.
    description: formatDescription(description),
    tags,
    type,
    required: /@required\b/.test(deco),
    sensitive: /@sensitive\b/.test(deco),
    example,
    docs,
    defaultValue: defaultValue.trim(),
    source,
  };
}

function formatDescription(lines: string[]): string {
  const out: string[] = [];
  let para: string[] = [];
  let code: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(para.join(" "));
    para = [];
  };
  const flushCode = () => {
    if (code.length) out.push(`\`\`\`\n${code.join("\n")}\n\`\`\``);
    code = [];
  };
  for (const l of lines) {
    if (/^\s{2,}\S/.test(l) || (code.length && l.trim() && /^\s/.test(l))) {
      flushPara();
      code.push(l);
    } else if (!l.trim()) {
      flushPara();
      flushCode();
    } else {
      flushCode();
      para.push(l.trim());
    }
  }
  flushPara();
  flushCode();
  return out.join("\n\n").trim();
}

function collect(): Entry[] {
  const files = findSchemas(root).sort((a, b) => {
    const ra = a === join(root, ".env.schema") ? 0 : 1;
    const rb = b === join(root, ".env.schema") ? 0 : 1;
    return ra - rb || a.localeCompare(b);
  });
  const byKey = new Map<string, Entry>();
  for (const f of files) {
    for (const e of parseSchema(f)) {
      const existing = byKey.get(e.key);
      if (!existing) {
        byKey.set(e.key, e);
        continue;
      }
      // Fill gaps from later declarations (e.g. a package that adds a tag).
      if (!existing.description && e.description) existing.description = e.description;
      if (!existing.tags.length) existing.tags = e.tags;
    }
  }
  return [...byKey.values()];
}

function cell(e: Entry): string {
  const parts: string[] = [];
  if (e.required) parts.push("**required**");
  if (e.sensitive) parts.push("secret");
  if (e.type) parts.push(`type \`${e.type}\``);
  if (e.defaultValue) parts.push(`default \`${e.defaultValue}\``);
  if (e.example) parts.push(`e.g. \`${e.example}\``);
  return parts.join(" · ");
}

function render(entries: Entry[]): string {
  const out: string[] = [
    "<!-- Generated by scripts/gen-env-docs.ts from the .env.schema files. Do not edit. -->",
    "",
    "# Environment reference",
    "",
    "Every setting is declared in a [Varlock](https://varlock.dev) `.env.schema`: the root `.env.schema` holds shared keys, and each app or package has its own for the keys only it reads. This page is generated from those files (`bun run docs:env`); CI fails when it is stale.",
    "",
    "Set values in `deploy/.env` (Docker Compose passes the whole file to every service) or in a gitignored `.env` at the repo root for development. Optional services switch on when their keys are present. Secrets are marked, and Varlock redacts them in logs.",
    "",
    "Keys you will usually set first: `APP_URL`, `API_URL`, then the secrets that `deploy/generate-secrets.sh` creates for you.",
    "",
  ];

  const used = new Set<string>();
  const sectionFor = (e: Entry) =>
    SECTIONS.find(([tag]) => e.tags.includes(tag));

  for (const [tag, title, blurb] of SECTIONS) {
    const list = entries.filter((e) => !used.has(e.key) && e.tags.includes(tag));
    if (!list.length) continue;
    list.forEach((e) => used.add(e.key));
    out.push(`## ${title}`, "", blurb, "");
    for (const e of list) out.push(...renderEntry(e));
  }

  const rest = entries.filter((e) => !used.has(e.key) && !sectionFor(e));
  if (rest.length) {
    out.push("## Per-service settings", "", "Keys read by a single app (ports, rate limits, job-board credentials, kill switches).", "");
    for (const e of rest) out.push(...renderEntry(e));
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function renderEntry(e: Entry): string[] {
  const lines = [`### \`${e.key}\``, ""];
  const meta = cell(e);
  if (meta) lines.push(meta, "");
  if (e.description) lines.push(e.description, "");
  if (e.docs) lines.push(`Docs: ${e.docs}`, "");
  if (e.source !== ".env.schema") lines.push(`Declared in \`${e.source}\`.`, "");
  return lines;
}

const next = render(collect());

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {}
  if (current !== next) {
    console.error(
      "docs/env-reference.md is out of date. Run `bun run docs:env` and commit the result.",
    );
    process.exit(1);
  }
  console.log("docs/env-reference.md is up to date.");
} else {
  writeFileSync(outFile, next);
  console.log(`wrote ${relative(root, outFile)} (${next.length} bytes)`);
}
