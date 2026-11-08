// Listening TCP ports on this computer, matched to the worktree spaces they run in.
import { exec, hc, terminals, window } from "herdr";

export const SHARED_KEY = "live-ports";

const cwds = new Map(); // pid -> cwd; a server's folder doesn't change while it runs
const roots = new Map(); // folder -> git toplevel, or null outside a repo

// `lsof -F` records: p<pid>, c<command>, n<address>.
function parseListeners(out) {
  const seen = new Map();
  let pid = null;
  let name = null;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") pid = Number(value);
    else if (tag === "c") name = value;
    else if (tag === "n") {
      const m = value.match(/^(.*):(\d+)$/);
      if (!m || !pid) continue;
      const port = Number(m[2]);
      const key = `${pid}:${port}`;
      if (!seen.has(key)) seen.set(key, { pid, port, name, host: m[1] });
    }
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

async function loadCwds(pids) {
  const missing = pids.filter((p) => !cwds.has(p));
  if (!missing.length) return;
  const r = await exec("lsof", ["-a", "-d", "cwd", "-F", "n", "-p", missing.join(",")]);
  let pid = null;
  for (const line of r.stdout.split("\n")) {
    if (line[0] === "p") pid = Number(line.slice(1));
    else if (line[0] === "n" && pid) cwds.set(pid, line.slice(1));
  }
  for (const p of missing) if (!cwds.has(p)) cwds.set(p, null);
}

async function gitRoot(folder) {
  if (roots.has(folder)) return roots.get(folder);
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder }).catch(() => null);
  const root = r?.code === 0 ? r.stdout.trim() : null;
  roots.set(folder, root);
  return root;
}

const inside = (path, root) => path === root || path.startsWith(`${root}/`);

// Every local space whose terminals sit in a git checkout, by checkout root.
async function spaceRoots(spaceList, paneList) {
  const out = [];
  for (const s of spaceList) {
    if (s.machine) continue;
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const folders = new Set([s.folder, ...paneList.filter((p) => tabs.has(p.tab)).map((p) => p.cwd)]);
    for (const f of folders) {
      const root = f && (await gitRoot(f));
      if (root && !out.some((o) => o.root === root)) out.push({ space: s.id, name: s.name, root });
    }
  }
  return out.sort((a, b) => b.root.length - a.root.length); // deepest checkout wins
}

// Windows: no lsof, and no way to read another process's folder. A port belongs to the
// space whose terminal started it, found through the process's ancestors.
// ponytail: servers started outside Herdr count as external, even inside a worktree.
const procs = new Map(); // pid -> { name, chain: [pid, parent, grandparent, ...] }
const shells = new Map(); // terminal address -> { pid, space, parent }

// `netstat -ano`: "TCP  [::]:3000  [::]:0  LISTENING  1234". The state word is
// localized, so a listener is told by its foreign port 0.
function parseNetstat(out) {
  const seen = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+:0\s+.*\s(\d+)$/);
    const pid = m && Number(m[3]);
    if (!pid) continue;
    const port = Number(m[2]);
    const key = `${pid}:${port}`;
    if (!seen.has(key)) seen.set(key, { pid, port, host: m[1] });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port);
}

// One process list for the new listeners only: a process's ancestors don't change.
async function loadChains(pids) {
  const missing = pids.filter((p) => !procs.has(p));
  if (!missing.length) return;
  const r = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.Name }"]);
  const all = new Map();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^(\d+) (\d+) (.+)$/);
    if (m) all.set(Number(m[1]), { ppid: Number(m[2]), name: m[3].replace(/\.exe$/i, "") });
  }
  for (const pid of missing) {
    const chain = [];
    // Windows keeps a dead parent's pid, which may be reused: stop at a loop.
    for (let p = pid; all.has(p) && !chain.includes(p); p = all.get(p).ppid) chain.push(p);
    procs.set(pid, { name: all.get(pid)?.name ?? null, chain });
  }
}

// Each live local terminal's shell pid (`hc get`, once) and space; a sub-agent's is its parent's.
async function loadShells() {
  const live = terminals().filter((t) => !t.address.includes("/") && (t.state ?? "live") === "live");
  const addrs = new Set(live.map((t) => t.address));
  for (const a of shells.keys()) if (!addrs.has(a)) shells.delete(a);
  for (const t of live) {
    if (shells.has(t.address)) continue;
    const r = await hc(["get", "--json", t.address]).catch(() => null);
    try {
      const j = JSON.parse(r.stdout);
      shells.set(t.address, { pid: j.pid ?? null, space: j.labels?.["herdr.space"] ?? null, parent: j.parent ?? null });
    } catch {}
  }
}

function shellSpace(address, seen = new Set()) {
  const s = shells.get(address);
  if (!s || seen.has(address)) return null;
  seen.add(address);
  return s.space ?? (s.parent ? shellSpace(s.parent, seen) : null);
}

async function scanWindows() {
  const listeners = parseNetstat((await exec("netstat", ["-ano"])).stdout);
  const live = new Set(listeners.map((l) => l.pid));
  for (const pid of procs.keys()) if (!live.has(pid)) procs.delete(pid);
  await loadChains([...live]);
  await loadShells();
  const spaceOfPid = new Map([...shells].map(([address, s]) => [s.pid, shellSpace(address)]));
  const bySpace = {};
  const external = [];
  for (const l of listeners) {
    const p = procs.get(l.pid);
    const space = p?.chain.map((pid) => spaceOfPid.get(pid)).find(Boolean);
    const port = { port: l.port, pid: l.pid, name: p?.name ?? `PID ${l.pid}`, address: `localhost:${l.port}` };
    if (space) (bySpace[space] ??= []).push(port);
    else external.push(port);
  }
  return { bySpace, external };
}

export async function scanPorts(spaceList, paneList) {
  if (window()?.platform === "windows") return scanWindows();
  const r = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
  const listeners = parseListeners(r.stdout);
  const live = new Set(listeners.map((l) => l.pid));
  for (const pid of cwds.keys()) if (!live.has(pid)) cwds.delete(pid);
  await loadCwds([...live]);

  const owners = await spaceRoots(spaceList, paneList);
  const bySpace = {};
  const external = [];
  for (const l of listeners) {
    const cwd = cwds.get(l.pid);
    const owner = cwd && owners.find((o) => inside(cwd, o.root));
    const port = { port: l.port, pid: l.pid, name: l.name ?? `PID ${l.pid}`, address: `localhost:${l.port}` };
    if (owner) (bySpace[owner.space] ??= []).push(port);
    else external.push(port);
  }
  return { bySpace, external };
}

export const portUrl = (p) => `http://${p.address}`;
