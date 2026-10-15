#!/usr/bin/env node
// libraries-dev — install the Libraries.dev agent skill.
//
//   npx libraries-dev skill           install the free skill (no account)
//   npx libraries-dev skill --pro     install the Pro skill (signs you in if needed),
//                                     next to every free copy, replacing it
//   npx libraries-dev mcp             Business: connect an agent to the team MCP server
//   npx libraries-dev login           sign in (opens the browser)
//   npx libraries-dev logout          sign out
//   npx libraries-dev whoami          show sign-in status
//
// Flags:
//   --project        install into ./.claude/skills instead of ~/.claude/skills
//   --dir <path>     install into this exact folder
//   --keep-free      with --pro, leave the free skill installed alongside
//   --api <url>      API base (default https://api.libraries.dev)
//
// No dependencies — Node 18+ (built-in fetch).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import dns from "node:dns";
import net from "node:net";

// Node's fetch tries the first address DNS returns and, before Node 20, has no
// fallback: on a network with broken IPv6 every call to the API failed while
// the site loaded fine in a browser. Prefer IPv4 and race both families.
dns.setDefaultResultOrder?.("ipv4first");
net.setDefaultAutoSelectFamily?.(true);

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS_PATH = join(homedir(), ".libraries-dev.json");
const FREE_NAME = "libraries-dev";
const PRO_NAME = "libraries-pro";

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir") flags.dir = args[++i];
  else if (args[i] === "--api") flags.api = args[++i];
  else if (args[i].startsWith("--")) flags[args[i].slice(2)] = true;
  else positional.push(args[i]);
}

const API = (flags.api || process.env.LIBRARIES_API || "https://api.libraries.dev").replace(/\/$/, "");

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const die = (msg) => { console.error(c.red("✗ ") + msg); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (typeof fetch !== "function") {
  die(`libraries-dev needs Node 18 or newer (this is ${process.version}). Update Node and run it again.`);
}

// Every API call goes through here so a failure says what actually happened:
// no connection, a firewall or proxy answering instead of the API, or a rate
// limit. All of them used to read "couldn't reach api.libraries.dev".
async function api(path, init, what) {
  let res;
  try {
    res = await fetch(API + path, init);
  } catch (e) {
    const cause = e?.cause;
    const code = cause?.code || cause?.errors?.[0]?.code || cause?.message || e?.message || "unknown error";
    die(`${what}: couldn't connect to ${API} (${code}). Check your connection, VPN or proxy and try again.`);
  }
  if (res.status === 429) die(`${what}: too many attempts. Wait a minute and try again.`);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not our API answering */ }
  if (data === null) {
    die(`${what}: ${API} answered ${res.status} with a page instead of the API. A firewall, VPN, proxy or browser check is in the way; try another network, or email jakubja@gmail.com.`);
  }
  return { res, data };
}

function loadCreds() {
  try { return JSON.parse(readFileSync(CREDS_PATH, "utf8")); } catch { return null; }
}
function saveCreds(obj) { writeFileSync(CREDS_PATH, JSON.stringify(obj, null, 2), { mode: 0o600 }); }

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  // `start` is a cmd builtin, not a program; and a missing opener must not
  // crash sign-in, since the link is printed for the user anyway.
  const [bin, argv] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : [cmd, [url]];
  try {
    const child = spawn(bin, argv, { stdio: "ignore", detached: true });
    child.on("error", () => { /* user opens it */ });
    child.unref();
  } catch { /* user opens it */ }
}

// Where skills live: ~/.claude/skills by default, ./.claude/skills with
// --project, or an exact folder with --dir (then the name is not appended).
function skillsBase() {
  return flags.project ? join(process.cwd(), ".claude", "skills") : join(homedir(), ".claude", "skills");
}
function skillDir(name) {
  return flags.dir ? resolve(flags.dir) : join(skillsBase(), name);
}

// Only ever remove a folder that holds one of our own skills.
function isOurSkill(dir, name) {
  try { return new RegExp(`^name:\\s*${name}\\s*$`, "m").test(readFileSync(join(dir, "SKILL.md"), "utf8")); }
  catch { return false; }
}

