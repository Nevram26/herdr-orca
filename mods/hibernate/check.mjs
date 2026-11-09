// node mods/hibernate/check.mjs: on Windows the core names the shell as the foreground, so
// core.js finds the program among the shell's children; wake lines are PowerShell there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const UUID = "01a1abbf-504f-77e3-84d7-2a3fc14303fe";
const shell = (address, pid) => ({ address, pid, state: "live", labels: {}, foreground: { pid, name: "powershell.exe", argv: ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-NoExit"], cwd: "C:\\it's here" } });
let platform = "windows";
globalThis.herdr = {
  window: () => ({ platform }),
  home: () => "C:\\Users\\x",
  readTextFile: async () => null,
  hc: async ([, , address]) => ({ code: 0, stdout: JSON.stringify(address === "t1" ? shell("t1", 100) : shell("t2", 300)) }),
  exec: async (_cmd, args) => ({
    code: 0,
    stdout: args.at(-1).includes("Get-ChildItem") ? `rollout-2026-11-08T10-00-00-${UUID}.jsonl\r\n` : JSON.stringify([
      { ProcessId: 150, ParentProcessId: 100, Name: "conhost.exe", CommandLine: "\\??\\C:\\Windows\\system32\\conhost.exe 0x4" },
      { ProcessId: 200, ParentProcessId: 100, Name: "node.exe", CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js" --model o3' },
      { ProcessId: 350, ParentProcessId: 300, Name: "OpenConsole.exe", CommandLine: "OpenConsole.exe" },
    ]),
  }),
};
const src = readFileSync(new URL("./core.js", import.meta.url), "utf8")
  .replace(/^import .* from "herdr";$/m, "const { hc, exec, home, readTextFile, window } = globalThis.herdr;");
const core = await import(`data:text/javascript,${encodeURIComponent(src)}`);

// Codex behind node, under PowerShell: found, with its session from the rollout naming the folder.
const e = await core.describe(await core.get("t1"));
assert.deepEqual([e.kind, e.name, e.session, e.argv], ["codex", "Codex", UUID, ["codex", "--model", "o3"]]);
assert.equal(core.commandLine(e), `Set-Location -LiteralPath 'C:\\it''s here'; if ($?) { & 'codex' 'resume' '--no-daemon' '--model' 'o3' '${UUID}' }`);
// Only a console host under the shell: idle.
assert.ok(core.idleShell(await core.get("t2")));
// Elsewhere (and in a POSIX shell) the line stays sh.
platform = "macos";
assert.equal(core.commandLine({ ...e, cwd: "/tmp/x" }), `cd /tmp/x && codex resume --no-daemon --model o3 ${UUID}`);
console.log("hibernate check passed");
