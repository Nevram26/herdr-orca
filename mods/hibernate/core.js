// What runs in a terminal, how to stop it, and how to start it again.
import { hc, exec, home, readTextFile, window } from "herdr";

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "xonsh", "pwsh", "powershell", "cmd", "login"]);
// Either slash; Windows names lose ".exe".
const base = (s) => String(s ?? "").split(/[\\/]/).pop().replace(/^-/, "").replace(/\.exe$/i, "");
const isShell = (s) => SHELLS.has(base(s));
const windows = () => window()?.platform === "windows";
// A PowerShell string literal (it also takes curly quotes as quotes).
const psq = (s) => `'${String(s).replace(/['‘’‚‛]/g, "$&$&")}'`;
const powershell = (script) => exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);

// Windows: one process list for every call made within a second (a pass reads all terminals at once).
let snapshot = null;
function processes() {
  if (snapshot && Date.now() - snapshot.at < 1000) return snapshot.list;
  const list = powershell("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine | Select-Object ProcessId,ParentProcessId,Name,CommandLine)")
    .then((r) => JSON.parse(r.stdout))
    .catch(() => []);
  snapshot = { at: Date.now(), list };
  return list;
}

// A Windows command line as argv. An agent behind a launcher (node codex.js, cmd /c codex.cmd)
// counts as that agent: ["codex", ...its arguments].
function argvOf(line) {
  const argv = (String(line ?? "").match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((s) => s.replace(/"/g, ""));
  const agent = (a) => base(a).replace(/\.(js|cmd|ps1)$/i, "");
  const i = argv.findIndex((a, j) => j > 0 && ["claude", "codex"].includes(agent(a)));
  return i > 0 ? [agent(argv[i]), ...argv.slice(i + 1)] : argv;
}

export async function get(address) {
  const r = await hc(["get", "--json", address]).catch(() => null);
  if (!r || r.code !== 0) return null;
  let g;
  try {
    g = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  // Windows: the core names the shell as the foreground even while it runs a program,
  // so that program is the shell's child (not its console host).
  const f = g.foreground;
  if (windows() && g.state === "live" && f?.pid === g.pid && isShell(f.argv?.[0] ?? f.name)) {
    const kid = (await processes()).find((p) => p.ParentProcessId === g.pid && !/^(conhost|OpenConsole)\.exe$/i.test(p.Name));
    if (kid) g.foreground = { pid: kid.ProcessId, name: kid.Name, argv: argvOf(kid.CommandLine), cwd: f.cwd };
  }
  return g;
}

export async function list() {
  const r = await hc(["ls", "--json"]).catch(() => null);
  try {
    return JSON.parse(r?.stdout ?? "").terminals ?? [];
  } catch {
    return [];
  }
}

// The program running in a terminal now, or null for an idle shell.
export function program(g) {
  const f = g?.foreground;
  if (!f || g.state !== "live") return null;
  if (f.pid === g.pid && isShell(f.argv?.[0] ?? f.name)) return null;
  return f;
}

export const idleShell = (g) => g?.state === "live" && !!g.foreground && program(g) === null;

function kind(g, f) {
  const app = g.status?.app;
  const b = base(f.argv?.[0]);
  if (app === "claude-code" || b === "claude") return "claude";
  if (app === "codex" || b === "codex") return "codex";
  return "program";
}

async function claudeSession(pid) {
  const text = await readTextFile(`${home()}/.claude/sessions/${pid}.json`).catch(() => null);
  try {
    return text ? JSON.parse(text).sessionId ?? null : null;
  } catch {
    return null;
  }
}

// Codex keeps its rollout file open; its name ends with the session id.
// Windows has no lsof: the newest rollout whose first line names this folder.
async function codexSession(pid, cwd) {
  if (windows()) {
    const needle = `"cwd":${JSON.stringify(cwd)}`;
    const r = await powershell(`Get-ChildItem -LiteralPath ${psq(`${home()}/.codex/sessions`)} -Recurse -Filter 'rollout-*.jsonl' | Sort-Object LastWriteTime -Descending | Select-Object -First 200 | Where-Object { (Get-Content -LiteralPath $_.FullName -TotalCount 1).IndexOf(${psq(needle)}, [StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object -First 1 -ExpandProperty Name`).catch(() => null);
    return (r?.stdout ?? "").match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl/)?.[1] ?? null;
  }
  const kids = await exec("pgrep", ["-P", String(pid)]).catch(() => null);
  const pids = [String(pid), ...(kids?.stdout ?? "").split(/\s+/).filter(Boolean)];
  const r = await exec("lsof", ["-p", pids.join(","), "-Fn"]).catch(() => null);
  const m = (r?.stdout ?? "").match(/rollout-[^\n]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl/);
  return m ? m[1] : null;
}

// A snapshot entry for a terminal, or null when it runs nothing.
export async function describe(g) {
  const f = program(g);
  if (!f) return null;
  const k = kind(g, f);
  const session = k === "claude" ? await claudeSession(f.pid) : k === "codex" ? await codexSession(f.pid, f.cwd || g.cwd) : null;
  return {
    address: g.address,
    shellPid: g.pid,
    argv: f.argv ?? [],
    cwd: f.cwd || g.cwd,
    kind: k,
    session,
    name: k === "claude" ? "Claude Code" : k === "codex" ? "Codex" : base(f.argv?.[0]) || f.name,
    status: g.status?.state ?? null,
    space: g.labels?.["herdr.space"] ?? null,
    tab: g.labels?.["herdr.tab"] ?? null,
    parent: g.parent ?? null,
  };
}

// Flags worth carrying over to a resumed agent.
const KEEP = {
  claude: { flags: ["--dangerously-skip-permissions", "--verbose"], valued: ["--model", "--permission-mode", "--add-dir", "--agent"] },
  codex: { flags: ["--dangerously-bypass-approvals-and-sandbox", "--yolo", "--search"], valued: ["--model", "-m", "--profile", "-p", "--sandbox", "-s"] },
};

function kept(argv, k) {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (KEEP[k].flags.includes(argv[i])) out.push(argv[i]);
    else if (KEEP[k].valued.includes(argv[i]) && i + 1 < argv.length) out.push(argv[i], argv[++i]);
  }
  return out;
}

export function resumeArgv(e) {
  if (e.kind === "claude") return e.session ? ["claude", ...kept(e.argv, "claude"), "--resume", e.session] : e.argv;
  if (e.kind === "codex") return ["codex", "resume", "--no-daemon", ...kept(e.argv, "codex"), e.session ?? "--last"];
  return e.argv;
}

const q = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);
// What to type into `shell`. PowerShell (Herdr's shell on Windows) has no && in 5.1.
export const commandLine = (e, shell = windows() ? "powershell" : "sh") =>
  shell === "powershell" || shell === "pwsh"
    ? `Set-Location -LiteralPath ${psq(e.cwd)}; if ($?) { & ${resumeArgv(e).map(psq).join(" ")} }`
    : `cd ${q(e.cwd)} && ${resumeArgv(e).map(q).join(" ")}`;

// Starts an entry again in its idle shell; never types into a busy one.
export async function start(e) {
  const g = await get(e.address);
  let address = e.address;
  let shell; // a new terminal gets this machine's default shell
  if (!g || g.state !== "live") {
    if (!e.space || !e.tab) return false;
    // Its terminal is gone: a new shell in the same tab.
    const r = await hc(["run", "--json", "--bg", "--keep", "--no-parent", "--cwd", e.cwd, "--label", `herdr.space=${e.space}`, "--label", `herdr.tab=${e.tab}`]).catch(() => null);
    try {
      address = JSON.parse(r?.stdout ?? "").address;
    } catch {
      return false;
    }
    if (!address) return false;
  } else if (!idleShell(g)) return false;
  else shell = base(g.foreground.argv?.[0] ?? g.foreground.name);
  const r = await hc(["send", address, commandLine(e, shell)]).catch(() => null);
  return r?.code === 0;
}

async function waitIdle(cx, address, ms) {
  for (let left = ms; left > 0; left -= 400) {
    await cx.sleep(400);
    const g = await get(address);
    if (!g || g.state !== "live" || idleShell(g)) return true;
  }
  return false;
}

// SIGTERM to the program's process group: ctrl+c (SIGINT) makes Herdr's launcher
// shell (zsh -lic '"$@"; exec "$0" -li') abort instead of returning to its prompt.
// Windows has neither signals nor that launcher: ctrl+c, and PowerShell stays.
async function term(address) {
  const g = await get(address);
  const f = program(g);
  if (!f || f.pid === g.pid) return;
  if (windows()) return void (await hc(["interrupt", address, "--timeout", "5"]).catch(() => null));
  const r = await exec("kill", ["-TERM", `-${f.pid}`]).catch(() => null);
  if (r?.code !== 0) await exec("kill", ["-TERM", String(f.pid)]).catch(() => null);
}

// Stops what runs in a terminal and leaves its shell in place.
export async function stop(cx, e) {
  if (e.kind === "claude" || e.kind === "codex") {
    if (e.status === "working" || e.status === "blocked") await hc(["interrupt", e.address, "--timeout", "5"]).catch(() => null);
    await hc(["send", e.address, e.kind === "claude" ? "/exit" : "/quit"]).catch(() => null);
    if (await waitIdle(cx, e.address, 10000)) return true;
  }
  await term(e.address);
  if (await waitIdle(cx, e.address, 5000)) return true;
  const g = await get(e.address);
  const f = program(g);
  if (f && f.pid !== g.pid) await (windows() ? exec("taskkill", ["/PID", String(f.pid), "/T", "/F"]) : exec("kill", ["-KILL", `-${f.pid}`])).catch(() => null);
  return waitIdle(cx, e.address, 3000);
}
