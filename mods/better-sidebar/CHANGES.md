# Changes in this copy

This mod is Better Sidebar 3.0.0 from [munza/herdr-mods](https://github.com/munza/herdr-mods)
(Apache-2.0, see `licenses/` and `THIRD_PARTY.md` at the repository root), modified for the Orca layout.

Modified files:

- `main.js`: registers the `card` and `groups` views.
- `views/spaces.js`: issue badges beside PR badges, both opening the issues mod's viewer;
  a live-ports plug icon on the branch line; the hover card; repo-row hover buttons
  (fold worktrees, menu, new worktree); project groups; the space menu is `my-menu`;
  agents and their sub-agent trees drawn under each space (header "Agents" switch, which
  hides the Agents panel), the fold chevron hides a space's worktrees and agents together;
  a moon and "Asleep" on a space the hibernate mod put to sleep.
- `views/ui.js`: exports `RADIUS`.
- `views/footer.js`: adapted to this layout; "N agents · N need you" while agents show in spaces.
- `views/agents.js`: exports its helpers (status mark, icon, labels, durations) for the spaces list;
  a sub-agent kept as a pane shows only nested under its parent (not also
  as its own row), and clicking it focuses its pane instead of peeking.
- `git/pr-status.js`: finds each checkout's issue (git-config link, PR closing references,
  "Closes #N", or a branch number checked against GitHub) and carries it with the PRs.
- `mod.json`: settings for this layout.

Added files: `views/card.js`, `views/groups.js`, `views/space-agents.js`, `git/project-icons.js`, and icons
(`bot`, `moon`, `copy`, `ellipsis`, `external`, `folder`, `folder-plus`, `github`, `issue`, `issue-closed`,
`panel-bottom`, `plug`). Removed: `mod.schema.json`, `icons/sliders.svg`.
