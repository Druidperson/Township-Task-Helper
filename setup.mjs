// Township Helper: task breakdowns + action queue for Melvor Idle
export function setup(ctx) {
(() => {
  "use strict";

  const VERSION = "0.7.0";
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
  // ---------- settings ----------
  // As a Melvor mod, the switch lives in the mod settings menu (ctx.settings). It is also on the queue panel,
  // and falls back to localStorage if the settings API isn't there (userscript use).
  const AUTO_KEY = "mbd-th-autostart";
  const Settings = {
    api: null,
    autoStart() {
      try { if (this.api) return !!this.api.get("autoStart"); } catch (e) { /* use fallback */ }
      try { return localStorage.getItem(AUTO_KEY) === "1"; } catch (e) { return false; }
    },
    setAutoStart(v) {
      try { if (this.api) this.api.set("autoStart", !!v); } catch (e) { console.warn("[Township Helper] settings", e); }
      try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch (e) { /* ignore */ }
    },
  };
  if (typeof ctx !== "undefined" && ctx?.settings) {
    try {
      const section = ctx.settings.section("General");
      section.add({
        type: "switch",
        name: "autoStart",
        label: "Automatically start the Action Queue when adding a task",
        hint: "When on, adding a task to the queue starts the queue right away. When off, you press Start yourself.",
        default: false,
      });
      Settings.api = section;
    } catch (e) { console.warn("[Township Helper] could not register settings", e); }
  }
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

  const num = (n) => Number(n).toLocaleString();
  const chip = (html, cls = "", title = "") => `<span class="mbd-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}>${html}</span>`;
  const where = (x) => `${esc(nm(x.skill))}: ${esc(nm(x.a))} (Lv ${x.a.level ?? 1})`;
  const shopCost = (p) => {
    const cur = (p.costs?.currencies ?? []).map((c) => `${Number(c.cost ?? c.quantity ?? 0).toLocaleString()} ${esc(nm(c.currency))}`);
    const its = (p.costs?.items ?? []).map((c) => `${Number(c.quantity).toLocaleString()} ${esc(nm(c.item))}`);
    return `${esc(nm(p))} for ${[...cur, ...its].join(" + ") || "free"}`;
  };
  // where an item comes from, as structured parts
  const sourceParts = (id) => {
    const parts = [];
    const g = idx.gatherers.get(id);
    if (g) parts.push({ fa: "fa-hand-paper", label: "Gather", items: g.slice(0, 3).map(where) });
    const r = idx.randoms.get(id);
    if (r) parts.push({ fa: "fa-dice", label: "Random drop", items: r.slice(0, 3).map(where) });
    const d = idx.droppers.get(id);
    if (d) parts.push({ fa: "fa-skull", label: "Monster drop", items: [...d.slice(0, 4).map((m) => esc(nm(m))), ...(d.length > 4 ? [`+${d.length - 4} more`] : [])] });
    const s = idx.shop.get(id);
    if (s) parts.push({ fa: "fa-shopping-cart", label: "Shop", items: s.slice(0, 2).map(shopCost) });
    return parts;
  };
  const sourceText = (id) => {
    const parts = sourceParts(id);
    return parts.length ? parts.map((p) => `${p.label}: ${p.items.join("; ")}`).join(" | ") : "no source found in the game data (chest, event or other)";
  };
  const sourceHtml = (id) => {
    const parts = sourceParts(id);
    if (!parts.length) return `<div class="mbd-chips">${chip("No source found in the game data (chest, event or other)", "warn")}</div>`;
    return parts.map((p) => `<div class="mbd-chips">${chip(`<i class="fa ${p.fa}"></i> <b>${p.label}</b>`, "lbl")}${p.items.map((i) => chip(i)).join("")}</div>`).join("");
  };

  // ---------- breakdown rows -> popup html / queue entries ----------
  const buildRows = (item, qty) => {
    buildIndex();
    const nodes = new Map();
    explode(item, qty, 0, new Set(), nodes);
    return [...nodes.values()].sort((a, b) => b.depth - a.depth || nm(a.item).localeCompare(nm(b.item)));
  };

  const itemSection = (item, qty) => {
    const rows = buildRows(item, qty);
    return rows.map((n, i) => {
      const owned = have(n.item);
      const ok = owned !== null && owned >= n.qty;
      const haveChip = owned === null ? "" : chip(ok ? `<i class="fa fa-check"></i> Have ${num(owned)}` : `You have ${num(owned)}`, ok ? "ok" : "");
      let title, chips;
      if (n.recipe) {
        const { c, opt, crafts } = n.recipe;
        const uses = [...baseCosts(c.a), ...opt.costs].filter((x) => x?.item).map((x) => chip(`${icon(x.item)}${num(x.quantity * crafts)} ${esc(nm(x.item))}`));
        const alts = (idx.crafters.get(n.item.id)?.length ?? 1) - 1 + options(c.a).length - 1;
        title = `${icon(c.skill)}<b>${esc(nm(c.skill))}</b>: make ${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips =
          `<div class="mbd-chips">${chip(`Level ${c.a.level ?? 1}`)}${chip(`${num(crafts)} craft${crafts === 1 ? "" : "s"}`)}${haveChip}${alts > 0 ? chip(`${alts} other option${alts === 1 ? "" : "s"}`) : ""}</div>` +
          (uses.length ? `<div class="mbd-chips">${chip("<b>Uses</b>", "lbl")}${uses.join("")}</div>` : "");
      } else {
        title = `${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips = `<div class="mbd-chips">${haveChip}</div>` + sourceHtml(n.item.id);
      }
      return `<div class="mbd-step"><div class="mbd-stepno">Step ${i + 1}</div><div class="mbd-title">${title}</div>${chips}</div>`;
    }).join("");
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
    ["combatAreas", "Combat Area"], ["slayerAreas", "Slayer Area"], ["dungeons", "Dungeon"],
    ["strongholds", "Stronghold"], ["abyssDepths", "Abyssal Depth"],
  ];
  const ATTACK_ICON = { melee: "melvorD:Attack", ranged: "melvorD:Ranged", magic: "melvorD:Magic" };
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const TRIANGLE = { melee: "magic", ranged: "melee", magic: "ranged" }; // what beats what: Magic > Melee > Ranged > Magic
  const statVal = (m, key) => (m.equipmentStats ?? []).find((x) => x.key === key)?.value ?? 0;
  const styleChip = (t, cls = "", title = "", extra = "") => {
    const sk = skillById(ATTACK_ICON[t]);
    return chip(`${sk ? icon(sk) : ""}${esc(cap(t))}${extra}`, cls, title);
  };
  const row = (label, chips) => (chips.length ? `<div class="mbd-row"><div class="mbd-rowlbl">${label}</div><div class="mbd-chips">${chips.join("")}</div></div>` : "");
  const combatSection = (m) => {
    const styles = m.attackType === "random" ? ["melee", "ranged", "magic"] : m.attackType ? [m.attackType] : [];
    const attacks = styles.map((t) => styleChip(t));
    if (m.attackType === "random") attacks.push(chip("<small>picks one at random</small>"));
    if (m.damageType && m.damageType.id !== "melvorD:Normal") attacks.push(chip(`${typeof m.damageType.media === "string" ? icon(m.damageType) : ""}${esc(nm(m.damageType))}`));
    const specials = (m.specialAttacks ?? []).filter((x) => x?.attack).map((x) => chip(`${esc(nm(x.attack))} <small>${num(x.chance)}%</small>`, "", plain(String(x.attack.description ?? ""))));
    const passives = (m.passives ?? []).map((x) => chip(esc(nm(x)), "", plain(String(x.description ?? ""))));
    const def = { melee: statVal(m, "meleeDefenceBonus"), ranged: statVal(m, "rangedDefenceBonus"), magic: statVal(m, "magicDefenceBonus") };
    const low = Math.min(def.melee, def.ranged, def.magic);
    const lowStyles = new Set(Object.keys(def).filter((k) => def[k] === low && !(def.melee === def.ranged && def.ranged === def.magic)));
    const tri = TRIANGLE[m.attackType];
    const weak = [];
    if (tri) weak.push(styleChip(tri, "ok", `Combat triangle: ${cap(tri)} beats ${cap(m.attackType)}`, " <small>triangle</small>"));
    for (const k of lowStyles) {
      if (k === tri) continue;
      weak.push(styleChip(k, "ok", `Lowest defence bonus (${def[k]})`, ` <small>low defence</small>`));
    }
    const defence = ["melee", "ranged", "magic"].map((k) => styleChip(k, lowStyles.has(k) ? "ok" : "", `${cap(k)} defence bonus`, ` <small>${def[k] > 0 ? "+" : ""}${num(def[k])}</small>`));
    const resist = (m.equipmentStats ?? []).filter((x) => x.key === "resistance" && x.value).map((x) =>
      chip(`${x.damageType && typeof x.damageType.media === "string" ? icon(x.damageType) : ""}${esc(nm(x.damageType))} <small>${num(x.value)}%</small>`, "", x.value > 0 ? "Damage reduction" : "Takes extra damage"));
    return `<div class="mbd-step"><div class="mbd-stepno">Combat</div>` +
      row("Attacks with", attacks) + row("Special attacks", specials) + row("Passives", passives) +
      row("Weak to", weak) + row("Defence bonus", defence) + row("Resists", resist) + `</div>`;
  };

  // food and equipment sets, so the player can get ready for a fight
  const foodHtml = () => {
    const pl = game.combat?.player;
    const slots = pl?.food?.slots ?? [];
    const foods = slots.map((sl, i) => ({ sl, i })).filter((x) => x.sl.item && x.sl.quantity > 0);
    if (!foods.length) return chip('<i class="fa fa-exclamation-triangle"></i>&nbsp;No food equipped', "warn", "Equip food before fighting");
    return foods.map(({ sl, i }) => chip(`${icon(sl.item)}${esc(nm(sl.item))} <small>&times;${num(sl.quantity)}</small>`, i === pl.food.selectedSlot ? "ok" : "", i === pl.food.selectedSlot ? "Food in use" : "Backup food")).join("");
  };
  let setMsg = "";
  const switchSet = (i) => {
    const pl = game.combat?.player;
    setMsg = "";
    try { pl.changeEquipmentSet(i); } catch (e) { console.warn("[Township Helper]", e); }
    if (pl && pl.selectedEquipmentSet !== i) setMsg = "Couldn't switch sets right now (you may be in combat, or the set has a restriction).";
  };
  const setsHtml = () => {
    const pl = game.combat?.player;
    const sets = pl?.equipmentSets ?? [];
    if (!sets.length) return "";
    const sel = pl.selectedEquipmentSet;
    const itemsOf = (st) => (st.equipment?.equippedArray ?? []).filter((x) => !x.isEmpty && x.item);
    const btns = sets.map((st, i) => {
      const names = itemsOf(st).map((x) => nm(x.item)).join(", ") || "Nothing equipped";
      return `<button type="button" class="btn btn-sm ${i === sel ? "btn-primary" : "btn-outline-secondary"}" data-mbd-set="${i}" title="${esc(names)}">${i === sel ? '<i class="fa fa-check mr-1"></i>' : ""}Set ${i + 1}</button>`;
    }).join("");
    const worn = itemsOf(sets[sel] ?? sets[0]);
    return `<div class="mbd-chips">${btns}</div>` +
      `<div class="mbd-chips">${worn.length ? worn.map((x) => chip(`${icon(x.item)}${esc(nm(x.item))}`, "", nm(x.item))).join("") : chip("Nothing equipped in this set")}</div>` +
      (setMsg ? `<div class="mbd-chips">${chip(esc(setMsg), "warn")}</div>` : "");
  };
  const gearSection = () => {
    if (!game.combat?.player) return "";
    return `<div class="mbd-step"><div class="mbd-stepno">Gear</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Food</div><div class="mbd-chips mbd-food">${foodHtml()}</div></div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Equipment sets (click to switch)</div><div class="mbd-sets">${setsHtml()}</div></div></div>`;
  };

  const monsterSection = (m, kills) => {
    const places = [];
    for (const [key, label] of AREA_KINDS) {
      for (const a of list(game[key])) {
        if ((a.monsters ?? []).includes(m)) {
          const slv = a.slayerLevelRequired ? ` &middot; Slayer Lv ${a.slayerLevelRequired}` : "";
          places.push(`<div class="mbd-place">${icon(a)}<b>${label}:</b> ${esc(nm(a))}${slv}</div>`);
        }
      }
    }
    const chips = [];
    if (m.combatLevel !== undefined) chips.push(chip(`Combat Level: <b>${num(m.combatLevel)}</b>`));
    const hpLvl = m.levels?.Hitpoints;
    if (hpLvl !== undefined) {
      const hp = hpLvl * (typeof numberMultiplier === "number" ? numberMultiplier : 10);
      const hs = skillById("melvorD:Hitpoints");
      chips.push(chip(`${hs ? icon(hs) : '<i class="fa fa-heart text-danger"></i> '}<b>${num(hp)}</b>`, "", "Hitpoints"));
    }
    if (m.isBoss) chips.push(chip('<i class="fa fa-skull"></i> Boss', "warn"));
    return (
      `<div class="mbd-step"><div class="mbd-title" style="font-size:18px">` +
      (typeof m.media === "string" ? `<img src="${esc(m.media)}" style="width:56px;height:56px;object-fit:contain;display:block;margin:0 auto 4px">` : "") +
      `<b>${esc(nm(m))}</b>${kills ? ` &times;${num(kills)}` : ""}</div>` +
      `<div class="mbd-chips">${chips.join("")}</div></div>` +
      combatSection(m) + gearSection() +
      `<div class="mbd-sec">Location:</div>` +
      (places.length
        ? places.slice(0, 8).join("") + (places.length > 8 ? `<div class="mbd-place">+${places.length - 8} more</div>` : "")
        : `<div class="mbd-place">Not found in any area list (may be event or special content)</div>`)
    );
  };

  const heading = (t) => `<h5 class="font-w600 text-warning mt-3 mb-1">${t}</h5>`;
  // onQueue(top) is called with top=true for "Add to top", false for "Add to queue"
  const fire = (title, body, onQueue) => {
    const res = SwalLocale.fire({
      title,
      html: `<div class="text-center font-size-sm mbd-th-pop">${body}</div>`,
      confirmButtonText: "Close",
      showDenyButton: !!onQueue,
      denyButtonText: '<i class="fa fa-play mr-1"></i>Add to queue',
      showCancelButton: !!onQueue,
      cancelButtonText: '<i class="fa fa-arrow-up mr-1"></i>Add to top',
      // same shape and size as the Close button (btn btn-primary m-1), different colours
      customClass: { confirmButton: "btn btn-primary m-1", denyButton: "btn btn-success m-1", cancelButton: "btn btn-warning m-1" },
      didOpen: (popup) => {
        const acts = popup?.querySelector?.(".swal2-actions");
        if (acts) Object.assign(acts.style, { display: "flex", justifyContent: "center", alignItems: "center", gap: "12px", flexWrap: "nowrap" });
        // order: Add to queue, Add to top, Close
        const ord = { ".swal2-deny": "1", ".swal2-cancel": "2", ".swal2-confirm": "3" };
        for (const [sel, o] of Object.entries(ord)) { const el = popup?.querySelector?.(sel); if (el) el.style.order = o; }
        popup?.addEventListener?.("click", (ev) => {
          const b = ev.target.closest?.("[data-mbd-set]");
          if (!b) return;
          ev.preventDefault();
          ev.stopPropagation();
          switchSet(Number(b.dataset.mbdSet));
          const box = popup.querySelector(".mbd-sets");
          if (box) box.innerHTML = setsHtml();
          const fb = popup.querySelector(".mbd-food");
          if (fb) fb.innerHTML = foodHtml();
        });
      },
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
        delete e.reason; delete e.ack; delete e.t0; delete e.g0;
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
  const startAction = (e) => {
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
        case "melvorD:Firemaking":
          if (have(a.log) !== null && have(a.log) < 1) return { ok: false, reason: `no ${nm(a.log)} in the bank` };
          skill.selectLog(a);
          skill.burnLog();
          break;
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

  // ---------- XP goals: pick the fastest XP method the player can use right now ----------
  const MELVOR_REALM = "melvorD:Melvor";
  const xpRate = (skill, a) => {
    const ms = a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
    return ms > 0 ? ((a.baseExperience ?? 0) / ms) * 3600000 : 0;
  };
  // which recipe input option (if any) the bank can pay for right now; null = not affordable
  const affordableOption = (a) => {
    const owns = (costs) => (costs ?? []).every((c) => !c?.item || (have(c.item) ?? 0) >= c.quantity);
    if (a.log) return (have(a.log) ?? 0) >= 1 ? 0 : null;
    if (a.alternativeCosts?.length) {
      const i = a.alternativeCosts.findIndex((o) => owns(a.itemCosts) && owns(o.itemCosts));
      return i >= 0 ? i : null;
    }
    return owns(a.itemCosts) ? 0 : null;
  };
  const needsInputs = (a) => !!a.log || (Array.isArray(a.itemCosts) && a.itemCosts.length > 0) || (a.alternativeCosts?.length ?? 0) > 0;
  // best first. With ignoreMaterials, crafting skills are ranked even if the bank can't pay for them.
  const xpCandidates = (skill, ignoreMaterials = false) => {
    const out = [];
    for (const a of list(skill.actions)) {
      if (a.realm && a.realm.id !== MELVOR_REALM) continue;
      if ((a.level ?? 1) > skill.level || !(a.baseExperience > 0)) continue;
      let altIndex = 0;
      if (needsInputs(a)) {
        const opt = affordableOption(a);
        if (opt === null && !ignoreMaterials) continue;
        altIndex = opt ?? 0;
      }
      out.push({ a, altIndex, rate: xpRate(skill, a) });
    }
    return out.sort((x, y) => y.rate - x.rate);
  };
  const fmtTime = (h) => {
    if (!isFinite(h)) return "?";
    const m = Math.round(h * 60);
    return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const xpSection = (skill, target) => {
    const now = skill.xp ?? 0;
    const left = Math.max(0, target - now);
    let html = `<div class="mbd-step"><div class="mbd-title">${icon(skill)}<b>${esc(nm(skill))}</b></div><div class="mbd-chips">` +
      chip(`${num(Math.floor(now))} / ${num(target)} XP`) +
      (left > 0 ? chip(`${num(Math.ceil(left))} to go`) : chip('<i class="fa fa-check"></i> Done', "ok")) + `</div></div>`;
    if (left <= 0) return html;
    const ready = xpCandidates(skill);
    const all = ready.length ? ready : xpCandidates(skill, true);
    if (!all.length) return html + `<div class="mbd-place">Nothing found that you can train at your level.</div>`;
    const best = all[0];
    html += `<div class="mbd-step"><div class="mbd-stepno">Fastest method right now</div>` +
      `<div class="mbd-title">${icon(best.a.product ?? best.a.log)}<b>${esc(nm(best.a))}</b></div>` +
      `<div class="mbd-chips">${chip(`Level ${best.a.level ?? 1}`)}${chip(`${num(Math.round(best.rate))} XP/hour`)}${chip(`About ${fmtTime(left / best.rate)}`, "ok", "Base XP only, ignoring mastery and other bonuses")}</div>` +
      (!ready.length ? `<div class="mbd-chips">${chip("You don't have the materials for this in your bank yet", "warn")}</div>` : "") + `</div>`;
    if (all.length > 1) {
      html += `<div class="mbd-sec">Next best</div><div class="mbd-chips">` + all.slice(1, 4).map((c) => chip(`${esc(nm(c.a))} &middot; ${num(Math.round(c.rate))}/h`)).join("") + `</div>`;
    }
    html += `<div class="mbd-note">Queued, it keeps picking the best method as you level up, until you reach ${num(target)} XP.</div>`;
    return html;
  };
  const startBest = (e) => {
    const skill = skillById(e.skillId);
    if (!skill) return { ok: false, reason: "this skill wasn't found in your game version" };
    if ((skill.xp ?? 0) >= e.targetXp) return { ok: true };
    const cands = xpCandidates(skill);
    if (!cands.length) {
      const hint = xpCandidates(skill, true)[0];
      return { ok: false, reason: hint ? `no materials for ${nm(hint.a)} or anything else you can train. Get some, then press Start` : `nothing to train at ${nm(skill)} level ${skill.level}` };
    }
    let lastReason = "the game wouldn't start it";
    for (const c of cands.slice(0, 15)) {
      const r = startAction({ skillId: e.skillId, actionId: c.a.id, altIndex: c.altIndex, kind: "xp" });
      if (r.ok) { e.t0 = Date.now(); e.g0 = Math.floor(skill.xp ?? 0); e.lvl = skill.level; e.method = `${nm(c.a)} (~${Math.round(c.rate).toLocaleString()} XP/h)`; return r; }
      if (r.transient) lastReason = r.reason;
      else if (!/needs .* level/.test(r.reason)) lastReason = r.reason;
    }
    return { ok: false, reason: lastReason };
  };
  const startEntry = (e) => (e.kind === "xp" ? startBest(e) : startAction(e));

  // ---------- time estimates (base speeds; the active entry switches to its measured speed after a few seconds) ----------
  const intervalMs = (skill, a) =>
    a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
  const msPerUnit = (e) => {
    const skill = skillById(e.skillId);
    if (!skill) return null;
    if (e.kind === "xp") { const best = xpCandidates(skill, true)[0]; return best && best.rate > 0 ? 3600000 / best.rate : null; }
    const a = actionById(skill, e.actionId);
    if (!a) return null;
    const ms = intervalMs(skill, a);
    if (e.kind === "gather") return ms / Math.max(1, a.baseQuantity ?? 1);
    const opt = options(a)[e.altIndex ?? 0];
    return ms / Math.max(1, (a.baseQuantity ?? 1) * (opt?.mult ?? 1));
  };
  const remainingUnits = (e) => (e.kind === "xp" ? Math.max(0, e.targetXp - (skillById(e.skillId)?.xp ?? 0)) : Math.max(0, e.qty - Runner.gained(e)));
  const estimateMs = (e) => {
    if (e.kind === "manual" || e.status === "done") return 0;
    const units = remainingUnits(e);
    if (units <= 0) return 0;
    let per = msPerUnit(e);
    if (Runner.state === "running" && Runner.activeId === e.id && e.t0 !== undefined) {
      const dt = Date.now() - e.t0, dg = Runner.gained(e) - e.g0;
      if (dt > 10000 && dg > 0) per = dt / dg;
    }
    return per === null ? null : units * per;
  };
  const fmtDur = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 1) return "under 1 min";
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const fmtClock = (ms) => {
    const d = new Date(Date.now() + ms);
    const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
  };

  // ---------- runner: takes entries from the top of the list, one at a time ----------
  const Runner = {
    state: "idle", // idle | running | paused
    message: "",
    activeId: null,
    activeSkillId: null,
    setState(s, msg = "") { this.state = s; this.message = msg; Panel.render(); },
    elapsed: 0, // running time since the queue was started (for the progress bar)
    lastTick: null,
    eta() {
      let ms = 0, unknown = 0, manual = 0;
      for (const e of Queue.items) {
        if (e.status === "done") continue;
        if (e.kind === "manual") { manual++; continue; }
        const t = estimateMs(e);
        if (t === null) unknown++; else ms += t;
      }
      return { ms, unknown, manual };
    },
    focusId: null, // "Do this first": run this entry now without moving it in the list
    current() {
      const f = this.focusId && Queue.items.find((e) => e.id === this.focusId && e.status !== "done");
      if (!f) this.focusId = null;
      return f || Queue.items.find((e) => e.status !== "done");
    },
    doFirst(id) {
      const e = Queue.items.find((x) => x.id === id);
      if (!e || e.status === "done") return;
      this.focusId = id;
      if (e.status === "blocked" || e.status === "waiting") e.status = "pending";
      if (this.state === "running") { this.step(); Panel.render(); } else this.start();
    },
    gained(e) {
      if (e.kind === "xp") return Math.floor(skillById(e.skillId)?.xp ?? 0);
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
      if (this.state === "idle") this.elapsed = 0;
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
      this.focusId = null;
      this.elapsed = 0;
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
      if (this.state !== "running") { this.lastTick = null; return; }
      const nowT = Date.now();
      if (this.lastTick) this.elapsed += Math.min(nowT - this.lastTick, 5000);
      this.lastTick = nowT;
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
          if (cur.kind !== "manual" && cur.kind !== "xp" && cur.startQty === undefined) cur.startQty = have(itemById(cur.itemId)) ?? 0;
          Queue.save();
          if (cur.kind !== "manual") {
            const r = startEntry(cur);
            if (!r.ok) {
              if (r.transient) { this.message = r.reason; Panel.render(); return; }
              this.block(cur, r.reason);
              return;
            }
          }
          cur.t0 = Date.now();
          cur.g0 = this.gained(cur);
        }

        if (cur.kind === "xp") {
          const sk = skillById(cur.skillId);
          if ((sk?.xp ?? 0) >= cur.targetXp) { this.finish(cur); continue; }
          // the best method changes as levels go up or materials run out: switch when the current one stops
          if (sk && sk.isActive && game.activeAction === sk) {
            // levelled up since we picked the method: look again, a faster one may be open now
            if (sk.level > (cur.lvl ?? sk.level)) { const rl = startEntry(cur); if (!rl.ok && !rl.transient) { this.block(cur, rl.reason); return; } }
            Panel.render();
            return;
          }
          if (game.activeAction && game.activeAction !== sk) { this.pause("Paused: something else started running."); return; }
          const rx = startEntry(cur);
          if (rx.ok) { Panel.render(); return; }
          if (rx.transient) { this.message = rx.reason; Panel.render(); return; }
          this.block(cur, `${rx.reason} (${this.gained(cur).toLocaleString()} of ${Number(cur.targetXp).toLocaleString()} XP)`);
          return;
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
  const POS_KEY = "mbd-th-panel-pos";
  const Panel = {
    el: null,
    last: "",
    place(x, y) {
      const el = this.el;
      const w = el.offsetWidth || 350;
      x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w));
      y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 48));
      Object.assign(el.style, { left: x + "px", top: y + "px", right: "auto", bottom: "auto", maxHeight: `min(70vh, ${Math.max(160, window.innerHeight - y - 8)}px)` });
      return { x, y };
    },
    restorePos() {
      try {
        const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) this.place(p.x, p.y);
      } catch (e) { /* default position */ }
    },
    ensure() {
      if (this.el) return this.el;
      document.getElementById("mbd-queue-panel")?.remove();
      const el = document.createElement("div");
      el.id = "mbd-queue-panel";
      el.style.cssText =
        "position:fixed;right:68px;bottom:16px;width:350px;max-height:70vh;display:none;flex-direction:column;z-index:1050;" +
        "background:rgba(28,32,41,.98);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:10px;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.5);font-size:13px";
      let drag = null;
      el.addEventListener("pointerdown", (ev) => {
        if (!ev.target.closest("[data-drag]") || ev.target.closest("[data-act]")) return;
        const r = el.getBoundingClientRect();
        drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
        try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        ev.preventDefault();
      });
      el.addEventListener("pointermove", (ev) => { if (drag) this.place(ev.clientX - drag.dx, ev.clientY - drag.dy); });
      const endDrag = () => {
        if (!drag) return;
        drag = null;
        const r = el.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (e) { /* ignore */ }
      };
      el.addEventListener("pointerup", endDrag);
      el.addEventListener("pointercancel", endDrag);
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
        else if (act === "first") Runner.doFirst(id);
        else if (act === "autostart") { Settings.setAutoStart(!Settings.autoStart()); this.last = ""; this.render(); }
      });
      window.addEventListener("resize", () => {
        if (this.el && this.el.style.left) { const r = this.el.getBoundingClientRect(); this.place(r.left, r.top); }
      });
      document.body.appendChild(el);
      this.el = el;
      this.restorePos();
      return el;
    },
    row(e) {
      const isXp = e.kind === "xp";
      const item = isXp ? skillById(e.skillId) : itemById(e.itemId);
      const manual = e.kind === "manual";
      const done = e.status === "done";
      const warn = e.status === "blocked" || e.status === "waiting";
      const lead = done ? '<i class="fa fa-check text-success mr-2"></i>'
        : e.status === "active" ? '<i class="fa fa-play text-success mr-2"></i>'
        : warn ? '<i class="fa fa-exclamation-triangle text-warning mr-2"></i>'
        : '<i class="fa fa-circle mr-2" style="opacity:.25;font-size:8px;vertical-align:middle"></i>';
      const showProgress = !manual && !done && (isXp || (e.startQty !== undefined && (e.status === "active" || e.status === "blocked" || Runner.gained(e) > 0)));
      const amount = isXp ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.targetXp).toLocaleString()} XP</b>` : showProgress ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.qty).toLocaleString()}</b>` : `<b>x${Number(e.qty).toLocaleString()}</b>`;
      const btn = (act, ic, title) =>
        `<a data-act="${act}" data-id="${esc(e.id)}" class="pointer-enabled text-white-50 ml-2" title="${title}"><i class="fa ${ic}"></i></a>`;
      const sub = e.reason ? `<br><small class="text-warning">${esc(e.reason)}</small>`
        : isXp && e.status === "active" && e.method ? `<br><small class="text-muted">using ${esc(e.method)}</small>`
        : manual && !done ? `<br><small class="text-muted">do this yourself${e.status === "waiting" ? " (waiting for you)" : ""}</small>` : "";
      return (
        `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07);${done ? "opacity:.5" : ""}" ${manual ? `title="${esc(e.note ?? "")}"` : ""}>` +
        `<div style="flex:1;min-width:0">${lead}${icon(item)}<span class="${manual ? "text-muted font-italic" : ""}" style="${done ? "text-decoration:line-through" : ""}">${esc(e.label)}</span> ${amount}${Runner.focusId === e.id ? ' <span class="badge badge-success">first</span>' : ""}${sub}</div>` +
        (done ? btn("remove", "fa-times", "Remove") :
          `<a data-act="first" data-id="${esc(e.id)}" class="pointer-enabled text-success ml-2" title="Do this first (keeps its place in the list)"><i class="fa fa-play-circle"></i></a>` +
          btn("top", "fa-angle-double-up", "Move to top") + btn("up", "fa-arrow-up", "Move up") + btn("down", "fa-arrow-down", "Move down") + btn("remove", "fa-times", "Remove")) +
        `</div>`
      );
    },
    render() {
      if (!this.el) return;
      const q = Queue.items;
      const pending = q.filter((e) => e.status !== "done").length;
      const running = Runner.state === "running";
      const eta = Runner.eta();
      const total = Runner.elapsed + eta.ms;
      const pct = pending === 0 ? (q.length ? 100 : 0) : total > 0 ? Math.min(99, Math.round((Runner.elapsed / total) * 100)) : 0;
      const cur = Runner.current();
      const statusText = running ? `Running: ${cur ? cur.label : ""}` : Runner.state === "paused" ? (Runner.message || "Paused") : (Runner.message || (pending ? "Ready" : "Idle"));
      const statusCls = Runner.state === "paused" ? "text-warning" : running ? "text-success" : "text-muted";
      const etaText = pending === 0 ? (q.length ? "All done" : "Queue is empty")
        : `${fmtDur(eta.ms)} left &middot; done around ${fmtClock(eta.ms)}` +
          (eta.manual ? ` <span class="text-muted">(+ ${eta.manual} manual step${eta.manual === 1 ? "" : "s"})</span>` : "") +
          (eta.unknown ? ` <span class="text-muted">(some steps can't be estimated)</span>` : "");
      const b = (act, label, ic, cls, disabled) =>
        `<button class="btn btn-sm ${cls}" data-act="${act}" ${disabled ? "disabled" : ""} style="padding:2px 10px"><i class="fa ${ic} mr-1"></i>${label}</button>`;
      const html =
        `<div data-drag style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);cursor:move;user-select:none;touch-action:none" title="Drag to move">` +
        `<i class="fa fa-grip-vertical mr-2" style="opacity:.4"></i><b style="flex:1">Action Queue</b><span class="text-muted mr-2">${pending} action${pending === 1 ? "" : "s"} left</span>` +
        `<a data-act="close" class="pointer-enabled text-white" title="Close"><i class="fa fa-times"></i></a></div>` +
        `<div data-list style="overflow:auto;padding:4px 10px;flex:1">` +
        (q.length ? q.map((e) => this.row(e)).join("") : `<div class="text-muted py-3 text-center">Nothing queued yet.<br>Open a Township task's play button and choose "Add to queue" or "Add to top".</div>`) +
        `</div>` +
        `<div style="padding:10px;border-top:1px solid rgba(255,255,255,.12);text-align:center">` +
        `<div style="position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden">` +
        `<div style="height:100%;width:${pct}%;background:#30c78d;transition:width .8s"></div>` +
        `<span style="position:absolute;left:0;right:0;top:0;line-height:16px;font-size:11px;font-weight:600;text-shadow:0 0 3px rgba(0,0,0,.7)">${pct}%</span></div>` +
        `<div style="margin-top:6px"><small class="${statusCls}">${esc(statusText)}</small></div>` +
        `<div style="margin-bottom:8px"><small>${etaText}</small></div>` +
        `<div style="display:flex;justify-content:center;gap:6px">` +
        b("start", Runner.state === "paused" ? "Resume" : "Start", "fa-play", "btn-success", running || pending === 0) +
        b("pause", "Pause", "fa-pause", "btn-warning", !running) +
        b("stop", "Stop", "fa-stop", "btn-danger", Runner.state === "idle") +
        `</div>` +
        `<div style="display:flex;justify-content:center;gap:6px;margin-top:6px">` +
        b("cleardone", "Clear Queue", "fa-check", "btn-secondary", !q.some((e) => e.status === "done")) +
        b("clear", "Clear All", "fa-trash", "btn-outline-danger", q.length === 0) +
        `</div>` +
        `<div style="display:flex;justify-content:center;margin-top:6px">` +
        (Settings.autoStart()
          ? b("autostart", "Auto-start: On", "fa-toggle-on", "btn-success", false)
          : b("autostart", "Auto-start: Off", "fa-toggle-off", "btn-outline-secondary", false)) +
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
      b.title = "Action Queue";
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
    if (type === "TownshipSkillXPGoal" && goal.skill) {
      return {
        title: `${esc(nm(goal.skill))}: reach ${goal.quantity.toLocaleString()} XP`,
        body: () => xpSection(goal.skill, goal.quantity),
        queue: () => {
          if ((goal.skill.xp ?? 0) >= goal.quantity) return [];
          return [{ kind: "xp", skillId: goal.skill.id, targetXp: goal.quantity, qty: goal.quantity, label: `${nm(goal.skill)}: reach ${goal.quantity.toLocaleString()} XP` }];
        },
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
        const onQueue = info.queue ? (top) => {
          Queue.add(info.queue(), top);
          Panel.open();
          if (Settings.autoStart() && Runner.state !== "running") Runner.start();
        } : null;
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

  const injectStyle = () => {
    document.getElementById("mbd-th-style")?.remove();
    const st = document.createElement("style");
    st.id = "mbd-th-style";
    st.textContent = `
      .mbd-th-pop{text-align:center}
      .mbd-step{background:rgba(127,127,127,.12);border:1px solid rgba(127,127,127,.3);border-radius:8px;padding:8px 10px;margin:0 0 8px}
      .mbd-stepno{font-size:12px;font-weight:600;opacity:.7;margin-bottom:2px}
      .mbd-title{font-size:15px;margin:2px 0 6px}
      .mbd-chips{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:5px;margin-top:4px}
      .mbd-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 9px;border-radius:11px;background:rgba(127,127,127,.22);font-size:12px;line-height:20px}
      .mbd-chip img,.mbd-title img.skill-icon-xs{width:18px;height:18px;margin:0 3px 0 0;vertical-align:middle}
      .mbd-chip.ok{background:rgba(48,199,141,.25);color:#2fb67a}
      .mbd-chip.warn{background:rgba(229,174,103,.25);color:#c98a2b}
      .mbd-chip.lbl{background:transparent;padding-left:0;opacity:.85}
      .mbd-sec{font-weight:600;margin:12px 0 4px;font-size:14px;opacity:.85}
      .mbd-row{margin:8px 0}
      .mbd-rowlbl{font-size:12px;font-weight:600;opacity:.7}
      .mbd-chip small{opacity:.8}
      .mbd-sets .btn{margin:0 2px}
      .mbd-place{margin:3px 0;font-size:13px}
      .mbd-place img{width:18px;height:18px;margin-right:4px;vertical-align:middle}
      .mbd-note{margin-top:8px;font-size:12px;opacity:.7}
    `;
    document.head.appendChild(st);
  };

  const install = () => {
    injectStyle();
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
        fire(`${qty} x ${esc(nm(it))}`, itemSection(it, qty), (top) => {
          Queue.add(toEntries(buildRows(it, qty)), top);
          Panel.open();
          if (Settings.autoStart() && Runner.state !== "running") Runner.start();
        });
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
