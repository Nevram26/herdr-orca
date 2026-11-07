// Projects tab: GitHub Projects (v2) linked to the repo, as a board grouped by a single-select
// field (Status by default) or a table. Moving an item sets that field with gh project item-edit.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, shared, setShared } from "herdr";
import { readCache, writeCache, age } from "./cache.js";
import { spaceFor } from "./start.js";
import { openUrl } from "./viewer.js";

const LIST_TTL = 30 * 60000;
const FRESH = 2 * 60000;
const PAGES = 5;
const PAGE = 50;
const COLUMN_MAX = 100;
const COLORS = { GRAY: "#8b949e", BLUE: "#4493f8", GREEN: "#3fb950", YELLOW: "#d29922", ORANGE: "#db6d28", RED: "#f85149", PINK: "#db61a2", PURPLE: "#a371f7" };

const LIST_QUERY = `query($o:String!,$n:String!){
  repository(owner:$o,name:$n){ projectsV2(first:20,orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ...P } } }
  repositoryOwner(login:$o){ ... on ProjectV2Owner{ projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ...P } } } }
  viewer{ projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){ nodes{ ...P } } } }
fragment P on ProjectV2{ id number title url closed owner{ ... on User{ login } ... on Organization{ login } } }`;

const ITEMS_QUERY = `query($id:ID!,$after:String){ node(id:$id){ ... on ProjectV2{ title url
  fields(first:50){ nodes{ ... on ProjectV2SingleSelectField{ id name options{ id name color } } } }
  items(first:100,after:$after){ pageInfo{ hasNextPage endCursor } nodes{ id isArchived updatedAt
    fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue{ optionId field{ ... on ProjectV2SingleSelectField{ id } } } } }
    content{ __typename
      ... on Issue{ number title state stateReason url updatedAt repository{ nameWithOwner } author{ login } assignees(first:5){ nodes{ login } } labels(first:5){ nodes{ name } } }
      ... on PullRequest{ number title state isDraft url updatedAt headRefName repository{ nameWithOwner } author{ login } assignees(first:5){ nodes{ login } } labels(first:5){ nodes{ name } } }
      ... on DraftIssue{ title updatedAt assignees(first:5){ nodes{ login } } } } } } } } }`;

function normalize(n) {
  const c = n.content ?? {}, values = {};
  for (const v of n.fieldValues?.nodes ?? []) if (v?.field?.id) values[v.field.id] = v.optionId;
  return {
    id: n.id, type: c.__typename ?? "Hidden", number: c.number ?? null, title: c.title ?? "(no access)",
    state: c.state, stateReason: c.stateReason, isDraft: c.isDraft, url: c.url ?? null, headRefName: c.headRefName,
    updatedAt: c.updatedAt ?? n.updatedAt, repo: c.repository?.nameWithOwner ?? null, author: c.author,
    assignees: c.assignees?.nodes ?? [], labels: c.labels?.nodes ?? [], values,
  };
}

// gh exits 1 on GraphQL errors and prints them as JSON; the missing-scope one gets a fix.
function ghError(r) {
  const text = (r.stderr || r.stdout || "").trim();
  if (/INSUFFICIENT_SCOPES|read:project/i.test(text)) return "gh needs the project scope: run  gh auth refresh -s project";
  try { return JSON.parse(r.stdout).errors?.map((e) => e.message).join("; ") || text; } catch { return text; }
}

async function graphql(query, vars, on) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v != null) args.push("-f", `${k}=${v}`);
  const r = await exec("gh", args, { on });
  if (r.code !== 0) throw new Error(ghError(r));
  return JSON.parse(r.stdout).data;
}

// One filter token: assignee:, label:, repo:, is:, no:, else words in the title.
function matches(i, token, me) {
  const m = /^(assignee|label|repo|is|no):(.+)$/i.exec(token);
  if (!m) return `${i.title} #${i.number ?? ""} ${i.repo ?? ""}`.toLowerCase().includes(token.toLowerCase());
  const k = m[1].toLowerCase(), v = m[2].toLowerCase();
  if (k === "assignee") return i.assignees.some((a) => a.login.toLowerCase() === (v === "@me" ? me?.toLowerCase() : v));
  if (k === "label") return i.labels.some((l) => l.name.toLowerCase() === v);
  if (k === "repo") return (i.repo ?? "").toLowerCase().includes(v);
  if (k === "no") return v === "assignee" ? !i.assignees.length : v === "label" ? !i.labels.length : true;
  return { open: i.state === "OPEN", closed: i.state === "CLOSED" || i.state === "MERGED", merged: i.state === "MERGED",
    draft: i.type === "DraftIssue", issue: i.type === "Issue", pr: i.type === "PullRequest" }[v] ?? true;
}