// Every place the free skill is installed. `npx skills add` writes into the
// folder of each agent it targets (.agents/skills for Cursor and friends,
// .claude/skills, .codex/skills, ~/.config/agents/skills, ...), sometimes as
// a symlink to one shared copy. Rather than keep a list of agents, look for
// <dot-folder>/skills/libraries-dev and <dot-folder>/<sub>/skills/libraries-dev
// under the project and the home folder, and keep the ones that really are
// our skill (checked by the name in their SKILL.md).
function findInstalls(name) {
  const found = new Map(); // realpath -> [paths that point at it]
  const consider = (dir) => {
    if (!existsSync(join(dir, "SKILL.md")) || !isOurSkill(dir, name)) return;
    let real = dir;
    try { real = realpathSync(dir); } catch { /* keep the path */ }
    if (!found.has(real)) found.set(real, []);
    found.get(real).push(dir);
  };
  const scan = (base) => {
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.name.startsWith(".") || e.name === ".git" || !(e.isDirectory() || e.isSymbolicLink())) continue;
      const top = join(base, e.name);
      consider(join(top, "skills", name));
      let subs = [];
      try { subs = readdirSync(top, { withFileTypes: true }); } catch { continue; }
      for (const sub of subs) {
        if (sub.name === "skills" || sub.name === "node_modules" || !(sub.isDirectory() || sub.isSymbolicLink())) continue;
        consider(join(top, sub.name, "skills", name));
      }
    }
  };
  scan(process.cwd());
  if (resolve(process.cwd()) !== resolve(homedir())) scan(homedir());
  return found;
}

// Remove one installed copy: a symlink is unlinked, a real folder deleted.
function removeInstall(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    else rmSync(path, { recursive: true, force: true });
    return true;
  } catch { return false; }
}

// ── free ─────────────────────────────────────────────────────────────────────

function installFree() {
  const src = join(PKG_DIR, "skill");
  if (!existsSync(join(src, "SKILL.md"))) die("The bundled skill is missing from this package. Reinstall libraries-dev.");
  const dest = skillDir(FREE_NAME);
  if (existsSync(dest) && !isOurSkill(dest, FREE_NAME) && !flags.dir) {
    die(`${dest} exists and is not the Libraries.dev skill. Pass --dir to choose another folder.`);
  }
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  log(c.green("✓ ") + `Installed the ${c.bold("Libraries.dev")} skill → ${c.dim(dest)}`);
  log(c.dim("Reload your agent's skills, then ask it to \"review my project for libraries.dev effects\"."));
  log(c.dim("Pro members: `npx libraries-dev skill --pro` for every Studio option and core customization."));
}

// ── pro ──────────────────────────────────────────────────────────────────────

async function ensureSignedIn() {
  let creds = loadCreds();
  if (!creds || !creds.token) {
    log("\n" + c.yellow("The Pro skill needs a Libraries Pro account — signing you in…"));
    await cmdLogin();
    creds = loadCreds();
    if (!creds || !creds.token) die("Sign-in is required.");
  }
  return creds;
}

