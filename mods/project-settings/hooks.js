// Worktree hooks shared by project-settings and new-worktree (an identical copy lives in
// each; keep them in sync). Orca-compatible: orca.yaml's scripts.setup and the ORCA_* variables.

// A script under orca.yaml's `scripts:` (a | or > block, or a one-line value); null when absent.
export function yamlScript(text, name = "setup") {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^scripts:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break; // the next top-level key
    const m = new RegExp(`^(\\s+)${name}:\\s*(.*)$`).exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length, rest = m[2].trim();
    if (rest && !/^[|>][+-]?\s*(#.*)?$/.test(rest)) return rest.replace(/^(['"])(.*)\1$/, "$2");
    const body = [];
    let inner = null;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim()) { body.push(""); continue; }
      const at = line.match(/^\s*/)[0].length;
      if (at <= indent) break;
      inner ??= at;
      body.push(line.slice(inner));
    }
    return body.join("\n").trim() || null;
  }
  return null;
}

export const HOOK_VARS = [
  ["ORCA_ROOT_PATH", "The project's main checkout"],
  ["ORCA_WORKTREE_PATH", "The new worktree's folder"],
  ["ORCA_WORKSPACE_NAME", "The new worktree's folder name"],
];

// For `env`: Orca's names (scripts written for Orca work unchanged), Conductor's, and Herdr aliases.
export function hookEnv(root, worktree) {
  const name = worktree.split("/").pop();
  return [`ORCA_ROOT_PATH=${root}`, `ORCA_WORKTREE_PATH=${worktree}`, `ORCA_WORKSPACE_NAME=${name}`,
    `CONDUCTOR_ROOT_PATH=${root}`, `HERDR_ROOT_PATH=${root}`, `HERDR_WORKTREE_PATH=${worktree}`];
}