export class Projects {
  constructor(host) {
    this.host = host; this.data = {}; this.loading = null; this.listing = null; this.error = null;
    this.view = shared("issues.projectView") ?? "board";
  }

  list(repo = this.host.repo) { return (shared("issues.projectLists") ?? {})[repo] ?? null; }

  // The project picked for this repo, else its first linked one.
  current() {
    const repo = this.host.repo;
    return (shared("issues.projectFor") ?? {})[repo] ?? this.list(repo)?.linked?.[0] ?? null;
  }

  field(entry) {
    const pick = (shared("issues.groupBy") ?? {})[this.current()?.id];
    return entry?.fields.find((f) => f.id === pick) ?? entry?.fields.find((f) => f.name === "Status") ?? entry?.fields[0] ?? null;
  }

  // ---- data ----

  async fetchList(repo, on) {
    const [o, n] = repo.split("/");
    const d = await graphql(LIST_QUERY, { o, n }, on);
    const open = (nodes) => (nodes ?? []).filter((p) => p && !p.closed);
    const linked = open(d.repository?.projectsV2?.nodes), seen = new Set(linked.map((p) => p.id));
    const other = [...open(d.repositoryOwner?.projectsV2?.nodes), ...open(d.viewer?.projectsV2?.nodes)].filter((p) => !seen.has(p.id) && seen.add(p.id));
    const entry = { at: Date.now(), linked, other };
    setShared("issues.projectLists", { ...(shared("issues.projectLists") ?? {}), [repo]: entry });
    return entry;
  }

  async fetchItems(id, on) {
    let after = null, head = null;
    const items = [];
    for (let k = 0; k < PAGES; k++) {
      const node = (await graphql(ITEMS_QUERY, { id, after }, on))?.node;
      if (!node) throw new Error("Project not found, or gh can't see it");
      head ??= { title: node.title, url: node.url, fields: node.fields.nodes.filter((f) => f?.options) };
      items.push(...node.items.nodes.filter((n) => !n.isArchived).map(normalize));
      if (!node.items.pageInfo.hasNextPage) break;
      after = node.items.pageInfo.endCursor;
    }
    return { at: Date.now(), ...head, items };
  }

  // The project list (30 min), then the picked project's items: disk cache at once, GitHub after FRESH.
  load(cx, force = false) {
    const h = this.host, repo = h.repo, on = h.repoOn;
    if (!repo) return;
    const listed = this.list(repo), p = this.current(), held = p ? this.data[p.id] : null;
    if (!force && age(listed) < LIST_TTL && p && age(held) < FRESH) return;
    const key = `${repo}|${p?.id}`;
    if (this.loading?.key === key && Date.now() - this.loading.at < 60000) return;
    const loading = (this.loading = { key, at: Date.now() });
    this.error = null;
    cx.spawn(async (cx) => {
      cx.notify();
      try {
        if (force || age(listed) >= LIST_TTL) { await this.fetchList(repo, on); cx.notify(); }
        const project = this.current();
        if (!project || h.repo !== repo) return;
        let entry = this.data[project.id] ?? (await readCache(`project:${project.id}`));
        if (entry && !this.data[project.id]) { this.data[project.id] = entry; cx.notify(); }
        if (!force && age(entry) < FRESH) return;
        entry = await this.fetchItems(project.id, on);
        this.data[project.id] = entry; writeCache(`project:${project.id}`, entry);
      } catch (e) { if (h.repo === repo) this.error = String(e?.message ?? e); }
      finally { if (this.loading === loading) this.loading = null; cx.notify(); }
    });
  }

