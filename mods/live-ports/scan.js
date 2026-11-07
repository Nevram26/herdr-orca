// Listening TCP ports on this computer, matched to the worktree spaces they run in.
import { exec } from "herdr";

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

export async function scanPorts(spaceList, paneList) {
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
