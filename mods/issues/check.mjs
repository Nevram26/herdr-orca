// node mods/issues/check.mjs: the worktree dialog starts the right prefill helper for each
// platform and, on Windows, prefill.ps1 pastes only into the new Claude once it's past the trust
// prompt, with the task as data. Stand-ins for hc and herdr-app; it borrows the clipboard briefly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = [], copied = [];
let platform;
const known = { View: class {}, exec: async (...a) => (calls.push(a), { code: 0 }), window: () => ({ platform }), appHome: () => "H:/app" };
globalThis.stub = new Proxy({}, { get: (_, k) => known[k] ?? (() => {}) });
const src = readFileSync(new URL("../new-worktree/main.js", import.meta.url), "utf8")
  .replace(/^import (\{[^}]*\}) from "[^"]+";\r?$/gm, "const $1 = globalThis.stub;");
const { default: Dialog } = await import(`data:text/javascript,${encodeURIComponent(src)}`);
const prefill = (on, task) => Dialog.prototype.prefill.call({ on }, task, { write_to_clipboard: (t) => copied.push(t) });

const task = `issue "x'; calc; $(calc) <&> \u00e9`;
platform = "windows";
await prefill(null, task);
assert.deepEqual(calls.pop(), ["powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "H:/app/mods/issues/prefill.ps1", encodeURIComponent(JSON.stringify(task))]]);
platform = "macos";
await prefill(null, task);
assert.equal(calls.pop()[1][2], "H:/app/mods/issues/prefill.sh");
await prefill("vps", task);
assert.deepEqual([calls.length, copied], [0, [task]]);

if (process.platform === "win32") {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");
  const dir = mkdtempSync(`${tmpdir()}/herdr-prefill-`);
  const put = (name, text) => writeFileSync(`${dir}/${name}`, text);
  const log = () => (existsSync(`${dir}/log.txt`) ? readFileSync(`${dir}/log.txt`, "utf8").trim().split(/\r?\n/) : []);
  const since = Date.now();
  const claude = ["powershell.exe", "-NoExit", "-Command", "& 'claude'"], tree = "C:\\x\\.herdr\\worktrees\\a", labels = { "herdr.space": "s" };
  const rows = {
    t1: { created_ms: since - 5000, argv: claude, cwd: tree, labels }, // older than this run
    t2: { created_ms: since + 1, argv: ["powershell.exe"], cwd: tree, labels }, // not Claude
    t3: { created_ms: since + 1, argv: claude, cwd: "C:\\x\\other", labels }, // not a worktree
    t4: { created_ms: since + 1, argv: claude, cwd: tree, labels },
  };
  for (const [address, row] of Object.entries(rows)) put(`${address}.json`, JSON.stringify(row));
  put("ls.json", JSON.stringify({ terminals: Object.keys(rows).map((address) => ({ address })) }));
  put("hc.cmd", '@echo off\r\nif "%1"=="ls" type "%~dp0ls.json"\r\nif "%1"=="get" type "%~dp0%2.json"\r\nif "%1"=="read" type "%~dp0screen.txt" & copy /y "%~dp0ready.txt" "%~dp0screen.txt" >nul\r\n');
  put("herdr-app.cmd", `@echo off\r\necho %*>> "%~dp0log.txt"\r\nif "%2"=="pane.focus" if defined CHECK_NO_FOCUS exit /b 1\r\nif "%2"=="terminal.paste" powershell -NoProfile -Command "Get-Clipboard -Raw | Set-Content -Encoding UTF8 '%~dp0pasted.txt'"\r\n`);
  put("ready.txt", "\u276f\u00a0Try it\r\n");
  const run = (env = {}) => {
    rmSync(`${dir}/log.txt`, { force: true });
    put("screen.txt", "\u276f No, exit\r\n  Yes, I trust this folder\r\n");
    const script = fileURLToPath(new URL("./prefill.ps1", import.meta.url));
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, encodeURIComponent(JSON.stringify(task)), String(since)], { env: { ...process.env, ...env, PATH: `${dir};${process.env.PATH}` }, timeout: 30000 });
    assert.equal(r.status, 0, String(r.stderr));
  };
  run();
  assert.deepEqual(log(), ["do pane.focus --terminal t4", "do terminal.paste"]);
  assert.equal(readFileSync(`${dir}/pasted.txt`, "utf8").replace(/^\uFEFF/, "").trim(), task);
  run({ CHECK_NO_FOCUS: "1" });
  assert.deepEqual(log(), ["do pane.focus --terminal t4"]); // focus failed: no paste
  rmSync(dir, { recursive: true, force: true });
}
console.log("issues check passed");
