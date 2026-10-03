// Builds the desktop app with an opt-in auto-update feed.
//
//   MIDDAY_UPDATER_REPO=owner/repo \
//   MIDDAY_UPDATER_PUBKEY="<tauri signer public key>" \
//   TAURI_SIGNING_PRIVATE_KEY=... bun run tauri:build:release
//
// The feed is the fork's GitHub Releases `latest.json`. Without
// MIDDAY_UPDATER_REPO the app is built with no updater (use `bun run tauri:build`).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.env.MIDDAY_UPDATER_REPO;
const pubkey = process.env.MIDDAY_UPDATER_PUBKEY;

if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !pubkey) {
  console.error(
    "Set MIDDAY_UPDATER_REPO=owner/repo and MIDDAY_UPDATER_PUBKEY to build with auto-update, or run `bun run tauri:build` for a build without updates.",
  );
  process.exit(1);
}

const overlay = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey,
      endpoints: [
        `https://github.com/${repo}/releases/latest/download/latest.json`,
      ],
    },
  },
};

const file = join(mkdtempSync(join(tmpdir(), "midday-updater-")), "tauri.updater.conf.json");
writeFileSync(file, JSON.stringify(overlay, null, 2));

const result = spawnSync("bunx", ["tauri", "build", "--config", file, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
