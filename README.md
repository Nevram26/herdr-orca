# Orca for Herdr

A Herdr Desktop layout after the Orca app: projects with nested worktrees and their issue/PR
badges, each one's agents and sub-agents right under it, spaces you can put to sleep (and agents
resumed after a restart), a resource meter, a hover card per worktree, in-app GitHub issues and pull requests, a Create worktree dialog
(from a branch, an issue, a PR or a new name), Files and Git changes panels, run actions, usage
limits and live ports.

![Orca](preview.png)

See [RECIPE.md](RECIPE.md) for what it does and how it's built, and
[THIRD_PARTY.md](THIRD_PARTY.md) for credits and licenses. The issues, live ports, usage limits and
actions mods are also published on their own in
[VladTemp27/herdr-mods](https://github.com/VladTemp27/herdr-mods).

## Install

Ask your Herdr agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/VladTemp27/herdr-orca

Then two mods by [munza](https://github.com/munza/herdr-mods) that the layout uses but this repo
doesn't include:

> Add this mod: https://github.com/munza/herdr-mods/tree/main/better-changes (in the layout's Changes slot)
>
> Add this mod: https://github.com/munza/herdr-mods/tree/main/better-config

By hand:

1. Copy `layouts/orca.json` into `~/.config/herdr-app/layouts/` and each folder in `mods/` into
   `~/.config/herdr-app/mods/`. Rename anything whose name you already use.
2. Install Better Changes and Better Config from munza/herdr-mods. Set Better Changes'
   `"place"` to `"none"` in its `mod.json`: the layout already has a slot for it.
3. Merge `keys.json` into `~/.config/herdr-app/keys.json` (its `layout:orca` section applies only
   while this layout shows).
4. Run `herdr-app check ~/.config/herdr-app/mods/<name>` for each mod, then
   `herdr-app do layout.switch '{"name":"orca"}'`. `ctrl-shift-l` switches back.

Needs `git` and a logged-in `gh`. Usage limits read the `claude` and `codex` CLIs; Automations uses
the `herdr-automations` CLI; desktop notifications use `terminal-notifier` when installed. Built and
tested on macOS with Herdr 0.1.13, and on Windows 11 (see [Windows](#windows)).

## Windows

- Needs [Git for Windows](https://gitforwindows.org); its default install is enough. The mods run
  their shell helpers with its `sh.exe`, found through `git --exec-path`, so nothing has to be added
  to `PATH`.
- `keys.json` uses `cmd-`, which is the Windows key there, and Windows keeps most of those (Win+N,
  Win+G, Win+W). Merge these instead. The `layout:orca` ones replace Herdr's own only while Orca
  shows:

  ```json
  "global": {
    "ctrl-shift-g": "mod.open:open-vscode",
    "alt-shift-e": "mod.open:excalidraw",
    "alt-shift-n": "mod.open:new-project"
  },
  "layout:orca": {
    "ctrl-shift-n": "mod.open:new-worktree",
    "ctrl-shift-a": "layout.toggle:agents",
    "alt-shift-b": "better-sidebar.toggle-panel",
    "ctrl-shift-pagedown": "better-sidebar.next-space",
    "ctrl-shift-pageup": "better-sidebar.prev-space",
    "ctrl-shift-w": "my-tabs.close-tab",
    "ctrl-shift-x": "my-tabs.close-pane"
  }
  ```

- Minimize, maximize and close sit at the right end of the tab bar.
- The resource meter samples processes with PowerShell. Live ports come from `netstat` and belong to
  the space whose terminal started the server, so one started outside Herdr is listed under Other
  processes, even inside a worktree.
- Setup scripts and clones run in Git's `sh` and then leave you in PowerShell.
- Sleep and Wake type the resume command into PowerShell. Resuming after a restart is offered after
  a reboot, a logout or a herdr-core crash: on Windows a terminal whose shell is killed just closes.
- Not on Windows yet: desktop notifications, pasting an issue's task into Claude (it's copied to the
  clipboard instead, so press Ctrl+V), the Files panel's Open with menu, Excalidraw's undo and redo
  keys, and Automations (no `herdr-automations` for Windows).

## Updating this repo

`./sync.sh` copies the layout and these mods from your Herdr home into the repo.
`previews/render.sh` redraws `preview.png` from `previews/preview.html` with headless Chrome:
the preview is an HTML mockup with demo data, so no screenshot of your own work is published.

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).
