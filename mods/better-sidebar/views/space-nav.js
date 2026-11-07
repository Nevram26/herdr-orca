// Next/previous space in the spaces list's order, which the list shares as it draws.
import { spaces, focused, run, shared } from "herdr";

export const ORDER_KEY = "better-sidebar.space-order";

export function stepSpace(dir) {
  const live = spaces().map((w) => w.id);
  const known = (shared(ORDER_KEY) ?? []).filter((id) => live.includes(id));
  const order = [...known, ...live.filter((id) => !known.includes(id))];
  const at = order.indexOf(focused()?.space);
  if (at < 0) return run(dir > 0 ? "space.next" : "space.prev", {});
  run("space.select", { id: order[(at + dir + order.length) % order.length] });
}