async function installPro() {
  const creds = await ensureSignedIn();
  const { res, data } = await api("/skill/pro", { headers: { Authorization: "Bearer " + creds.token } }, "Downloading the Pro skill");
  if (res.status === 401 || res.status === 403) {
    die("Your sign-in expired or your Pro plan isn't active. Run `npx libraries-dev login` again.");
  }
  if (!res.ok) die(`The Pro skill isn't available right now (${res.status}). Try again later.`);
  const { files, version } = data;
  if (!Array.isArray(files) || !files.some((f) => f.path === "SKILL.md")) die("The Pro skill came back empty.");

  // Where Pro goes: an explicit --dir or --project wins; otherwise next to
  // every free copy, in the same agents' folders, so Cursor, Codex and the
  // rest keep a skill after the upgrade; with no free copy, ~/.claude/skills.
  const free = findInstalls(FREE_NAME);
  let targets;
  if (flags.dir || flags.project) {
    targets = [skillDir(PRO_NAME)];
  } else {
    const dirs = new Set();
    for (const paths of free.values()) for (const p of paths) dirs.add(join(dirname(p), PRO_NAME));
    targets = dirs.size ? [...dirs] : [skillDir(PRO_NAME)];
  }

  for (const dest of targets) {
    if (existsSync(dest) && !isOurSkill(dest, PRO_NAME) && !flags.dir) {
      die(`${dest} exists and is not the Libraries Pro skill. Pass --dir to choose another folder.`);
    }
  }
  for (const dest of targets) {
    removeInstall(dest);
    let wrote = 0;
    for (const f of files) {
      // Paths come from our API, but never let one climb out of the skill folder.
      const out = resolve(dest, f.path);
      if (!out.startsWith(resolve(dest) + sep)) continue;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, f.text);
      wrote++;
    }
    log(c.green("✓ ") + `Installed the ${c.bold("Libraries Pro")} skill ${c.blue(`(v${version}, ${wrote} files)`)} → ${c.dim(dest)}`);
  }

  // The Pro skill covers everything the free one does; two skills answering
  // the same requests would fight, so every free copy goes unless asked not to.
  if (!flags["keep-free"]) {
    for (const paths of free.values()) {
      for (const p of paths) {
        if (removeInstall(p)) log(c.dim(`Removed the free skill at ${p}; Pro includes it.`));
      }
    }
    if (free.size) log(c.dim("(--keep-free keeps the free skill alongside.)"));
  }
  log(c.dim("Reload your agent's skills to pick it up. Run this again after updates."));
}

// ── auth ─────────────────────────────────────────────────────────────────────

async function cmdLogin() {
  const token = await deviceSignIn(["skill"]);
  saveCreds({ ...(loadCreds() || {}), token, api: API, saved_at: Date.now() });
  log("\n" + c.green("✓ Signed in."));
}

// Browser sign-in through the device flow; resolves to the API token.
// `variants` tells the API what the token is for: "skill" for the Pro skill,
// "mcp" for the Business team server (a longer-lived token, Business only).
async function deviceSignIn(variants) {
  const { res: startRes, data: start } = await api("/device/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variants }),
  }, "Starting sign-in");
  if (!start.user_code || !start.device_secret) {
    die(`Starting sign-in: the API answered ${startRes.status} (${start.error || "no sign-in code"}). Try again in a minute.`);
  }

  log("\n" + c.bold("To sign in, open this page and confirm the code:"));
  log("  " + c.blue(start.verification_uri));
  log("  code  " + c.bold(start.user_code) + "\n");
  log(c.dim("Opening your browser…"));
  openBrowser(start.verification_uri);

  const interval = (start.interval || 3) * 1000;
  const deadline = Date.now() + (start.expires_in || 900) * 1000;
  process.stdout.write(c.dim("Waiting for approval"));
  while (Date.now() < deadline) {
    await sleep(interval);
    process.stdout.write(c.dim("."));
    let r;
    try {
      r = await (await fetch(`${API}/device/token?device_secret=${encodeURIComponent(start.device_secret)}`)).json();
    } catch { continue; }
    if (r.status === "approved" && r.download_token) return r.download_token;
    if (r.status === "denied" && r.reason === "no_business_seat") {
      die("\nThe team MCP server is part of Business, and this account has no Business seat. Business covers any company or team: https://libraries.dev/pro");
    }
    if (r.status === "denied") die("\nThis account doesn't have an active Libraries Pro plan. See https://libraries.dev/pro");
    if (r.status === "expired") die("\nThe sign-in request expired. Run `npx libraries-dev login` again.");
  }
  die("\nTimed out waiting for approval.");
}

// ── mcp ──────────────────────────────────────────────────────────────────────

