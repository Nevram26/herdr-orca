// Project settings, after Orca's: identity (name, icon), worktree defaults and what a new
// worktree starts with. Kept in shared "projects.settings", keyed by
// JSON.stringify([machine, main checkout folder]); better-sidebar and new-worktree read it.
// Opened as a dialog with props { space } (my-menu's "Project settings…").
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, spaces, panes, agents, exec, home, shared, setShared, knownAgents, pickFolder, run, notify } from "herdr";

export const KEY = "projects.settings";
export const projectKey = (machine, main) => JSON.stringify([machine ?? null, main]);
const GROUPS = "better-sidebar.groups";
const COLORS = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const ICONS = [["auto", "Automatic"], ["emoji", "Emoji"], ["letter", "Letter"]];
const tilde = (p) => (p && p.startsWith(home()) ? `~${p.slice(home().length)}` : p ?? "");
const expand = (p) => (p.startsWith("~/") ? home() + p.slice(1) : p);

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

export default class ProjectSettings extends View {
  init(_props, cx) {
    this.space = spaces().find((s) => s.id === props()?.space);
    this.machine = this.space?.machine ?? null;
    this.project = undefined; // { main, name, gh } | null when not in git
    this.agents = [];
    const field = (placeholder) => { const s = InputState.new({ placeholder }); s.on("change", (_e, cx) => cx.notify()); return s; };
    this.f = {
      name: field("Follows the folder name"), emoji: field("🚀"), base: field("The repo's default branch"),
      location: field("~/.herdr/worktrees/<project>"), issue_branch: field("dev/feat/{number}"), setup: field("e.g. pnpm install"),
    };
    this.icon = "auto"; this.color = "ansi6"; this.agent = ""; this.saved = false;
    this.members = null; // the spaces of this project, found after it's read
    this.confirming = false;
    cx.spawn(async (cx) => {
      const folder = this.space && place(this.space);
      const top = folder && (await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on: this.machine }).catch(() => null));
      if (top?.code !== 0) { this.project = null; return cx.notify(); }
      const common = top.stdout.trim(), main = common.replace(/\/\.git\/?$/, "");
      const url = (await exec("git", ["remote", "get-url", "origin"], { cwd: main, on: this.machine }).catch(() => null))?.stdout?.trim() ?? "";
      const gh = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1] ?? null;
      this.project = { main, common, name: main.split("/").pop(), gh };
      const s = (shared(KEY) ?? {})[projectKey(this.machine, main)] ?? {};
      for (const k of Object.keys(this.f)) this.f[k].set_value(k === "emoji" ? s.icon?.emoji ?? "" : k === "location" ? tilde(s[k] ?? "") : s[k] ?? "");
      this.icon = s.icon?.kind ?? "auto"; this.color = s.icon?.color ?? "ansi6"; this.agent = s.agent ?? "";
      cx.notify();
      // Every space on this machine whose checkout belongs to the project: its main one and its worktrees.
      const members = [];
      for (const sp of spaces().filter((x) => (x.machine ?? null) === this.machine)) {
        const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: place(sp), on: this.machine }).catch(() => null);
        if (r?.code === 0 && r.stdout.trim() === common) members.push(sp);
      }
      this.members = members;
      cx.notify();
    });
    cx.spawn(async (cx) => {
      this.agents = (await knownAgents({ on: this.machine }).catch(() => [])).filter((a) => a.installed);
      cx.notify();
    });
  }

  close() { closeOverlay(props()?.overlay); }

  // Blank fields are left out: the mods then do what they did before.
  save() {
    const v = (k) => this.f[k].value().trim();
    const next = {
      ...(v("name") ? { name: v("name") } : {}),
      ...(this.icon !== "auto" ? { icon: { kind: this.icon, emoji: v("emoji"), color: this.color } } : {}),
      ...(v("base") ? { base: v("base") } : {}),
      ...(v("location") ? { location: expand(v("location")).replace(/\/+$/, "") } : {}),
      ...(v("issue_branch") ? { issue_branch: v("issue_branch") } : {}),
      ...(v("setup") ? { setup: v("setup") } : {}),
      ...(this.agent ? { agent: this.agent } : {}),
    };
    const all = { ...(shared(KEY) ?? {}) }, key = projectKey(this.machine, this.project.main);
    if (Object.keys(next).length) all[key] = next; else delete all[key];
    setShared(KEY, all);
    this.close();
  }

  // Removes the project from Herdr: closes its spaces and forgets its settings and group.
  // Files, worktrees and branches stay on disk.
  remove() {
    const key = projectKey(this.machine, this.project.main), groupKey = JSON.stringify([this.machine ?? null, this.project.common]);
    for (const sp of this.members ?? []) run("space.close", { id: sp.id, confirmed: true });
    const all = { ...(shared(KEY) ?? {}) };
    delete all[key];
    setShared(KEY, all);
    const g = shared(GROUPS);
    if (g?.projects?.[groupKey]) {
      const projects = { ...g.projects };
      delete projects[groupKey];
      setShared(GROUPS, { ...g, projects });
    }
    notify({ title: `Removed ${this.f.name.value().trim() || this.project.name}`, body: "Its files and worktrees are still on disk.", timeout: 4000 });
    this.close();
  }

  // ---- drawing ----

  section(t, title) { return div().pt(18).pb(6).text_size(11.5).font_semibold().text_color(t.dim).child(title); }

  row(t, label, hint, control) {
    return h_flex().py(10).gap(16).items_center().border_b(1).border_color(t.border)
      .child(v_flex().w(190).flex_none().gap(2).child(div().text_size(13).text_color(t.foreground).child(label))
        .when(Boolean(hint), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(hint))))
      .child(div().flex_1().min_w(0).child(control));
  }

  input(t, id, state, width) {
    return div().id(id).h(32).px(10).when(Boolean(width), (el) => el.w(width)).flex().items_center().rounded(7).border_1()
      .border_color(t.input).bg(t.background).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(Input.new(state).w_full().h_full().text_size(13).text_color(t.foreground));
  }

  pills(t, id, options, value, pick) {
    return h_flex().gap(4).flex_wrap().children(options.map(([v, label]) => div().id(`${id}-${v}`).h(28).px(10).flex().items_center()
      .rounded(7).text_size(12.5).cursor_pointer().border_1().border_color(v === value ? t.accent : t.border)
      .bg(v === value ? t.selected : t.background).text_color(v === value ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { pick(v); cx.notify(); }).child(label)));
  }

  button(t, id, text, onClick, solid = false) {
    return h_flex().id(id).h(34).px(14).flex_none().items_center().rounded(8).text_size(13).font_medium().border_1().cursor_pointer()
      .bg(solid ? t.foreground : t.raised).border_color(solid ? t.foreground : t.border).text_color(solid ? t.background : t.foreground)
      .hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)).child(text);
  }

  // How the sidebar will draw it with these choices.
  preview(t) {
    const name = this.f.name.value().trim() || this.project.name, emoji = this.f.emoji.value().trim();
    const tile = (child, bg) => div().size(28).flex_none().rounded(7).flex().items_center().justify_center().bg(bg).child(child);
    const icon = this.icon === "emoji" && emoji ? tile(div().text_size(16).child(emoji), COLORS[this.color] + "33")
      : this.icon === "letter" ? tile(div().text_size(13).font_bold().text_color("#ffffff").child([...name][0]?.toUpperCase() ?? "?"), COLORS[this.color])
      : tile(div().text_size(11).text_color(t.dim).child("auto"), t.raised);
    return h_flex().gap(10).items_center().child(icon).child(v_flex().child(div().text_size(14).font_semibold().child(name))
      .child(div().text_size(11.5).text_color(t.dim).child(this.project.gh ?? tilde(this.project.main))));
  }

  removal(t) {
    const members = this.members, busy = new Set(agents().filter((a) => a.status === "working" || a.status === "blocked").map((a) => a.space));
    const live = (members ?? []).filter((sp) => busy.has(sp.id));
    const danger = (id, text, onClick, filled) => h_flex().id(id).h(34).px(14).flex_none().items_center().rounded(8).text_size(13).font_medium()
      .border_1().border_color(t.blocked).bg(filled ? t.blocked : t.background).text_color(filled ? "#ffffff" : t.blocked).cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click((_e, cx) => onClick(cx)).child(text);
    return v_flex()
      .child(this.section(t, "REMOVE"))
      .child(this.row(t, "Remove project", "Takes it out of Herdr. Files, worktrees and branches stay on disk.",
        h_flex().justify_end().child(this.confirming ? div()
          : danger("ps-remove", "Remove project…", (cx) => { this.confirming = true; cx.notify(); }, false))))
      .when(this.confirming, (el) => el.child(v_flex().mt(10).p(12).gap(10).rounded(9).border_1().border_color(t.blocked + "88").bg(t.blocked + "14")
        .child(div().text_size(13).text_color(t.foreground).child(members === null ? "Finding this project's spaces…"
          : members.length ? `Closes ${members.length} space${members.length === 1 ? "" : "s"}: ${members.map((sp) => sp.name).join(", ")}.`
          : "No spaces are open for it; its settings and group are forgotten."))
        .when(live.length > 0, (e) => e.child(div().text_size(12.5).text_color(t.blocked)
          .child(`Agents are still working in ${live.map((sp) => sp.name).join(", ")}: closing stops them.`)))
        .child(h_flex().gap(8).justify_end()
          .child(this.button(t, "ps-remove-cancel", "Keep it", (cx) => { this.confirming = false; cx.notify(); }))
          .when(members !== null, (e) => e.child(danger("ps-remove-confirm", "Remove project", () => this.remove(), true))))));
  }

  render() {
    const t = theme(), p = this.project;
    const body = p === undefined ? div().text_color(t.muted).child("Reading the project…")
      : p === null ? div().text_color(t.muted).child("This space isn't in a Git repository, so it has no project settings.")
      : v_flex()
        .child(this.preview(t))
        .child(this.section(t, "IDENTITY"))
        .child(this.row(t, "Display name", "Shown in the sidebar", this.input(t, "ps-name", this.f.name)))
        .child(this.row(t, "Project icon", "Automatic: picked image, GitHub avatar or repo logo", v_flex().gap(8)
          .child(this.pills(t, "ps-icon", ICONS, this.icon, (v) => { this.icon = v; }))
          .when(this.icon === "emoji", (el) => el.child(this.input(t, "ps-emoji", this.f.emoji, 90)))
          .when(this.icon !== "auto", (el) => el.child(h_flex().gap(6).children(Object.entries(COLORS).map(([k, hex]) =>
            div().id(`ps-color-${k}`).size(22).rounded(11).cursor_pointer().bg(hex).border_2().border_color(k === this.color ? t.foreground : t.popover)
              .on_click((_e, cx) => { this.color = k; cx.notify(); })))))))
        .child(this.section(t, "WORKTREES"))
        .child(this.row(t, "Default worktree base", "New branches start from it", this.input(t, "ps-base", this.f.base)))
        .child(this.row(t, "Worktree location", "Folder new worktrees go in", h_flex().gap(8)
          .child(div().flex_1().min_w(0).child(this.input(t, "ps-location", this.f.location)))
          .child(this.button(t, "ps-pick", "Choose…", (cx) => cx.spawn(async (cx) => {
            const dir = await pickFolder({ prompt: "Where this project's worktrees go" }).catch(() => null);
            if (dir) this.f.location.set_value(tilde(dir));
            cx.notify();
          })))))
        .child(this.row(t, "Issue branch name", "{number} and {slug} are filled in", this.input(t, "ps-issue", this.f.issue_branch)))
        .child(this.section(t, "NEW WORKTREES START WITH"))
        .child(this.row(t, "Setup command", "Runs in the new worktree first", this.input(t, "ps-setup", this.f.setup)))
        .child(this.row(t, "Default agent", "Started after setup", this.pills(t, "ps-agent",
          [["", "Last used"], ...this.agents.map((a) => [a.name, a.name])], this.agent, (v) => { this.agent = v; })))
        .child(this.removal(t));
    return v_flex().id("project-settings").size_full().bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().h(52).flex_none().px(20).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(16).font_semibold().child("Project settings"))
        .child(div().text_size(11.5).text_color(t.dim).child("Esc")))
      .child(div().id("ps-body").flex_1().min_h(0).overflow_y_scrollbar().px(20).py(16).child(body))
      .child(h_flex().h(60).flex_none().px(20).gap(8).items_center().justify_end().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(11.5).text_color(t.dim).child("Leave a field blank to keep the current behaviour."))
        .child(this.button(t, "ps-cancel", "Cancel", () => this.close()))
        .when(Boolean(p), (el) => el.child(this.button(t, "ps-save", "Save", () => this.save(), true))));
  }
}