  // Shown at once; the cache keeps the new value, a failure reloads the truth.
  move(m, cx) {
    const entry = this.data[m.project], item = entry?.items.find((i) => i.id === m.item);
    if (item) item.values = { ...item.values, [m.field]: m.option };
    cx.notify();
    cx.spawn(async (cx) => {
      const args = ["project", "item-edit", "--id", m.item, "--project-id", m.project, "--field-id", m.field,
        ...(m.option ? ["--single-select-option-id", m.option] : ["--clear"])];
      const r = await exec("gh", args, { on: this.host.repoOn }).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code === 0) { if (entry) writeCache(`project:${m.project}`, entry); return; }
      this.error = ghError(r);
      this.load(cx, true);
    });
  }

  handle(p, cx) {
    const h = this.host;
    if (p.project) {
      setShared("issues.projectFor", { ...(shared("issues.projectFor") ?? {}), [h.repo]: p.project });
      h.page = 0; return this.load(cx);
    }
    if (p.groupBy) { setShared("issues.groupBy", { ...(shared("issues.groupBy") ?? {}), [p.groupBy.project]: p.groupBy.field }); return cx.notify(); }
    if (p.projectsRefresh) return this.load(cx, true);
    if (p.move) return this.move(p.move, cx);
  }

  setView(view, cx) { this.view = view; setShared("issues.projectView", view); this.host.page = 0; cx.notify(); }

  // ---- popups ----

  pickProject() {
    const h = this.host, l = this.list(), cur = this.current(), name = h.repo.split("/")[1];
    const row = (p) => ({ label: p.title, hint: `${p.owner?.login ?? ""} · #${p.number}`, check: p.id === cur?.id, pick: p.id === cur?.id ? null : { project: p } });
    h.popup({ title: "Project", items: [
      { heading: l?.linked?.length ? `LINKED TO ${name.toUpperCase()}` : `NOTHING LINKED TO ${name.toUpperCase()}` },
      ...(l?.linked ?? []).map(row),
      ...(l?.other?.length ? [{ heading: "OTHER PROJECTS" }, ...l.other.map(row)] : []),
      { label: "Refresh list", pick: { projectsRefresh: true } },
    ] }, 340);
  }

  pickGroup(entry) {
    const f = this.field(entry), id = this.current()?.id;
    this.host.popup({ title: "Group by", items: entry.fields.map((x) => ({ label: x.name, check: x.id === f?.id, pick: x.id === f?.id ? null : { groupBy: { project: id, field: x.id } } })) });
  }

  moveMenu(i, f) {
    const pid = this.current()?.id, now = i.values[f.id] ?? null, move = (option) => ({ move: { project: pid, item: i.id, field: f.id, option } });
    this.host.popup({ title: `Move to (${f.name})`, items: [
      ...f.options.map((o) => ({ label: o.name, check: now === o.id, pick: now === o.id ? null : move(o.id) })),
      ...(now ? [{ label: `Clear ${f.name}`, pick: move(null) }] : []),
      ...(i.url ? [{ label: "Open on GitHub", open: i.url }] : []),
    ] }, 260);
  }

  // ---- render ----

  columns(entry, items, f) {
    if (!f) return [{ id: null, name: "Items", color: null, items }];
    const by = new Map([[null, []], ...f.options.map((o) => [o.id, []])]);
    for (const i of items) (by.get(i.values[f.id] ?? null) ?? by.get(null)).push(i);
    return [{ id: null, name: `No ${f.name}`, color: null, items: by.get(null) },
      ...f.options.map((o) => ({ id: o.id, name: o.name, color: COLORS[o.color] ?? null, items: by.get(o.id) }))]
      .filter((c) => c.id !== null || c.items.length);
  }

  itemState(i, t) {
    if (i.type === "DraftIssue") return { label: "Draft", color: t.muted, glyph: "draft" };
    if (i.type === "Hidden") return { label: "Hidden", color: t.dim, glyph: "skipped" };
    return this.host.status(i, t, i.type === "PullRequest");
  }

  open(i) {
    if (i.number && i.repo) this.host.openIssue(i, { repo: i.repo, pr: i.type === "PullRequest" });
    else if (this.current()?.url) openUrl(this.current().url);
  }

  startBtn(i, t, h) {
    if (!i.number || !i.repo) return div();
    const pr = i.type === "PullRequest", space = spaceFor(i, pr);
    return this.host.btn(`pstart-${i.id}`, t, [div().font_medium().child(space ? "Open" : "Start"), this.host.glyph("arrow", 13)],
      (cx) => this.host.start(i, cx, { repo: i.repo, pr }), { solid: Boolean(space), h });
  }

  card(t, cx) {
    const h = this.host, p = this.current(), entry = p ? this.data[p.id] : null, f = this.field(entry);
    const q = h.query.projects ?? "", mine = "assignee:@me", hasMine = q.includes(mine);
    const busy = Boolean(this.loading);
    const shell = v_flex().flex_1().min_h(0).rounded(12).border_1().border_color(t.border).bg(t.chrome).overflow_hidden()
      .child(h_flex().px(18).pt(14).gap(8).items_center()
        .child(h.chip("view-board", "Board", this.view === "board", t, (cx) => this.setView("board", cx)))
        .child(h.chip("view-table", "Table", this.view === "table", t, (cx) => this.setView("table", cx)))
        .child(div().w(1).h(20).mx(4).bg(t.border))
        .child(h.chip("seg-all-items", "All items", !hasMine, t, (cx) => h.apply(q.replace(mine, "").replace(/\s+/g, " "), cx)))
        .child(h.chip("seg-mine-items", "Assigned to me", hasMine, t, (cx) => h.apply(hasMine ? q : `${q} ${mine}`, cx))))
      .child(h_flex().px(18).py(12).gap(8).items_center()
        .child(h.btn("project-pick", t, [h.glyph("board", 15, t.muted), div().max_w(240).truncate().child(p?.title ?? "Choose project"), h.glyph("updown", 14, t.muted)], () => this.pickProject()))
        .when(Boolean(f), (e) => e.child(h.btn("group-by", t, [div().text_color(t.muted).child("Group by"), div().child(f.name), h.glyph("chevron", 12, t.muted)], () => this.pickGroup(entry))))
        .child(h.searchBox(t, q, ""))
        .when(Boolean(p?.url), (e) => e.child(h.btn("project-github", t, h.glyph("external", 16), () => openUrl(p.url), { square: true })))
        .child(h.btn("project-refresh", t, busy ? svg("mods/workspace-chrome/spinner.svg").size(16).text_color(t.working).spin(900) : h.glyph("refresh", 16),
          (cx) => this.load(cx, true), { square: true })))
      .when(Boolean(this.error), (e) => e.child(div().px(18).pb(8).text_size(12).text_color(t.ansi1).child(this.error)));

    if (!p) return shell.child(this.notice(t, this.list() ? `No project is linked to ${h.repo}` : "Looking for projects…",
      this.list() ? "Choose one of your projects above, or link one on GitHub from the repo's Projects tab." : ""));
    if (!entry) return shell.child(this.notice(t, busy ? "Loading project…" : "Project not loaded", ""));
    const items = q.trim() ? entry.items.filter((i) => q.trim().split(/\s+/).every((tk) => matches(i, tk, h.me))) : entry.items;
    const cols = this.columns(entry, items, f);
    return shell.child(this.view === "table" ? this.table(cols, f, t, cx) : this.board(cols, f, t, cx));
  }

  notice(t, title, hint) {
    return v_flex().flex_1().items_center().justify_center().gap(8).border_t(1).border_color(t.border).bg(t.background)
      .child(this.host.glyph("board", 26, t.dim))
      .child(div().font_semibold().text_color(t.muted).child(title))
      .when(Boolean(hint), (e) => e.child(div().text_size(12).text_color(t.dim).child(hint)));
  }

  board(cols, f, t, cx) {
    return h_flex().id(`board-${this.current().id}`).flex_1().min_h(0).overflow_x_scrollbar().px(18).pb(16).gap(12)
      .children(cols.map((c) => {
        const color = c.color ?? t.muted, shown = c.items.slice(0, COLUMN_MAX);
        return v_flex().w(300).flex_none().h_full().min_h(0).rounded(10).border_1().border_color(t.border).bg(t.background)
          .child(h_flex().h(42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
            .child(div().size(10).flex_none().rounded(5).border_1().border_color(color).bg(color + "40"))
            .child(div().font_semibold().truncate().child(c.name))
            .child(div().h(20).px(7).flex().items_center().rounded(10).bg(t.raised).text_size(11).text_color(t.muted).child(String(c.items.length))))
          .child(v_flex().id(`col-${c.id ?? "none"}`).flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8)
            .children(shown.map((i) => this.boardCard(i, f, t, cx)))
            .when(!c.items.length, (e) => e.child(div().py(16).text_center().text_size(12).text_color(t.dim).child("Empty")))
            .when(c.items.length > COLUMN_MAX, (e) => e.child(div().py(8).text_center().text_size(12).text_color(t.dim)
              .child(`${c.items.length - COLUMN_MAX} more: filter to narrow`))));
      }));
  }

  boardCard(i, f, t, cx) {
    const h = this.host, s = this.itemState(i, t);
    const stop = (e, cx) => { h.press = e; cx.stop_propagation(); };
    return v_flex().id(`card-${i.id}`).flex_none().p(10).gap(7).rounded(8).border_1().border_color(t.border).bg(t.chrome)
      .cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => this.open(i))
      .child(h_flex().gap(6).items_center().text_size(12).text_color(t.muted)
        .child(h.glyph(s.glyph, 13, s.color))
        .child(div().flex_1().min_w(0).truncate().child(i.number ? `${i.repo?.split("/")[1] ?? ""} #${i.number}` : s.label))
        .when(Boolean(f), (e) => e.child(div().id(`cmove-${i.id}`).size(24).flex().items_center().justify_center().rounded(6)
          .hover((st) => st.bg(t.raised).text_color(t.foreground)).on_mouse_down("left", stop)
          .on_click((_e, cx) => { cx.stop_propagation(); this.moveMenu(i, f); })
          .child(h.glyph("dots", 15)))))
      .child(div().text_size(13).child(i.title))
      .when(i.labels.length > 0, (e) => e.child(h_flex().gap(5).flex_wrap()
        .children(i.labels.slice(0, 3).map((l) => div().h(20).px(8).flex().items_center().rounded(10).bg(t.raised).text_size(11).text_color(t.muted).child(l.name)))))
      .child(h_flex().gap(4).items_center()
        .children(i.assignees.slice(0, 3).map((a) => h.avatar(a.login, 20, t, cx)))
        .child(div().flex_1())
        .child(this.startBtn(i, t, 26)));
  }

  table(cols, f, t, cx) {
    const h = this.host, rows = cols.flatMap((c) => c.items.map((i) => [i, c]));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (h.page >= pages) h.page = pages - 1;
    const shown = rows.slice(h.page * PAGE, (h.page + 1) * PAGE);
    const cell = (w, child) => h_flex().w(w).flex_none().items_center().child(child);
    const label = (s) => div().text_size(11).font_semibold().text_color(t.dim).child(s);
    const line = () => h_flex().px(18).gap(12).items_center().border_b(1).border_color(t.border);
    const stop = (e, cx) => { h.press = e; cx.stop_propagation(); };
    return v_flex().flex_1().min_h(0)
      .child(line().h(40).border_t(1).bg(t.chrome)
        .child(cell(96, label("ID"))).child(div().flex_1().child(label("TITLE / CONTEXT")))
        .child(cell(150, label((f?.name ?? "Status").toUpperCase()))).child(cell(110, label("ASSIGNEES")))
        .child(cell(120, label("UPDATED"))).child(cell(100, div())))
      .child(v_flex().id(`prows-${h.page}`).flex_1().min_h(0).overflow_y_scrollbar()
        .children(shown.map(([i, c]) => {
          const s = this.itemState(i, t), color = c.color ?? t.muted;
          return line().id(`prow-${i.id}`).min_h(64).py(8).bg(t.background).cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => this.open(i))
            .child(cell(96, h_flex().h(26).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).text_size(12).text_color(t.muted)
              .child(h.glyph(s.glyph, 13, s.color)).child(i.number ? `#${i.number}` : s.label)))
            .child(v_flex().flex_1().min_w(0).gap(4)
              .child(div().text_size(14).truncate().child(i.title))
              .child(h_flex().gap(10).items_center().text_size(12).text_color(t.muted).overflow_hidden()
                .when(Boolean(i.author?.login), (e) => e.child(div().flex_none().child(i.author.login.replace(/^app\//, ""))))
                .when(Boolean(i.repo), (e) => e.child(div().flex_none().child(i.repo.split("/")[1])))
                .children(i.labels.slice(0, 4).map((l) => div().flex_none().h(20).px(8).flex().items_center().rounded(10).bg(t.raised).text_size(11).text_color(t.muted).child(l.name)))))
            .child(cell(150, f
              ? h_flex().id(`pmove-${i.id}`).h(26).max_w(150).px(8).gap(5).items_center().rounded(13).border_1().border_color(color + "99").bg(color + "1a")
                .text_size(12).text_color(color).on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); this.moveMenu(i, f); })
                .child(div().truncate().child(c.id ? c.name : "None")).child(h.glyph("chevron", 11, color))
              : div()))
            .child(cell(110, h_flex().gap(4).children(i.assignees.slice(0, 3).map((a) => h.avatar(a.login, 22, t, cx)))
              .when(!i.assignees.length, (e) => e.child(div().text_color(t.dim).child("–")))))
            .child(cell(120, div().text_size(12).text_color(t.muted).child(h.updated(i.updatedAt))))
            .child(cell(100, h_flex().w_full().justify_end().child(this.startBtn(i, t, 30))));
        }))
        .when(!shown.length, (e) => e.child(div().py(40).text_center().text_size(12).text_color(t.dim).child("No items match"))))
      .when(pages > 1, (e) => e.child(h.pager(pages, t)));
  }
}
