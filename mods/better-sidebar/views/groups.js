// Your own project groups: named sections in the spaces list holding the projects you add.
// Stored in shared state; the popups here (props.view "groups") create, rename, fill and delete them.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, closeOverlay, openOverlay } from "herdr";
import { TEXT, SIZE, RADIUS, Icon } from "./ui.js";

const KEY = "better-sidebar.groups";

// { groups: [{ id, name, folded }], projects: { <repo key>: <group id> } }
export function readGroups() {
  const v = shared(KEY);
  return { groups: v?.groups ?? [], projects: v?.projects ?? {} };
}

export function writeGroups(change) {
  const next = change(JSON.parse(JSON.stringify(readGroups())));
  setShared(KEY, next);
}

export function toggleFold(id) {
  writeGroups((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) g.folded = !g.folded;
    return s;
  });
}

const popup = (mode, extra, height = 220) =>
  openOverlay({ mod: "better-sidebar", kind: "popup", width: 280, height, props: { view: "groups", mode, ...extra } });

export const openNameDialog = (group = null) =>
  openOverlay({ mod: "better-sidebar", kind: "dialog", width: 380, height: 150, props: { view: "groups", mode: "name", group } });
// `projects`: [{ key, name }] known to the spaces list now.
export const openProjectPicker = (group, projects) =>
  popup("projects", { group, projects }, Math.min(420, 70 + projects.length * SIZE.menu));
export const openGroupMenu = (group, projects) => popup("menu", { group, projects }, 190);

// Group backgrounds: theme color names, so they follow light and dark themes.
export const GROUP_COLORS = ["ansi4", "ansi6", "ansi2", "ansi3", "ansi1", "ansi5"];

// The theme color as a soft tint, or null for no background.
export function groupTint(t, color) {
  const hex = color && t[color];
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}24` : null;
}

export class Groups {
  init(_props, cx) {
    const p = props();
    this.handle = cx.focus_handle();
    if (p.mode !== "name") return;
    const current = readGroups().groups.find((g) => g.id === p.group)?.name ?? "";
    this.input = InputState.new({ value: current, placeholder: "Group name" });
    if (current) this.input.set_selected_range({ start: 0, end: current.length });
    this.input.on("submit", () => this.saveName());
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  saveName() {
    const name = this.input.value().trim();
    const id = props().group;
    if (name) {
      writeGroups((s) => {
        const g = s.groups.find((x) => x.id === id);
        if (g) g.name = name;
        else s.groups.push({ id: `g${Date.now().toString(36)}`, name, folded: false });
        return s;
      });
    }
    this.close();
  }

  render() {
    const mode = props().mode;
    const body = mode === "name" ? this.nameView() : mode === "projects" ? this.projectsView() : this.menuView();
    return body.id("groups-popup").track_focus(this.handle).on_key_down((e, cx) => {
      if (e.key === "escape") { cx.stop_propagation(); this.close(); }
    });
  }

  nameView() {
    const t = theme();
    const renaming = Boolean(props().group);
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
    return v_flex().w_full().p(18).gap(14).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(renaming ? "Rename group" : "New group"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(this.input).h(34).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.8))
      .child(h_flex().gap(8).justify_end()
        .child(button("group-cancel", "Cancel", false, () => this.close()))
        .child(button("group-save", renaming ? "Save" : "Create", true, () => this.saveName())));
  }

  // Click a project to put it in this group, or take it back out.
  projectsView() {
    const t = theme();
    const { group, projects } = props();
    const s = readGroups();
    const name = (id) => s.groups.find((g) => g.id === id)?.name;
    return v_flex().w_full().p(5).gap(1).bg(t.popover).text_color(t.foreground)
      .child(div().px(8).pt(6).pb(4).text_size(TEXT.caption).font_medium().text_color(t.dim)
        .child(`Projects in ${name(group) ?? "group"}`))
      .when(!projects.length, (el) => el.child(div().px(8).py(6).text_size(TEXT.small).text_color(t.dim).child("Open a repository as a space first.")))
      .children(projects.map((pr, i) => {
        const owner = s.projects[pr.key];
        const mine = owner === group;
        const elsewhere = owner && !mine ? name(owner) : null;
        return h_flex().id(`group-project-${i}`).h(SIZE.menu).flex_none().px(8).gap(9).items_center()
          .rounded(RADIUS.row).cursor_pointer().text_size(TEXT.menu).hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => {
            writeGroups((st) => {
              if (mine) delete st.projects[pr.key];
              else st.projects[pr.key] = group;
              return st;
            });
            cx.notify();
          })
          .child(div().w(14).flex_none().child(mine ? Icon("check", 14) : div()))
          .child(div().flex_1().min_w(0).truncate().child(pr.name))
          .when(Boolean(elsewhere), (el) => el.child(div().text_size(TEXT.caption).text_color(t.dim).child(`in ${elsewhere}`)));
      }));
  }

  menuView() {
    const t = theme();
    const { group, projects } = props();
    const item = (id, icon, label, action, danger) => h_flex().id(id).h(SIZE.menu).flex_none().px(8).gap(9).items_center()
      .rounded(RADIUS.row).cursor_pointer().text_size(TEXT.menu).text_color(danger ? t.ansi1 : t.foreground)
      .hover((s) => s.bg(t.hover)).on_click(() => { this.close(); action(); })
      .child(Icon(icon, 14).text_color(danger ? t.ansi1 : t.muted)).child(label);
    const current = readGroups().groups.find((g) => g.id === group)?.color ?? null;
    const setColor = (color) => writeGroups((s) => {
      const g = s.groups.find((x) => x.id === group);
      if (g) g.color = color;
      return s;
    });
    const swatch = (color) => div().id(`group-color-${color ?? "none"}`).size(20).flex_none().rounded(10).cursor_pointer()
      .border_2().border_color(current === color ? t.foreground : "#00000000")
      .when(Boolean(color), (el) => el.bg(t[color]))
      .when(!color, (el) => el.border_1().border_color(current === null ? t.foreground : t.input).flex().items_center()
        .justify_center().text_size(10).text_color(t.dim).child("∅"))
      .tooltip(color ? "Background" : "No background")
      .on_click((_e, cx) => { setColor(color); cx.notify(); });
    return v_flex().w_full().p(5).gap(1).bg(t.popover)
      .child(h_flex().h(SIZE.menu + 6).flex_none().px(8).gap(7).items_center()
        .children([null, ...GROUP_COLORS].map(swatch)))
      .child(div().h(1).mx(4).my(2).bg(t.border))
      .child(item("group-add", "plus", "Add projects…", () => openProjectPicker(group, projects)))
      .child(item("group-rename", "settings", "Rename…", () => openNameDialog(group)))
      .child(item("group-delete", "folder", "Delete group", () => writeGroups((s) => {
        s.groups = s.groups.filter((g) => g.id !== group);
        for (const [k, v] of Object.entries(s.projects)) if (v === group) delete s.projects[k];
        return s;
      }), true));
  }
}
