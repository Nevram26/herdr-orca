# Changes in this copy

This mod is Better Sidebar 3.0.0 from [munza/herdr-mods](https://github.com/munza/herdr-mods)
(Apache-2.0, see `licenses/` and `THIRD_PARTY.md` at the repository root), modified for the Orca layout.

Modified files:

- `main.js`: registers the `card` and `groups` views.
- `views/spaces.js`: issue badges beside PR badges, both opening the issues mod's viewer;
  a live-ports plug icon on the branch line; the hover card; repo-row hover buttons
  (fold worktrees, menu, new worktree); project groups; the space menu is `my-menu`.
- `views/ui.js`: exports `RADIUS`.
- `views/footer.js`: adapted to this layout.
- `git/pr-status.js`: finds each checkout's issue (git-config link, PR closing references,
  "Closes #N", or a branch number checked against GitHub) and carries it with the PRs.
- `mod.json`: settings for this layout.

Added files: `views/card.js`, `views/groups.js`, `git/project-icons.js`, and icons
(`copy`, `ellipsis`, `external`, `folder`, `folder-plus`, `github`, `issue`, `issue-closed`,
`panel-bottom`, `plug`). Removed: `mod.schema.json`, `icons/sliders.svg`.
