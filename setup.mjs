// Township Helper: task breakdowns + activity queue for Melvor Idle
export function setup(ctx) {
(() => {
  "use strict";

  const VERSION = "0.3.2";
  const LOG = (...a) => console.log("[Township Helper]", ...a);
  const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
  const nm = (o) => String(o?.name ?? o?._name ?? o?._localID ?? o?.id ?? "?");
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plain = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const icon = (o) => (typeof o?.media === "string" ? `<img class="skill-icon-xs mr-1" src="${esc(o.media)}">` : "");
  const have = (item) => {
    try { const q = game.bank.getQty(item); return Number.isFinite(q) ? q : null; } catch (e) { return null; }
  };
  const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
  const skillById = (id) => list(game.skills).find((s) => s.id === id);
  const actionById = (skill, id) => list(skill?.actions).find((a) => a.id === id);

  // ---------- recipe index (built on first use) ----------
  let idx = null;
  const buildIndex = () => {
    if (idx) return idx;
    idx = { crafters: new Map(), gatherers: new Map(), randoms: new Map(), droppers: new Map(), shop: new Map() };
    for (const skill of list(game.skills)) {
      for (const a of list(skill.actions)) {
        const isCraft = Array.isArray(a.itemCosts) && (a.itemCosts.length > 0 || (a.alternativeCosts?.length ?? 0) > 0);
        if (a.product) push(isCraft ? idx.crafters : idx.gatherers, a.product.id, { skill, a });
        for (const rp of a.randomProducts ?? []) if (rp?.id) push(idx.randoms, rp.id, { skill, a });
      }
    }
    for (const m of list(game.monsters)) {
      const drops = m.lootTable?.drops ?? m.lootTable?._drops ?? [];
      if (Array.isArray(drops)) for (const d of drops) if (d?.item) push(idx.droppers, d.item.id, m);
      if (m.bones?.item) push(idx.droppers, m.bones.item.id, m);
    }
    try {
      for (const p of list(game.shop?.purchases)) {
        for (const c of p.contains?.items ?? []) if (c?.item) push(idx.shop, c.item.id, p);
      }
    } catch (e) { console.warn("[Township Helper] shop index failed", e); }
    return idx;
  };

  const baseCosts = (a) => (Array.isArray(a.itemCosts) ? a.itemCosts : []);
  const options = (a) =>
    a.alternativeCosts?.length
      ? a.alternativeCosts.map((o) => ({ costs: o.itemCosts ?? [], mult: o.quantityMultiplier ?? 1 }))
      : [{ costs: [], mult: 1 }];

  const explode = (item, qty, depth, path, nodes) => {
    const n = nodes.get(item.id) ?? { item, qty: 0, depth: 0 };
    n.qty += qty;
    n.depth = Math.max(n.depth, depth);
    nodes.set(item.id, n);
    const c = idx.crafters.get(item.id)?.[0];
    if (!c || path.has(item.id) || depth > 12) return;
    const opt = options(c.a)[0];
    const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult);
    const crafts = Math.ceil(qty / per);
    n.recipe = { c, opt, crafts };
    path.add(item.id);
    for (const cost of [...baseCosts(c.a), ...opt.costs]) {
      if (cost?.item) explode(cost.item, cost.quantity * crafts, depth + 1, path, nodes);
    }
    path.delete(item.id);
  };

  const where = (x) => `${esc(nm(x.skill))} &gt; ${esc(nm(x.a))} (lvl ${x.a.level ?? 1})`;
  const shopCost = (p) => {
    const cur = (p.costs?.currencies ?? []).map((c) => `${Number(c.cost ?? c.quantity ?? 0).toLocaleString()} ${esc(nm(c.currency))}`);
    const its = (p.costs?.items ?? []).map((c) => `${Number(c.quantity).toLocaleString()} ${esc(nm(c.item))}`);
    return `${esc(nm(p))} for ${[...cur, ...its].join(" + ") || "free"}`;
  };
  const sourceText = (id) => {
    const parts = [];
    const g = idx.gatherers.get(id);
    if (g) parts.push("gather: " + g.slice(0, 3).map(where).join("; "));
    const r = idx.randoms.get(id);
    if (r) parts.push("random drop while: " + r.slice(0, 3).map(where).join("; "));
    const d = idx.droppers.get(id);
    if (d) parts.push("monster drop: " + d.slice(0, 4).map((m) => esc(nm(m))).join(", ") + (d.length > 4 ? ` (+${d.length - 4} more)` : ""));
    const s = idx.shop.get(id);
    if (s) parts.push("shop: " + s.slice(0, 2).map(shopCost).join("; "));
    return parts.length ? parts.join(" | ") : "no source found in the game data (chest, event or other)";
  };

  // ---------- breakdown rows -> popup html / queue entries ----------
  const buildRows = (item, qty) => {
    buildIndex();
    const nodes = new Map();
    explode(item, qty, 0, new Set(), nodes);
    return [...nodes.values()].sort((a, b) => b.depth - a.depth || nm(a.item).localeCompare(nm(b.item)));
  };

  const itemSection = (item, qty) => {
    const steps = buildRows(item, qty).map((n) => {
      const owned = have(n.item);
      const ownedTxt = owned === null ? "" : ` <span class="text-muted">(you have ${owned.toLocaleString()})</span>`;
      if (n.recipe) {
        const { c, opt, crafts } = n.recipe;
        const uses =
          [...baseCosts(c.a), ...opt.costs].map((x) => `${(x.quantity * crafts).toLocaleString()} ${esc(nm(x.item))}`).join(", ") || "nothing";
        const alts = (idx.crafters.get(n.item.id)?.length ?? 1) - 1 + options(c.a).length - 1;
        return (
          `<li class="mb-2">${icon(n.item)}<b>${esc(nm(c.skill))}</b>: make <b>${esc(nm(n.item))}</b> x${n.qty.toLocaleString()}${ownedTxt}` +
          `<br><small class="text-muted">${crafts.toLocaleString()} craft${crafts === 1 ? "" : "s"}, level ${c.a.level ?? 1}, uses ${uses}` +
          (alts > 0 ? ` &middot; ${alts} other recipe/input option${alts === 1 ? "" : "s"} exist` : "") +
          `</small></li>`
        );
      }
      return `<li class="mb-2">${icon(n.item)}<b>${esc(nm(n.item))}</b> x${n.qty.toLocaleString()}${ownedTxt}<br><small class="text-muted">${sourceText(n.item.id)}</small></li>`;
    });
    return `<ol class="pl-4 mb-0">${steps.join("")}</ol>`;
  };

  // Queue entries: "kind" is what the runner does; qty is how many MORE of the item to end up with
  // (for "manual" entries it is how many you should own).
  const toEntries = (rows) =>
    rows.map((n) => {
      const base = { itemId: n.item.id, qty: n.qty };
      if (n.recipe) {
        const { c } = n.recipe;
        return { ...base, kind: "craft", skillId: c.skill.id, actionId: c.a.id, altIndex: 0, label: `${nm(c.skill)}: make ${nm(n.item)}` };
      }
      const g = idx.gatherers.get(n.item.id)?.[0];
      if (g) return { ...base, kind: "gather", skillId: g.skill.id, actionId: g.a.id, label: `${nm(g.skill)}: gather ${nm(n.item)}` };
      return { ...base, kind: "manual", label: `Get ${nm(n.item)}`, note: plain(sourceText(n.item.id)) };
    });

  const AREA_KINDS = [
    ["combatAreas", "Combat area"], ["slayerAreas", "Slayer area"], ["dungeons", "Dungeon"],
    ["strongholds", "Stronghold"], ["abyssDepths", "Abyssal depth"],
  ];
  const monsterSection = (m, kills) => {
    const places = [];
    for (const [key, label] of AREA_KINDS) {
      for (const a of list(game[key])) {
        if ((a.monsters ?? []).includes(m)) {
          const slv = a.slayerLevelRequired ? `, Slayer lvl ${a.slayerLevelRequired}` : "";
          places.push(`${label}: ${esc(nm(a))}${slv}`);
        }
      }
    }
    const facts = [];
    if (m.combatLevel !== undefined) facts.push(`combat level ${m.combatLevel}`);
    if (m.levels?.Hitpoints !== undefined) facts.push(`${m.levels.Hitpoints} HP`);
    if (m.attackType) facts.push(`${esc(m.attackType)} attacker`);
    if (m.isBoss) facts.push("boss");
    return (
      `<div class="mb-2">${icon(m)}<b>${esc(nm(m))}</b>${kills ? ` x${kills.toLocaleString()}` : ""}` +
      (facts.length ? `<br><small class="text-muted">${facts.join(", ")}</small>` : "") + `</div>` +
      `<div><b>Where to find it</b><br><small>${places.length ? places.slice(0, 8).join("<br>") + (places.length > 8 ? `<br>(+${places.length - 8} more)` : "") : "not found in any area list (may be event or special content)"}</small></div>`
    );
  };

  const heading = (t) => `<h5 class="font-w600 text-warning mt-3 mb-1">${t}</h5>`;
  // onQueue(top) is called with top=true for "Add to top", false for "Add to queue"
  const fire = (title, body, onQueue) => {
    const res = SwalLocale.fire({
      title,
      html: `<div class="text-left font-size-sm">${body}</div>`,
      confirmButtonText: "Close",
      showDenyButton: !!onQueue,
      denyButtonText: '<i class="fa fa-play mr-1"></i>Add to queue',
      showCancelButton: !!onQueue,
      cancelButtonText: '<i class="fa fa-play mr-1"></i><i class="fa fa-arrow-up mr-1"></i>Add to top',
      customClass: { denyButton: "btn btn-sm btn-success mbd-th-add", cancelButton: "btn btn-sm btn-success mbd-th-add" },
      width: 620,
    });
    if (onQueue && res?.then) {
      res.then((r) => {
        try {
          if (r?.isDenied) onQueue(false);
          else if (r?.dismiss === "cancel") onQueue(true);
        } catch (e) { console.warn("[Township Helper]", e); }
      });
    }
  };

  // ---------- queue (saved locally, one list per character name) ----------
  const Queue = {
    items: [],
    key() { return `mbd-th-queue:${game.characterName ?? "default"}`; },
    load() {
      try { const raw = localStorage.getItem(this.key()); this.items = raw ? JSON.parse(raw) : []; } catch (e) { this.items = []; }
      // the runner never survives a reload, so nothing is "in progress" any more (progress counts are kept)
      for (const e of this.items) {
        if (e.status === "active" || e.status === "waiting" || e.status === "blocked") e.status = "pending";
        delete e.reason; delete e.ack;
      }
      updateBadge();
    },
    save() {
      try { localStorage.setItem(this.key(), JSON.stringify(this.items)); } catch (e) { console.warn("[Township Helper] could not save queue", e); }
      updateBadge();
      Panel.render();
    },
    add(entries, top = false) {
      const fresh = entries.map((e) => ({ ...e, id: uid(), status: "pending" }));
      this.items = top ? [...fresh, ...this.items] : [...this.items, ...fresh];
      this.save();
    },
    remove(id) { this.items = this.items.filter((e) => e.id !== id); this.save(); },
    move(id, dir) {
      const i = this.items.findIndex((e) => e.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= this.items.length) return;
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
      this.save();
    },
    toTop(id) {
      const i = this.items.findIndex((e) => e.id === id);
      if (i <= 0) return;
      const [e] = this.items.splice(i, 1);
      this.items.unshift(e);
      this.save();
    },
    clearDone() { this.items = this.items.filter((e) => e.status !== "done"); this.save(); },
    clear() { Runner.stop(); this.items = []; this.save(); },
  };

  const updateBadge = () => {
    const b = document.querySelector("#mbd-queue-btn .mbd-count");
    if (!b) return;
    const n = Queue.items.filter((e) => e.status !== "done").length;
    b.textContent = n ? String(n) : "";
    b.style.display = n ? "block" : "none";
  };

  // ---------- starting actions in the game ----------
  // Uses the game's own click handlers, in the same order its buttons use them.
  const startEntry = (e) => {
    const skill = skillById(e.skillId);
    const a = skill && actionById(skill, e.actionId);
    if (!skill || !a) return { ok: false, reason: "this action wasn't found in your game version" };
    if (a.level > skill.level) return { ok: false, reason: `needs ${nm(skill)} level ${a.level}` };
    try {
      if (game.activeAction && game.activeAction !== skill) game.stopActiveAction();
      if (skill.isActive && skill.stop() === false) return { ok: false, reason: "couldn't stop the current activity" };
      switch (skill.id) {
        case "melvorD:Woodcutting":
          skill.activeTrees.clear();
          skill.selectTree(a);
          break;
        case "melvorD:Mining":
          if (a.isRespawning) return { ok: false, transient: true, reason: "waiting for the rock to respawn" };
          if (!skill.canMineOre(a)) return { ok: false, reason: "can't mine this yet (level, mastery or shop unlock)" };
          skill.selectedRock = undefined;
          skill.onRockClick(a);
          break;
        case "melvorD:Fishing": {
          const area = list(skill.areas).find((ar) => (ar.fish ?? []).includes(a));
          if (!area) return { ok: false, reason: "no fishing area found for this fish" };
          skill.onAreaFishSelection(area, a);
          skill.onAreaStartButtonClick(area);
          break;
        }
        case "melvorD:Cooking":
          skill.onRecipeSelectionClick(a);
          skill.onActiveCookButtonClick(a.category);
          break;
        default:
          if (typeof skill.selectRecipeOnClick === "function" && typeof skill.createButtonOnClick === "function") {
            skill.selectRecipeOnClick(a);
            if (a.alternativeCosts?.length && typeof skill.selectAltRecipeOnClick === "function") skill.selectAltRecipeOnClick(e.altIndex ?? 0);
            if (!skill.isActive) skill.createButtonOnClick();
          } else {
            return { ok: false, reason: `automating ${nm(skill)} isn't supported yet` };
          }
      }
    } catch (err) {
      return { ok: false, reason: "error: " + err.message };
    }
    if (skill.isActive) return { ok: true };
    return { ok: false, reason: e.kind === "craft" ? "not enough materials (or level too low)" : "the game wouldn't start it" };
  };

  // ---------- runner: takes entries from the top of the list, one at a time ----------
  const Runner = {
    state: "idle", // idle | running | paused
    message: "",
    activeId: null,
    activeSkillId: null,
    setState(s, msg = "") { this.state = s; this.message = msg; Panel.render(); },
    current() { return Queue.items.find((e) => e.status !== "done"); },
    gained(e) {
      if (e.startQty === undefined) return 0;
      return Math.max(0, (have(itemById(e.itemId)) ?? 0) - e.startQty);
    },
    haltAction() {
      const s = this.activeSkillId ? skillById(this.activeSkillId) : null;
      try { if (s && game.activeAction === s) game.stopActiveAction(); } catch (e) { console.warn("[Township Helper]", e); }
    },
    leave() {
      if (this.activeId === null) return;
      const prev = Queue.items.find((e) => e.id === this.activeId);
      if (prev && prev.status === "active") prev.status = "pending";
      this.haltAction();
      this.activeId = null;
      this.activeSkillId = null;
    },
    start() {
      const cur = this.current();
      if (!cur) { this.setState("idle", "Nothing to run: the queue is empty or finished."); return; }
      if (cur.kind === "manual" && cur.status === "waiting") cur.ack = true;
      this.state = "running";
      this.message = "";
      this.step();
      Panel.render();
    },
    pause(msg = "Paused") {
      if (this.state !== "running") return;
      this.haltAction();
      this.setState("paused", msg);
    },
    stop() {
      this.haltAction();
      const cur = Queue.items.find((e) => e.id === this.activeId);
      if (cur && cur.status !== "done") { cur.status = "pending"; delete cur.startQty; delete cur.reason; }
      this.activeId = null;
      this.activeSkillId = null;
      this.state = "idle";
      this.message = "Stopped";
      Queue.save();
    },
    block(entry, reason) {
      entry.status = "blocked";
      entry.reason = reason;
      this.haltAction();
      this.activeId = null;
      this.activeSkillId = null;
      Queue.save();
      this.setState("paused", `Stopped at "${entry.label}": ${reason}. Fix it, then press Start.`);
    },
    finish(entry) {
      entry.status = "done";
      delete entry.reason;
      const s = skillById(entry.skillId);
      try { if (s && game.activeAction === s) game.stopActiveAction(); } catch (e) { console.warn("[Township Helper]", e); }
      this.activeId = null;
      this.activeSkillId = null;
      Queue.save();
    },
    step() {
      if (this.state !== "running") return;
      for (let guard = 0; guard < 100; guard++) {
        const cur = this.current();
        if (!cur) { this.leave(); this.setState("idle", "Queue finished"); return; }

        // a different entry is now on top (we just started, or something was added above): switch to it
        if (this.activeId !== cur.id) {
          this.leave();
          this.activeId = cur.id;
          this.activeSkillId = cur.skillId ?? null;
          cur.status = "active";
          delete cur.reason;
          if (cur.kind !== "manual" && cur.startQty === undefined) cur.startQty = have(itemById(cur.itemId)) ?? 0;
          Queue.save();
          if (cur.kind !== "manual") {
            const r = startEntry(cur);
            if (!r.ok) {
              if (r.transient) { this.message = r.reason; Panel.render(); return; }
              this.block(cur, r.reason);
              return;
            }
          }
        }

        const owned = have(itemById(cur.itemId)) ?? 0;
        if (cur.kind === "manual") {
          if (owned >= cur.qty || cur.ack) { this.finish(cur); continue; }
          cur.status = "waiting";
          this.activeId = null;
          this.activeSkillId = null;
          Queue.save();
          this.setState("paused", `Your turn: ${cur.label} x${Number(cur.qty).toLocaleString()} (you have ${owned.toLocaleString()}). Do it, then press Start.`);
          return;
        }

        if (owned - (cur.startQty ?? 0) >= cur.qty) { this.finish(cur); continue; }

        const skill = skillById(cur.skillId);
        if (skill && skill.isActive && game.activeAction === skill) { Panel.render(); return; }
        if (game.activeAction && game.activeAction !== skill) { this.pause("Paused: something else started running."); return; }

        // nothing is running and the target isn't reached: the game stopped it (materials, etc.) so try again once
        const r = startEntry(cur);
        if (r.ok) { Panel.render(); return; }
        if (r.transient) { this.message = r.reason; Panel.render(); return; }
        this.block(cur, `${r.reason} (${this.gained(cur).toLocaleString()} of ${Number(cur.qty).toLocaleString()} done)`);
        return;
      }
    },
  };

  // ---------- floating panel ----------
  const Panel = {
    el: null,
    last: "",
    ensure() {
      if (this.el) return this.el;
      document.getElementById("mbd-queue-panel")?.remove();
      const el = document.createElement("div");
      el.id = "mbd-queue-panel";
      el.style.cssText =
        "position:fixed;right:68px;bottom:16px;width:350px;max-height:70vh;display:none;flex-direction:column;z-index:1050;" +
        "background:rgba(28,32,41,.98);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:8px;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px";
      el.addEventListener("click", (ev) => {
        const a = ev.target.closest("[data-act]");
        if (!a || a.disabled) return;
        ev.preventDefault();
        const act = a.dataset.act, id = a.dataset.id;
        if (act === "close") this.close();
        else if (act === "up") Queue.move(id, -1);
        else if (act === "down") Queue.move(id, 1);
        else if (act === "top") Queue.toTop(id);
        else if (act === "remove") Queue.remove(id);
        else if (act === "clear") Queue.clear();
        else if (act === "cleardone") Queue.clearDone();
        else if (act === "start") Runner.start();
        else if (act === "pause") Runner.pause("Paused");
        else if (act === "stop") Runner.stop();
      });
      document.body.appendChild(el);
      this.el = el;
      return el;
    },
    row(e) {
      const item = itemById(e.itemId);
      const manual = e.kind === "manual";
      const done = e.status === "done";
      const warn = e.status === "blocked" || e.status === "waiting";
      const lead = done ? '<i class="fa fa-check text-success mr-2"></i>'
        : e.status === "active" ? '<i class="fa fa-play text-success mr-2"></i>'
        : warn ? '<i class="fa fa-exclamation-triangle text-warning mr-2"></i>'
        : '<i class="fa fa-circle mr-2" style="opacity:.25;font-size:8px;vertical-align:middle"></i>';
      const showProgress = !manual && !done && e.startQty !== undefined && (e.status === "active" || e.status === "blocked" || Runner.gained(e) > 0);
      const amount = showProgress ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.qty).toLocaleString()}</b>` : `<b>x${Number(e.qty).toLocaleString()}</b>`;
      const btn = (act, ic, title) =>
        `<a data-act="${act}" data-id="${esc(e.id)}" class="pointer-enabled text-white-50 ml-2" title="${title}"><i class="fa ${ic}"></i></a>`;
      const sub = e.reason ? `<br><small class="text-warning">${esc(e.reason)}</small>`
        : manual && !done ? `<br><small class="text-muted">do this yourself${e.status === "waiting" ? " (waiting for you)" : ""}</small>` : "";
      return (
        `<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.07);${done ? "opacity:.5" : ""}" ${manual ? `title="${esc(e.note ?? "")}"` : ""}>` +
        `<div style="flex:1;min-width:0">${lead}${icon(item)}<span class="${manual ? "text-muted font-italic" : ""}" style="${done ? "text-decoration:line-through" : ""}">${esc(e.label)}</span> ${amount}${sub}</div>` +
        (done ? btn("remove", "fa-times", "Remove") :
          btn("top", "fa-angle-double-up", "Move to top") + btn("up", "fa-arrow-up", "Move up") + btn("down", "fa-arrow-down", "Move down") + btn("remove", "fa-times", "Remove")) +
        `</div>`
      );
    },
    render() {
      if (!this.el) return;
      const q = Queue.items;
      const pending = q.filter((e) => e.status !== "done").length;
      const running = Runner.state === "running";
      const statusText = running ? (Runner.message || "Running") : Runner.state === "paused" ? (Runner.message || "Paused") : (Runner.message || "Idle");
      const dot = running ? "#28a745" : Runner.state === "paused" ? "#ffc107" : "#6c757d";
      const b = (act, label, ic, cls, disabled) =>
        `<button class="btn btn-sm ${cls}" data-act="${act}" ${disabled ? "disabled" : ""} style="padding:2px 10px"><i class="fa ${ic} mr-1"></i>${label}</button>`;
      const html =
        `<div style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12)">` +
        `<b style="flex:1">Activity queue</b><span class="text-muted mr-2">${pending} to do</span>` +
        `<a data-act="close" class="pointer-enabled text-white" title="Close"><i class="fa fa-times"></i></a></div>` +
        `<div data-list style="overflow:auto;padding:4px 10px;flex:1">` +
        (q.length ? q.map((e) => this.row(e)).join("") : `<div class="text-muted py-3 text-center">Nothing queued yet.<br>Open a Township task's "How to" button and choose "Add to queue" or "Add to top".</div>`) +
        `</div>` +
        `<div style="padding:8px 10px;border-top:1px solid rgba(255,255,255,.12)">` +
        `<div style="display:flex;align-items:flex-start;margin-bottom:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${dot};margin:5px 6px 0 0;flex:none"></span><small style="flex:1">${esc(statusText)}</small></div>` +
        `<div style="display:flex;align-items:center;gap:6px">` +
        b("start", Runner.state === "paused" ? "Resume" : "Start", "fa-play", "btn-success", running || pending === 0) +
        b("pause", "Pause", "fa-pause", "btn-warning", !running) +
        b("stop", "Stop", "fa-stop", "btn-danger", Runner.state === "idle") +
        `<span style="margin-left:auto;white-space:nowrap"><a data-act="cleardone" class="pointer-enabled text-info mr-2"><small>Clear done</small></a><a data-act="clear" class="pointer-enabled text-danger"><small>Clear all</small></a></span>` +
        `</div></div>`;
      if (html === this.last) return;
      const prev = this.el.querySelector("[data-list]");
      const top = prev ? prev.scrollTop : 0;
      this.el.innerHTML = html;
      this.last = html;
      const next = this.el.querySelector("[data-list]");
      if (next) next.scrollTop = top;
    },
    open() { this.ensure().style.display = "flex"; this.last = ""; this.render(); },
    close() { if (this.el) this.el.style.display = "none"; },
    toggle() { this.ensure(); this.el.style.display === "flex" ? this.close() : this.open(); },
  };

  // ---------- minibar button (bottom-right menu), sized like its neighbours ----------
  const mountButton = () => {
    const bar = document.getElementById("skill-footer-minibar");
    if (!bar) return;
    let b = document.getElementById("mbd-queue-btn");
    if (!b) {
      b = document.createElement("button");
      b.className = "btn btn-sm btn-light";
      b.id = "mbd-queue-btn";
      b.title = "Activity queue";
      b.style.position = "relative";
      b.innerHTML =
        '<i class="fa fa-list-ol text-dark" style="display:inline-block;width:24px;height:24px;line-height:24px;font-size:17px;text-align:center;vertical-align:middle"></i>' +
        '<span class="mbd-count" style="display:none;position:absolute;top:-6px;right:-6px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#17a2b8;color:#fff;font-size:10px;font-weight:600;line-height:17px;text-align:center"></span>';
      b.addEventListener("click", () => { Panel.toggle(); b.blur(); });
      bar.appendChild(b);
      updateBadge();
    }
    const ref = [...bar.children].find((c) => c !== b && c.offsetWidth > 0);
    if (ref) { b.style.width = ref.offsetWidth + "px"; b.style.height = ref.offsetHeight + "px"; }
  };

  // ---------- goal -> popup ----------
  const describeGoal = (goal) => {
    const type = goal?.constructor?.name;
    if (type === "TownshipItemGoal" && goal.item) {
      return {
        title: `${goal.quantity.toLocaleString()} x ${esc(nm(goal.item))}`,
        body: () => itemSection(goal.item, goal.quantity),
        queue: () => toEntries(buildRows(goal.item, goal.quantity)),
      };
    }
    if ((type === "TownshipMonsterGoal" || type === "TownshipCasualMonsterGoal") && goal.monster) {
      return { title: esc(nm(goal.monster)), body: () => monsterSection(goal.monster, goal.quantity) };
    }
    if (type === "TownshipMonsterWithItemsGoal" && goal.monster) {
      return {
        title: esc(nm(goal.monster)),
        body: () =>
          monsterSection(goal.monster, goal.quantity) +
          (goal.items ?? []).map((it) => heading(`Equipment needed: ${esc(nm(it))}`) + itemSection(it, 1)).join(""),
        queue: () => (goal.items ?? []).flatMap((it) => toEntries(buildRows(it, 1))),
      };
    }
    return null;
  };

  const decorate = (el, goal) => {
    const holder = el.container ?? el;
    holder.querySelector(".mbd-th-btn")?.remove();
    const info = describeGoal(goal);
    if (!info) return;
    // centre the text and the button on one line
    Object.assign(holder.style, { display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "8px" });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mbd-th-btn btn btn-sm btn-success";
    btn.style.cssText = "padding:2px 10px;line-height:1.5;white-space:nowrap;flex:none";
    btn.title = "Show how to get this (and add it to the queue)";
    btn.setAttribute("aria-label", "Show how to get this");
    btn.innerHTML = '<i class="fa fa-play"></i>';
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const onQueue = info.queue ? (top) => { Queue.add(info.queue(), top); Panel.open(); } : null;
        fire(info.title, info.body(), onQueue);
      } catch (e) { console.warn("[Township Helper]", e); }
    });
    holder.appendChild(btn);
  };

  // ---------- install ----------
  const refresh = () => {
    try {
      const t = game.township.tasks;
      for (const task of list(t.tasks)) t.renderQueue.taskGoals.add(task);
      t.render();
    } catch (e) { console.warn("[Township Helper] refresh failed", e); }
  };

  const install = () => {
    const proto = customElements.get("township-task-goal").prototype;
    const orig = proto.__mbdOrig ?? proto.setGoal;
    proto.__mbdOrig = orig;
    proto.setGoal = function (goal) {
      orig.call(this, goal);
      try { decorate(this, goal); } catch (e) { console.warn("[Township Helper]", e); }
    };
    Queue.load();
    mountButton();
    clearInterval(window.__mbdThTimer);
    window.__mbdThTimer = setInterval(mountButton, 2000); // the game can rebuild the menu; put our button back if it vanishes
    clearInterval(window.__mbdThRunTimer);
    window.__mbdThRunTimer = setInterval(() => { try { Runner.step(); } catch (e) { console.warn("[Township Helper] runner", e); } }, 1000);
    refresh();
    window.townshipHelper = {
      version: VERSION,
      showItem: (id, qty = 1) => {
        const it = itemById(id);
        fire(`${qty} x ${esc(nm(it))}`, itemSection(it, qty), (top) => { Queue.add(toEntries(buildRows(it, qty)), top); Panel.open(); });
      },
      refresh,
      queue: Queue,
      panel: Panel,
      runner: Runner,
    };
    LOG("installed", VERSION);
  };

  const ready = () =>
    typeof game !== "undefined" &&
    list(game?.township?.tasks?.tasks).length > 0 &&
    customElements.get("township-task-goal") &&
    typeof SwalLocale !== "undefined" &&
    document.getElementById("skill-footer-minibar");

  if (ready()) install();
  else {
    const timer = setInterval(() => { if (ready()) { clearInterval(timer); install(); } }, 500);
  }
})();
}