// Business: connect coding agents to the team MCP server. Signs in for an
// MCP token, then either registers the server with Claude Code / Cursor
// (--claude, --cursor) or prints the config for any agent.
async function cmdMcp() {
  log(c.dim("The team MCP server is part of Libraries.dev Business."));
  const token = await deviceSignIn(["mcp"]);
  saveCreds({ ...(loadCreds() || {}), mcp_token: token, api: API });
  log("\n" + c.green("✓ Signed in for the team MCP server."));

  const url = API + "/mcp";
  const header = "Authorization: Bearer " + token;
  let done = false;

  if (flags.claude) {
    const r = spawnSync("claude", ["mcp", "add", "--transport", "http", "--scope", "user", "libraries-dev", url, "--header", header], { stdio: "inherit", shell: process.platform === "win32" });
    if (r.status === 0) { log(c.green("✓ ") + "Added to Claude Code as " + c.bold("libraries-dev") + "."); done = true; }
    else log(c.yellow("Couldn't run `claude mcp add`; use the command below."));
  }
  if (flags.cursor) {
    const file = join(homedir(), ".cursor", "mcp.json");
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(file, "utf8")); } catch { /* new file */ }
    cfg.mcpServers = { ...(cfg.mcpServers || {}), "libraries-dev": { url, headers: { Authorization: "Bearer " + token } } };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
    log(c.green("✓ ") + "Added to Cursor in " + c.dim(file) + ".");
    done = true;
  }

  if (!done) {
    log("\n" + c.bold("Claude Code:"));
    log("  claude mcp add --transport http --scope user libraries-dev " + url + ' --header "' + header + '"');
    log("\n" + c.bold("Cursor") + c.dim(" (~/.cursor/mcp.json), and most other agents:"));
    log(JSON.stringify({ mcpServers: { "libraries-dev": { url, headers: { Authorization: "Bearer " + token } } } }, null, 2).replace(/^/gm, "  "));
    log("\n" + c.dim("Or run again with --claude or --cursor to add it for you."));
  }
  log(c.dim("The token is personal to your seat; don't commit it. It stops working if you leave the team."));
  log(c.dim("Then ask your agent: \"use our brand kit and add a thinking orb to the chat reply\"."));
}

function cmdLogout() {
  if (existsSync(CREDS_PATH)) { rmSync(CREDS_PATH); log(c.green("✓ Signed out.")); }
  else log(c.dim("Not signed in."));
}

function cmdWhoami() {
  const creds = loadCreds();
  if (creds && creds.token) log(c.green("Signed in") + c.dim(`  (credentials in ${CREDS_PATH})`));
  else log(c.yellow("Not signed in.") + c.dim("  Run `npx libraries-dev login`."));
}

function cmdHelp() {
  log(`
${c.bold("libraries-dev")} — the Libraries.dev agent skill.

${c.bold("Commands")}
  skill                    install the free skill (no account needed)
  skill --pro              install the Pro skill (signs you in if needed) in every
                           agent folder that has the free skill, replacing it
  mcp                      Business: connect your coding agent to the team MCP server
                           (--claude or --cursor adds it for you)
  login                    sign in to Libraries Pro (opens the browser)
  logout                   sign out
  whoami                   show sign-in status

${c.bold("Options")}
  --project                install into ./.claude/skills (this repo only)
  --dir <path>             install into this exact folder
  --keep-free              with --pro, keep the free skill installed too
  --api <url>              API base (default: https://api.libraries.dev)

${c.dim("Other agents: `npx skills add Jakubantalik/Libraries.dev` installs the free skill anywhere.")}
${c.dim("Docs: https://libraries.dev/how-to-use")}`);
}

const [cmd] = positional;
(async () => {
  try {
    switch (cmd) {
      case "skill": flags.pro ? await installPro() : installFree(); break;
      case "login": await cmdLogin(); break;
      case "mcp": await cmdMcp(); break;
      case "logout": cmdLogout(); break;
      case "whoami": cmdWhoami(); break;
      case undefined:
      case "help":
      case "--help":
      case "-h": cmdHelp(); break;
      default: die(`Unknown command "${cmd}". Run \`npx libraries-dev help\`.`);
    }
  } catch (e) {
    die(e && e.message ? e.message : String(e));
  }
})();
