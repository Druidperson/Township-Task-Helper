// Township Task Helper: task breakdowns + action queue for Melvor Idle
export function setup(ctx) {
(() => {
  "use strict";

  const VERSION = "0.16.0";
  const LOG = (...a) => console.log("[Township Task Helper]", ...a);
  const list = (r) => r?.allObjects ?? (r?.registeredObjects ? [...r.registeredObjects.values()] : []);
  const nm = (o) => {
    const n = String(o?.name ?? o?._name ?? o?._localID ?? o?.id ?? "?");
    // some areas (Into the Mist, Lair of the Spider Queen) have a placeholder "random" monster with no name in the game files
    if (/^UNDEFINED TRANSLATION/i.test(n)) { try { const a = ["combatAreas", "slayerAreas", "dungeons", "strongholds", "abyssDepths"].flatMap((k) => list(game[k])).find((x) => (x.monsters ?? []).includes(o)); return a ? `Random monster in ${String(a.name)}` : "Random monster"; } catch (e) { return "Random monster"; } }
    return n;
  };
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
  const KEYS = { autoStart: ["mbd-th-autostart", false], autoSell: ["mbd-th-autosell", true] };
  const Settings = {
    api: null,
    get(name) {
      try { if (this.api) { const v = this.api.get(name); if (v !== undefined && v !== null) return !!v; } } catch (e) { /* use fallback */ }
      try { const raw = localStorage.getItem(KEYS[name][0]); if (raw !== null) return raw === "1"; } catch (e) { /* ignore */ }
      return KEYS[name][1];
    },
    set(name, v) {
      try { if (this.api) this.api.set(name, !!v); } catch (e) { console.warn("[Township Task Helper] settings", e); }
      try { localStorage.setItem(KEYS[name][0], v ? "1" : "0"); } catch (e) { /* ignore */ }
    },
    autoStart() { return this.get("autoStart"); },
    setAutoStart(v) { this.set("autoStart", v); },
    autoSell() { return this.get("autoSell"); },
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
      section.add({
        type: "switch",
        name: "autoSell",
        label: "Automatically sell extras the queue makes",
        hint: "When a step makes more than the task needs (like arrowtips crafted in batches), the extra is sold. It never sells anything you already owned.",
        default: true,
      });
      Settings.api = section;
    } catch (e) { console.warn("[Township Task Helper] could not register settings", e); }
  }
  const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
  const skillById = (id) => list(game.skills).find((s) => s.id === id);
  const actionById = (skill, id) => list(skill?.actions).find((a) => a.id === id);

  // drops that live in a skill's own mechanics instead of a random product list:
  // gems while mining, general rare items while thieving, special finds while fishing.
  // each one gives a function that returns the chance (in %) per action.
  const specialDrops = (skill, a) => {
    const out = [];
    try {
      if (a.realm && a.realm.id !== MELVOR_REALM) return out;
      const mods = () => game.modifiers ?? {};
      if (skill.id === "melvorD:Mining" && a.giveGems && game.randomGemTable?.drops) {
        const tw = game.randomGemTable.totalWeight || game.randomGemTable.drops.reduce((t, d) => t + d.weight, 0);
        for (const d of game.randomGemTable.drops) if (d?.item) out.push({ id: d.item.id, pct: () => (1 + Number(mods().miningGemChance ?? 0)) * (1 + Number(mods().offItemChance ?? 0) / 100) * (d.weight / tw) });
      } else if (skill.id === "melvorD:Thieving") {
        for (const r of skill.generalRareItems ?? []) {
          if (!r?.item || (r.npcs && !(r.npcs.has ? r.npcs.has(a) : false))) continue;
          try { if (skill.isCorrectRealmForGeneralRareDrop && !skill.isCorrectRealmForGeneralRareDrop(r, a.realm)) continue; } catch (e) { /* ignore */ }
          out.push({ id: r.item.id, pct: () => { let ok = 1; try { const v = Number(skill.getNPCSuccessRate?.(a)); if (v > 0) ok = v > 1 ? v / 100 : v; } catch (e) { /* ignore */ } return Number(r.chance) * ok; } });
        }
      } else if (skill.id === "melvorD:Fishing" && a.area && skill.specialItemTables?.get) {
        const tbl = skill.specialItemTables.get(a.realm ?? game.realms?.getObjectByID?.(MELVOR_REALM)) ?? skill.specialItemTables.get(game.realms?.getObjectByID?.(MELVOR_REALM));
        if (tbl?.drops && a.area.specialChance > 0) {
          const tw = tbl.totalWeight || tbl.drops.reduce((t, d) => t + d.weight, 0);
          const base = () => (Number(a.area.specialChance) + Number(mods().bonusFishingSpecialChance ?? 0)) / 100;
          for (const d of tbl.drops) {
            if (!d?.item) continue;
            out.push({ id: d.item.id, pct: () => base() * 100 * (d.weight / tw) });
            const inner = d.item.dropTable?.drops;
            if (inner) { const itw = d.item.dropTable.totalWeight || inner.reduce((t, x) => t + x.weight, 0); for (const x of inner) if (x?.item) out.push({ id: x.item.id, pct: () => base() * 100 * (d.weight / tw) * (x.weight / itw) }); }
          }
        }
      }
    } catch (e) { /* ignore */ }
    return out;
  };
  // Blessed Offering turns runes into Holy Dust, so it gets recipe-style fields and looks like a
  // recipe to the rest of the helper.
  const MAGIC_ID = "melvorD:Magic";
  // Herblore recipes list their potions by tier instead of one product, so give them one (the tier your mastery makes)
  const decorateHerblore = (skill) => {
    for (const a of list(skill.actions)) {
      try {
        if (a.product !== undefined || !a.potions?.length || Object.prototype.hasOwnProperty.call(a, "product")) continue;
        Object.defineProperties(a, {
          product: { get: () => a.potions[Math.min(a.potions.length - 1, Math.max(0, skill.getPotionTier?.(a) ?? 0))], configurable: true },
          baseQuantity: { get: () => 1, configurable: true },
        });
      } catch (e) { /* ignore */ }
    }
  };
  const decorateSpells = (skill) => {
    for (const sp of list(skill.actions)) {
      try {
        if (sp.produces?.id !== "melvorF:Holy_Dust" || !(sp.runesRequired?.length) || sp.specialCost?.type !== -5 || Object.prototype.hasOwnProperty.call(sp, "itemCosts")) continue;
        Object.defineProperties(sp, {
          itemCosts: { get: () => sp.runesRequired.map((r) => ({ item: r.item, quantity: r.quantity })), configurable: true },
          product: { get: () => sp.produces, configurable: true },
          baseQuantity: { get: () => sp.productionRatio ?? 1, configurable: true },
          baseInterval: { get: () => skill.baseInterval ?? 2000, configurable: true },
        });
      } catch (e) { /* ignore */ }
    }
  };
  // ---------- recipe index (built on first use) ----------
  let idx = null;
  const buildIndex = () => {
    if (idx) return idx;
    idx = { crafters: new Map(), gatherers: new Map(), randoms: new Map(), droppers: new Map(), shop: new Map() };
    for (const skill of list(game.skills)) {
      if (skill.id === MAGIC_ID) decorateSpells(skill);
      if (skill.id === "melvorD:Herblore") decorateHerblore(skill);
      for (const a of list(skill.actions)) {
        const isCraft = Array.isArray(a.itemCosts) && (a.itemCosts.length > 0 || (a.alternativeCosts?.length ?? 0) > 0);
        if (a.product) push(isCraft ? idx.crafters : idx.gatherers, a.product.id, { skill, a });
        for (const rp of a.randomProducts ?? []) if (rp?.id) push(idx.randoms, rp.id, { skill, a });
        if (skill.id === ASTRO_ID && (!a.realm || a.realm.id === MELVOR_REALM)) for (const ri of a.randomItems ?? []) if (ri?.id) push(idx.randoms, ri.id, { skill, a });
        for (const x of specialDrops(skill, a)) push(idx.randoms, x.id, { skill, a, pct: x.pct });
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
    } catch (e) { console.warn("[Township Task Helper] shop index failed", e); }
    return idx;
  };

  // Cooking burns some food: costs are used every attempt, but the product and the XP only come from the ones that work.
  // Returns the share of attempts that succeed (1 for every skill that never fails).
  const succ = (skill, a) => {
    try {
      if (skill?.id === "melvorD:Cooking" && typeof skill.getRecipeSuccessChance === "function") {
        const c = Number(skill.getRecipeSuccessChance(a));
        if (c > 0 && c < 100) return Math.max(0.05, c / 100);
      }
    } catch (e) { /* ignore */ }
    return 1;
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
    const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult) * succ(c.skill, c.a);
    const crafts = Math.ceil(qty / per);
    n.recipe = { c, opt, crafts };
    path.add(item.id);
    for (const cost of [...baseCosts(c.a), ...opt.costs]) {
      if (cost?.item) explode(cost.item, cost.quantity * crafts, depth + 1, path, nodes);
    }
    path.delete(item.id);
  };

  const num = (n) => Number(n).toLocaleString();
  const chip = (html, cls = "", title = "") => `<span class="mbd-chip ${cls}"${title ? ` title="${esc(title)}"` : ""}><span>${html}</span></span>`;
  const where = (x) => `${esc(nm(x.skill))}: ${esc(nm(x.a))} (Lv ${x.a.level ?? 1})`;
  const shopCost = (p) => {
    const cur = (p.costs?.currencies ?? []).map((c) => `${Number(c.cost ?? c.quantity ?? 0).toLocaleString()} ${esc(nm(c.currency))}`);
    const its = (p.costs?.items ?? []).map((c) => `${Number(c.quantity).toLocaleString()} ${esc(nm(c.item))}`);
    return `${esc(nm(p))} for ${[...cur, ...its].join(" + ") || "free"}`;
  };
  // where an item comes from, as structured parts
  const sourceParts = (id) => {
    buildIndex();
    const parts = [];
    const g = idx.gatherers.get(id);
    if (g) parts.push({ fa: "fa-hand-paper", label: "Gather", items: g.slice(0, 3).map(where) });
    const r = idx.randoms.get(id);
    if (r) parts.push({ fa: "fa-dice", label: "Random drop", items: [...new Map(r.map((x) => [x.skill.id, x.skill])).values()].slice(0, 4).map((sk) => esc(nm(sk))) });
    const d = idx.droppers.get(id);
    if (d) parts.push({ fa: "fa-skull", label: "Monster drop", items: [...d.slice(0, 4).map((m) => esc(nm(m))), ...(d.length > 4 ? [`+${d.length - 4} more`] : [])] });
    const s = idx.shop.get(id);
    if (s) parts.push({ fa: "fa-shopping-cart", label: "Shop", items: s.slice(0, 2).map(shopCost) });
    return parts;
  };
  const wikiUrl = (id) => `https://wiki.melvoridle.com/index.php?search=${encodeURIComponent(nm(itemById(id)))}`;
  const wikiChip = (id) => chip(`<a data-mbd-wiki href="${esc(wikiUrl(id))}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline"><i class="fa fa-book mr-1"></i>Look it up on the Melvor wiki</a>`);
  const sourceText = (id) => {
    const parts = sourceParts(id);
    return parts.length ? parts.map((p) => `${p.label}: ${p.items.join("; ")}`).join(" | ") : `no source found in the game data (chest, event or other). Try the wiki: ${wikiUrl(id)}`;
  };
  const sourceHtml = (id) => {
    const parts = sourceParts(id);
    if (!parts.length) return `<div class="mbd-chips">${chip("No source found in the game data (chest, event or other)", "warn")}</div><div class="mbd-chips">${wikiChip(id)}</div>`;
    return parts.map((p) => `<div class="mbd-chips">${chip(`<i class="fa ${p.fa}"></i> <b>${p.label}</b>`, "lbl")}${p.items.map((i) => chip(i)).join("")}</div>`).join("");
  };

  // ---------- Astrology: Stardust and Golden Stardust are random drops from studying a constellation ----------
  // Each constellation also boosts other skills, so the player picks one on purpose or lets the mod take the best XP per hour.
  const ASTRO_ID = "melvorD:Astrology";
  const Astro = { pick: "best" }; // "best" or a constellation id; reset whenever a popup opens
  const astroSkill = () => skillById(ASTRO_ID);
  const astroCons = (item) => {
    const sk = astroSkill();
    return sk && item ? list(sk.actions).filter((c) => (!c.realm || c.realm.id === MELVOR_REALM) && (c.randomItems ?? []).some((i) => i.id === item.id)) : [];
  };
  const isAstroItem = (item) => astroCons(item).length > 0;
  const astroInterval = (sk, c) => sk.getConstellationInterval?.(c) ?? intervalMs(sk, c);
  const astroXpHr = (sk, c) => ((c.baseExperience ?? 0) / astroInterval(sk, c)) * 3600000;
  // how many of the item one hour of studying finds, on average
  const astroPerHour = (sk, c, item) => {
    const p = Number(sk.getRandomItemChance?.(item) ?? 0) / 100;
    const d = Number(sk.getDoublingChance?.(c) ?? 0) / 100;
    return (3600000 / astroInterval(sk, c)) * p * (1 + (d > 0 && d < 1 ? d : 0));
  };
  const astroOptions = (item) => {
    const sk = astroSkill();
    return astroCons(item).map((c) => ({ c, level: c.level ?? 1, open: (c.level ?? 1) <= sk.level, xpHr: astroXpHr(sk, c), perHr: astroPerHour(sk, c, item) })).sort((a, b) => a.level - b.level);
  };
  const bestCon = (item) => astroOptions(item).filter((o) => o.open).sort((a, b) => b.xpHr - a.xpHr || b.level - a.level)[0] ?? null;
  const conChoice = (item) => (Astro.pick === "best" ? bestCon(item) : astroOptions(item).find((o) => o.c.id === Astro.pick && o.open) ?? bestCon(item));
  const astroBoosts = (c) => (c.skills ?? []).map((s) => nm(s));
  const astroHtml = (item, qty) => {
    const sk = astroSkill(), opts = astroOptions(item), best = bestCon(item), cur = conChoice(item);
    if (!opts.length || !best || !cur) return sourceHtml(item.id);
    const label = (o) => `${nm(o.c)} · ${astroBoosts(o.c).slice(0, 3).join(", ")}${astroBoosts(o.c).length > 3 ? "..." : ""} · ${num(Math.round(o.xpHr))} XP/h`;
    const sel = `<select data-mbd-astro class="custom-select custom-select-sm" style="max-width:100%;width:auto">` +
      `<option value="best"${Astro.pick === "best" ? " selected" : ""}>Best XP/hour: ${esc(nm(best.c))} (${num(Math.round(best.xpHr))} XP/h)</option>` +
      opts.map((o) => `<option value="${esc(o.c.id)}"${Astro.pick === o.c.id ? " selected" : ""}${o.open ? "" : " disabled"}>${esc(label(o))}${o.open ? "" : ` (needs level ${o.level})`}</option>`).join("") + `</select>`;
    const hrs = qty / Math.max(1e-9, cur.perHr);
    const mastery = (() => { try { return sk.getMasteryLevel(cur.c); } catch (e) { return null; } })();
    return `<div class="mbd-chips">${chip(`<i class="fa fa-star"></i> <b>Astrology</b>`, "lbl")}${chip("Random drop while studying a constellation")}</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">Which constellation?</div><div class="mbd-chips">${sel}</div></div>` +
      `<div class="mbd-chips">${chip(`${esc(nm(cur.c))}`)}${chip(`${num(Math.round(cur.xpHr))} XP/hour`)}${mastery !== null ? chip(`Mastery ${mastery}`) : ""}` +
      `${chip(`About ${fmtDur(hrs * 3600000)}`, "ok", "Average, at base speed")}</div>` +
      `<div class="mbd-chips">${chip(`Boosts ${esc(astroBoosts(cur.c).join(", "))}`)}</div>` +
      `<div class="mbd-note">Studying also levels the constellation's mastery. Pick one to train it on purpose, or take the best XP/hour and the queue switches to a better one when you level up.</div>`;
  };

  // ---------- Farming an item that only drops ----------
  // Bird Nest and friends are random drops. Order of preference: a skill that drops it while you train (best XP/hour),
  // then a fight that is safe for you, then a risky fight only if the player says so. A Slayer task on a monster that drops
  // the item is shown as an option because those kills count twice.
  const Farm = { pick: {}, risk: {} };
  const farmPick = (item) => Farm.pick[item.id] ?? "best";
  const isFarmItem = (item) => {
    if (!item) return false;
    buildIndex();
    if (idx.gatherers.get(item.id) || idx.crafters.get(item.id) || isAstroItem(item)) return false;
    return !!(idx.randoms.get(item.id) || idx.droppers.get(item.id));
  };
  const farmSkills = (item) => {
    buildIndex();
    const out = [];
    for (const x of idx.randoms.get(item.id) ?? []) {
      if (x.skill.id === ASTRO_ID || (x.a.realm && x.a.realm.id !== MELVOR_REALM)) continue;
      let chance = 0;
      if (x.pct) { try { chance = Number(x.pct()); } catch (e) { /* ignore */ } }
      if (!(chance > 0)) try { chance = Number(x.skill.getRandomProductInfo?.(item)?.chance ?? 0); } catch (e) { /* ignore */ }
      if (!(chance > 0)) { try { chance = Number(x.skill.randomProducts?.get?.(item)?.chance ?? 0); } catch (e) { /* ignore */ } }
      if (!(chance > 0)) continue;
      const ms = intervalMs(x.skill, x.a);
      out.push({ type: "skill", skill: x.skill, a: x.a, id: "s:" + x.a.id, open: (x.a.level ?? 1) <= x.skill.level, level: x.a.level ?? 1,
        xpHr: ((x.a.baseExperience ?? 0) / ms) * 3600000, perHr: (3600000 / ms) * (chance / 100) });
    }
    return out.sort((a, b) => a.level - b.level);
  };
  const bestFarmSkill = (item) => farmSkills(item).filter((o) => o.open).sort((a, b) => b.xpHr - a.xpHr || b.perHr - a.perHr)[0] ?? null;
  const nmult = () => (typeof numberMultiplier === "number" ? numberMultiplier : 10);
  const stdMax = (lvl, b) => { const e = lvl + 9; return Math.floor(nmult() * (1.3 + e / 10 + b / 80 + (e * b) / 640)); };
  // the hardest a monster's normal attack can hit (special attacks can hit harder)
  const monsterMaxHit = (m) => {
    try {
      const lv = m.levels ?? {};
      if (m.attackType === "melee") return stdMax(lv.Strength ?? 1, statVal(m, "meleeStrengthBonus"));
      if (m.attackType === "ranged") return stdMax(lv.Ranged ?? 1, statVal(m, "rangedStrengthBonus"));
      const sp = m.selectedSpell;
      if (!sp) return null;
      if (sp.spellbook && sp.spellbook.allowDamageModifiers === false) return Math.round(nmult() * sp.maxHit);
      return Math.floor(nmult() * sp.maxHit * (1 + statVal(m, "magicDamageBonus") / 100) * (1 + ((lv.Magic ?? 1) + 1) / 200));
    } catch (e) { return null; }
  };
  // what you have to survive with: HP, equipped food and the auto eat settings (a queue runs while you're away, so only auto eat counts)
  const playerGuard = () => {
    const pl = game.combat?.player;
    const hs = skillById("melvorD:Hitpoints");
    const hp = pl?.stats?.maxHitpoints ?? nmult() * (hs?.level ?? 10);
    const slot = pl?.food?.slots?.[pl.food.selectedSlot];
    let heal = 0;
    try { if (slot?.item) heal = pl.getFoodHealing(slot.item); } catch (e) { /* ignore */ }
    let threshold = 0, eff = 0, swap = false;
    try { threshold = Number(pl.autoEatThreshold) || 0; eff = threshold > 0 ? Math.max(1, Number(pl.autoEatEfficiency) || 0) : 0; } catch (e) { /* ignore */ }
    try { swap = pl.modifiers?.autoSwapFoodUnlocked > 0 && !!game.settings?.enableAutoSwapFood; } catch (e) { /* ignore */ }
    const eat = (s) => Math.floor((pl.getFoodHealing(s.item) * eff) / 100);
    let pool = 0;
    try {
      const slots = swap ? pl.food.slots : slot ? [slot] : [];
      for (const s of slots) if (s.item && s.quantity > 0) pool += s.quantity * eat(s);
    } catch (e) { /* ignore */ }
    return { hp, heal, food: slot?.item && slot.quantity > 0 ? nm(slot.item) : null, foodQty: slot?.quantity ?? 0, auto: threshold > 0, threshold, eff, effHeal: eff ? Math.floor((heal * eff) / 100) : 0, pool, swap };
  };
  // rough damage you take killing this monster once (it respawns after a few seconds)
  const RESPAWN_MS = 3000; // the pause before the next monster appears
  // how long you take to kill it once (you land about 75% of your hits)
  const killTimeMs = (m) => {
    try {
      const st = game.combat.player.stats;
      const mine = ((st.minHit + st.maxHit) / 2) * 0.75;
      const mhp = (m.levels?.Hitpoints ?? 1) * nmult();
      return Math.ceil(mhp / Math.max(1, mine)) * (st.attackInterval || 4000);
    } catch (e) { return null; }
  };
  const damagePerKill = (m, avg) => {
    const killMs = killTimeMs(m);
    return killMs === null ? null : avg * (killMs / (statVal(m, "attackSpeed") || 3000)) * 0.75;
  };
  // safe = auto eat is on and starts early enough to survive its biggest hit, and your food covers the whole farm
  const fightSafety = (m, kills = 1) => {
    const max = monsterMaxHit(m), g = playerGuard();
    if (max === null) return { safe: false, max, avg: null, g, why: "can't tell how hard it hits" };
    const avg = (1 + max) / 2;
    if (max * 2 >= g.hp) return { safe: false, max, avg, g, why: `can hit for ${num(max)} against your ${num(g.hp)} HP` };
    if (!g.food) return { safe: false, max, avg, g, why: "you have no food equipped" };
    const dpk = damagePerKill(m, avg);
    const total = dpk === null ? null : dpk * kills;
    if (!g.auto) {
      if (total !== null && total < g.hp * 0.5) return { safe: true, max, avg, g, why: `it can't do much damage over this farm (about ${num(Math.round(total))} of your ${num(g.hp)} HP)` };
      return { safe: false, max, avg, g, why: "auto eat is off, so nothing eats your food while the queue runs" };
    }
    if (g.threshold < max) return { safe: false, max, avg, g, why: `auto eat starts at ${num(Math.round(g.threshold))} HP but it can hit for ${num(max)}` };
    const need = total === null ? null : Math.ceil(total / Math.max(1, g.effHeal));
    const have = Math.floor(g.pool / Math.max(1, g.effHeal));
    if (total !== null && total > g.pool) return { safe: false, max, avg, g, need, have, why: `this farm needs about ${num(need)} food and auto eat can use ${num(have)}${g.swap ? "" : " from the food slot in use"}` };
    return { safe: true, max, avg, g, need, have, why: `auto eat starts at ${num(Math.round(g.threshold))} HP, it hits for ${num(max)} at most, and your food lasts` };
  };
  const dropPerKill = (m, item) => {
    let p = 0;
    if (m.bones?.item?.id === item.id) p += Number(m.bones.quantity ?? 1);
    const lt = m.lootTable, drops = lt?.drops ?? lt?._drops ?? [];
    const tw = Number(lt?.totalWeight) || (Array.isArray(drops) ? drops.reduce((s, d) => s + (d.weight || 0), 0) : 0);
    if (Array.isArray(drops) && tw > 0) for (const d of drops) if (d.item?.id === item.id) p += ((m.lootChance ?? 100) / 100) * (d.weight / tw) * (((d.minQuantity ?? 1) + (d.maxQuantity ?? 1)) / 2);
    return p;
  };
  const slayerTaskNow = () => {
    try { const t = game.combat?.slayerTask; return t?.active && t.monster && t.killsLeft > 0 ? t : null; } catch (e) { return null; }
  };
  const farmFights = (item, qty = 1) => {
    buildIndex();
    const task = slayerTaskNow();
    const out = [];
    for (const m of idx.droppers.get(item.id) ?? []) {
      if (!areaFor(m) || /^UNDEFINED TRANSLATION/i.test(String(m.name))) continue; // placeholder "random monster" slots have no real stats, so they are not offered
      const perKill = dropPerKill(m, item);
      if (!(perKill > 0)) continue;
      let open = true;
      try { open = !areaMissing(m).length; } catch (e) { /* ignore */ }
      const kills = Math.ceil(qty / perKill), safety = fightSafety(m, kills), km = killTimeMs(m);
      const ms = km === null ? Infinity : kills * (km + RESPAWN_MS);
      // efficiency: time to finish, made worse the more of your food it burns; a Slayer task you needed anyway counts for a lot
      const foodShare = safety.need != null && safety.have > 0 ? Math.min(1, safety.need / safety.have) : 1;
      const onTask = !!task && task.monster === m;
      out.push({ type: "fight", m, id: "m:" + m.id, open, perKill, kills, ms, food: safety.need ?? null, safety, onTask, taskLeft: onTask ? task.killsLeft : 0, score: ms * (1 + 0.5 * foodShare) * (onTask ? 0.75 : 1) });
    }
    return out.sort((a, b) => b.open - a.open || b.safety.safe - a.safety.safe || a.score - b.score);
  };
  // what "best" means for this item right now
  const farmPlan = (item, ignorePick = false, qty = 1) => {
    const pick = ignorePick ? "best" : farmPick(item);
    const skills = farmSkills(item), fights = farmFights(item, qty);
    if (pick.startsWith("s:")) { const o = skills.find((x) => x.id === pick && x.open); if (o) return { opt: o, auto: false }; }
    if (pick.startsWith("m:")) { const o = fights.find((x) => x.id === pick && x.open); if (o) return { opt: o, auto: false }; }
    const s = bestFarmSkill(item);
    if (s) return { opt: s, auto: true };
    const okFights = fights.filter((f) => f.open);
    const safe = okFights.filter((f) => f.safety.safe).sort((a, b) => a.score - b.score)[0];
    if (safe) return { opt: safe, auto: true };
    const risky = okFights.sort((a, b) => a.score - b.score)[0];
    return risky ? { opt: risky, auto: true, risky: true } : { opt: null, auto: true };
  };
  const farmHtml = (item, qty) => {
    const skills = farmSkills(item), fights = farmFights(item, qty);
    const plan = farmPlan(item, false, qty), o = plan.opt, auto = farmPlan(item, true, qty).opt;
    if (!skills.length && !fights.length) return sourceHtml(item.id);
    const label = (x) => x.type === "skill"
      ? `${nm(x.skill)}: ${nm(x.a)} · ${num(Math.round(x.xpHr))} XP/h · about ${(x.perHr).toFixed(x.perHr < 10 ? 1 : 0)}/h${x.open ? "" : ` (needs level ${x.level})`}`
      : `Fight ${nm(x.m)} (Combat Lv ${num(x.m.combatLevel ?? 0)}) · ${x.perKill >= 1 ? "drops every kill" : `about 1 in ${num(Math.round(1 / x.perKill))} kills`} · ${isFinite(x.ms) ? "about " + fmtDur(x.ms) : "time unknown"} · ${x.safety.safe ? "safe" : "risky"}${x.onTask ? " · your Slayer task" : ""}${x.open ? "" : " (area locked)"}`;
    const cur = farmPick(item);
    const autoTxt = !auto ? "nothing you can do yet" : auto.type === "skill" ? `${nm(auto.skill)}, ${nm(auto.a)} (best XP/hour)` : `fight ${nm(auto.m)}${auto.safety.safe ? " (most efficient safe fight)" : " (risky)"}`;
    const sel = `<select data-mbd-farm="${esc(item.id)}" class="custom-select custom-select-sm" style="max-width:100%;width:auto">` +
      `<option value="best"${cur === "best" ? " selected" : ""}>Automatic: ${esc(autoTxt)}</option>` +
      (skills.length ? `<optgroup label="Skilling">${skills.map((x) => `<option value="${esc(x.id)}"${cur === x.id ? " selected" : ""}${x.open ? "" : " disabled"}>${esc(label(x))}</option>`).join("")}</optgroup>` : "") +
      (fights.length ? `<optgroup label="Combat, lowest level first">${[...fights].sort((p, q) => (p.m.combatLevel ?? 0) - (q.m.combatLevel ?? 0)).map((x) => `<option value="${esc(x.id)}"${cur === x.id ? " selected" : ""}${x.open ? "" : " disabled"}>${esc(label(x))}</option>`).join("")}</optgroup>` : "") + `</select>`;
    let html = `<div class="mbd-chips">${chip(`<i class="fa fa-dice"></i> <b>Random drop</b>`, "lbl")}${chip("Farm it while you train, or by fighting")}</div>` +
      `<div class="mbd-row"><div class="mbd-rowlbl">How do you want to get it?</div><div class="mbd-chips">${sel}</div></div>`;
    if (o && o.type === "skill") {
      html += `<div class="mbd-chips">${chip(`${icon(o.skill)}${esc(nm(o.skill))}`)}${chip(esc(nm(o.a)))}${chip(`${num(Math.round(o.xpHr))} XP/hour`)}${chip(`About ${fmtDur((qty / o.perHr) * 3600000)}`, "ok", "Average, at base speed")}</div>` +
        `<div class="mbd-note">You train ${esc(nm(o.skill))} while it drops. ${plan.auto ? "The queue moves to a better method when you level up." : ""}</div>`;
    } else if (o) {
      const kills = Math.ceil(qty / o.perKill);
      html += `<div class="mbd-chips">${chip(`${esc(nm(o.m))}`)}${chip(`Combat Lv ${num(o.m.combatLevel ?? 0)}`)}${chip(`About ${num(kills)} kills`, "ok", "Average drop rate")}${isFinite(o.ms) ? chip(`About ${fmtDur(o.ms)}`, "ok", "Kill time plus the pause between monsters, using your damage and an average drop rate") : ""}${o.food != null ? chip(`About ${num(o.food)} food`, "", "Food auto eat is expected to use") : ""}${chip(o.safety.safe ? "Safe for you" : "Risky for you", o.safety.safe ? "ok" : "warn", esc(o.safety.why))}</div>` +
        `<div class="mbd-note">${esc(cap(o.safety.why))}.${o.safety.safe ? "" : " Special attacks can hit harder than this."}</div>`;
      if (o.onTask) html += `<div class="mbd-chips">${chip(`<i class="fa fa-skull"></i> Your Slayer task: ${num(o.taskLeft)} left`, "ok", "These kills count toward it")}</div>`;
      if (!o.safety.safe) html += `<label class="mbd-note" style="display:block"><input type="checkbox" data-mbd-risk="${esc(item.id)}"${Farm.risk[item.id] ? " checked" : ""}> I understand the risk, queue this fight anyway</label>`;
    } else html += `<div class="mbd-note">Nothing you can do yet gives this item. ${lvlWarn(item.id)}</div>`;
    const task = slayerTaskNow();
    if (task && (!o || o.type !== "fight" || !o.onTask)) {
      const f = fights.find((x) => x.onTask);
      if (f) html += `<div class="mbd-chips">${chip(`<i class="fa fa-skull"></i> Your Slayer task (${esc(nm(f.m))}) drops this, pick it from the list to count both`, "", "")}</div>`;
    }
    return html;
  };

  // ---------- breakdown rows -> popup html / queue entries ----------
  const lvlChip = (skill, a) =>
    skill && (a.level ?? 1) > skill.level
      ? chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;Needs ${esc(nm(skill))} level ${a.level} (you have ${skill.level})`, "warn")
      : "";
  const lvlWarn = (id) => {
    buildIndex();
    if (idx.shop.get(id)) return "";
    const opts = [...(idx.gatherers.get(id) ?? []), ...(idx.randoms.get(id) ?? [])];
    if (!opts.length || opts.some((x) => (x.a.level ?? 1) <= x.skill.level)) return "";
    const best = opts.reduce((m, x) => ((x.a.level ?? 1) - x.skill.level < (m.a.level ?? 1) - m.skill.level ? x : m));
    return `<div class="mbd-chips">${lvlChip(best.skill, best.a)}</div>`;
  };
  const buyHtml = (id, need) => {
    buildIndex();
    const p = idx.shop.get(id)?.[0];
    if (!p || need <= 0) return "";
    try {
      const per = Math.max(1, p.contains.items.find((c) => c.item.id === id)?.quantity ?? 1);
      let n = Math.ceil(need / per);
      if (!p.allowQuantityPurchase) n = Math.min(n, 1);
      n = Math.min(n, game.shop.capPurchaseQuantity(p, n));
      if (!(n > 0)) return "";
      const bought = game.shop.getPurchaseCount(p);
      const parts = [];
      for (const c of p.costs.currencies ?? []) parts.push(`${num(game.shop.getCurrencyCost(c, n, bought))} ${esc(nm(c.currency))}`);
      for (const c of p.costs.items ?? []) parts.push(`${num(c.quantity * n)} ${esc(nm(c.item))}`);
      const ok = game.shop.getPurchaseCosts(p, n).checkIfOwned() && game.checkRequirements(p.purchaseRequirements);
      const label = `<i class="fa fa-shopping-cart mr-1"></i>Buy ${num(n * per)} ${esc(nm(itemById(id)))} for ${parts.join(" + ")}`;
      return `<div class="mbd-chips"><button type="button" class="btn btn-sm ${ok ? "btn-success" : "btn-outline-secondary"}" data-mbd-buy="${esc(p.id)}" data-n="${n}"${ok ? "" : " disabled"}>${label}</button></div>` +
        (ok ? "" : `<div class="mbd-chips">${chip("You can't afford this yet, or it's locked", "warn")}</div>`);
    } catch (e) { console.warn("[Township Task Helper] shop button", e); return ""; }
  };

  const reqText = (r) => {
    try {
      if (r.type === "SkillLevel") return `${r.level} ${nm(r.skill)}`;
      if (r.type === "DungeonCompletion") return `${nm(r.dungeon)} completed${r.count > 1 ? ` ${r.count} times` : ""}`;
      if (r.type === "ShopPurchase") return `${nm(r.purchase)} (from the shop)`;
      if (r.type === "SlayerItem") return `${nm(r.item)} equipped`;
    } catch (e) { /* fall through */ }
    return String(r.type ?? "an unmet requirement").replace(/([a-z])([A-Z])/g, "$1 $2");
  };
  const areaMissing = (m) => {
    const a = areaFor(m);
    const out = [];
    for (const r of a?.entryRequirements ?? []) {
      try { if (!game.checkRequirement(r)) out.push({ text: reqText(r), forName: nm(m) }); } catch (e) { /* ignore */ }
    }
    return out;
  };
  const itemMissing = (item, qty, fresh = false) => {
    const out = [];
    for (const n of buildRows(item, qty, fresh)) {
      if (n.recipe) {
        const { c } = n.recipe;
        if ((c.a.level ?? 1) > c.skill.level) out.push({ text: `${c.a.level} ${nm(c.skill)}`, forName: nm(n.item) });
        continue;
      }
      const id = n.item.id;
      if (idx.shop.get(id)) continue;
      const opts = [...(idx.gatherers.get(id) ?? []), ...(idx.randoms.get(id) ?? [])];
      if (!opts.length || opts.some((x) => (x.a.level ?? 1) <= x.skill.level)) continue;
      try { if (idx.droppers.get(id)?.some((m) => areaFor(m) && !areaMissing(m).length)) continue; } catch (e) { /* ignore */ }
      const best = opts.reduce((m, x) => ((x.a.level ?? 1) - x.skill.level < (m.a.level ?? 1) - m.skill.level ? x : m));
      out.push({ text: `${best.a.level ?? 1} ${nm(best.skill)}`, forName: nm(n.item) });
    }
    const seen = new Set();
    return out.filter((x) => { const k = x.text + "|" + x.forName; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const missingHtml = (miss) =>
    `<div class="mbd-step">` +
    miss.map((x) => `<div class="mbd-chips">${chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;Warning: ${esc(x.text)} required for ${esc(x.forName)}`, "warn")}</div>`).join("") +
    `<div class="mbd-note">You can't queue this until you meet the requirements.</div></div>`;

  const buildRows = (item, qty, fresh = false) => {
    buildIndex();
    const nodes = new Map();
    explode(item, qty, 0, new Set(), nodes);
    // second pass, parents before children: what the bank already holds is used first, and only the rest is made
    const demand = new Map([[item.id, qty]]);
    const rows = [];
    for (const n of [...nodes.values()].sort((a, b) => a.depth - b.depth)) {
      const need = demand.get(n.item.id) ?? 0;
      if (need <= 0) continue;
      const isRoot = fresh && n.item.id === item.id;
      const owned = isRoot ? 0 : have(n.item) ?? 0;
      const make = Math.max(0, need - owned);
      n.need = need;
      n.fresh = isRoot;
      n.qty = make;
      if (n.recipe) {
        const { c, opt } = n.recipe;
        const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult) * succ(c.skill, c.a);
        const crafts = Math.ceil(make / per);
        n.recipe = { c, opt, crafts };
        if (make > 0) {
          for (const cost of [...baseCosts(c.a), ...opt.costs]) {
            if (cost?.item) demand.set(cost.item.id, (demand.get(cost.item.id) ?? 0) + cost.quantity * crafts);
          }
        }
      }
      if (make > 0) rows.push(n);
    }
    return rows.sort((a, b) => b.depth - a.depth || nm(a.item).localeCompare(nm(b.item)));
  };

  const itemSection = (item, qty, fresh = false) => {
    const rows = buildRows(item, qty, fresh);
    if (!rows.length) return `<div class="mbd-step"><div class="mbd-chips">${chip(`<i class="fa fa-check"></i> You already have enough in your bank`, "ok")}</div></div>`;
    return rows.map((n, i) => {
      const owned = have(n.item);
      const haveChip = owned === null || n.fresh ? "" : chip(`You have ${num(owned)}${n.need !== undefined ? ` of ${num(n.need)} needed` : ""}`);
      let title, chips;
      if (n.recipe) {
        const { c, opt, crafts } = n.recipe;
        const uses = [...baseCosts(c.a), ...opt.costs].filter((x) => x?.item).map((x) => chip(`${icon(x.item)}${num(x.quantity * crafts)} ${esc(nm(x.item))}`));
        const alts = (idx.crafters.get(n.item.id)?.length ?? 1) - 1 + options(c.a).length - 1;
        title = `${icon(c.skill)}<b>${esc(nm(c.skill))}</b>: make ${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips =
          `<div class="mbd-chips">${chip(`Level ${c.a.level ?? 1}`)}${chip(`${num(crafts)} craft${crafts === 1 ? "" : "s"}`)}${haveChip}${alts > 0 ? chip(`${alts} other option${alts === 1 ? "" : "s"}`) : ""}</div>` +
          (uses.length ? `<div class="mbd-chips">${chip("<b>Uses</b>", "lbl")}${uses.join("")}</div>` : "") +
          (lvlChip(c.skill, c.a) ? `<div class="mbd-chips">${lvlChip(c.skill, c.a)}</div>` : "");
      } else {
        title = `${icon(n.item)}<b>${esc(nm(n.item))}</b> &times;${num(n.qty)}`;
        chips = `<div class="mbd-chips">${haveChip}</div>` + (isAstroItem(n.item) ? astroHtml(n.item, n.qty) : isFarmItem(n.item) ? farmHtml(n.item, n.qty) + buyHtml(n.item.id, n.qty) : sourceHtml(n.item.id) + buyHtml(n.item.id, n.qty) + lvlWarn(n.item.id));
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
      if (!g && isAstroItem(n.item)) {
        const ch = conChoice(n.item);
        if (ch) return { ...base, kind: "gather", skillId: ASTRO_ID, actionId: ch.c.id, constellation: Astro.pick === "best" ? "best" : ch.c.id, label: `${nm(astroSkill())}: study ${nm(ch.c)} for ${nm(n.item)}` };
      }
      if (!g && isFarmItem(n.item)) {
        const fp = farmPlan(n.item, false, n.qty), o = fp.opt;
        if (o && o.type === "skill") return { ...base, kind: "gather", skillId: o.skill.id, actionId: o.a.id, farm: fp.auto ? "best" : "fixed", label: `${nm(o.skill)}: ${nm(o.a)} for ${nm(n.item)}` };
        if (o && o.type === "fight" && (o.safety.safe || Farm.risk[n.item.id])) return { ...base, kind: "combat", monsterId: o.m.id, untilItem: n.item.id, targetKills: Math.ceil(n.qty / o.perKill), label: `Fight ${nm(o.m)} for ${nm(n.item)}` };
      }
      if (g) return { ...base, kind: "gather", skillId: g.skill.id, actionId: g.a.id, label: `${nm(g.skill)}: gather ${nm(n.item)}` };
      return { ...base, qty: n.need ?? n.qty, kind: "manual", label: `Get ${nm(n.item)}`, note: plain(sourceText(n.item.id)) };
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
    if (tri) weak.push(styleChip(tri, "ok", `Combat triangle: ${cap(tri)} beats ${cap(m.attackType)}`, ` <small>beats ${cap(m.attackType)}</small>`));
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
    try { pl.changeEquipmentSet(i); } catch (e) { console.warn("[Township Task Helper]", e); }
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
  const buyFromShop = (id, n) => {
    try {
      const p = game.shop.purchases.getObjectByID(id);
      if (!p || !(n > 0)) return;
      const old = game.shop.buyQuantity;
      game.shop.buyQuantity = n;
      try { game.shop.buyItemOnClick(p, true); } finally { game.shop.buyQuantity = old; }
    } catch (e) { console.warn("[Township Task Helper] buy failed", e); }
  };
  const fire = (title, body, onQueue, hooks) => {
    const bodyFn = typeof body === "function" ? body : () => body;
    const res = SwalLocale.fire({
      title,
      html: `<div class="text-center font-size-sm mbd-th-pop">${bodyFn()}</div>`,
      confirmButtonText: "Close",
      showDenyButton: !!onQueue,
      denyButtonText: '<i class="fa fa-play mr-1"></i>Add to queue',
      showCancelButton: !!onQueue,
      cancelButtonText: '<i class="fa fa-arrow-up mr-1"></i>Add to top',
      // same shape and size as the Close button (btn btn-primary m-1), different colours
      customClass: { confirmButton: "btn btn-primary m-1", denyButton: "btn btn-success m-1", cancelButton: "btn btn-warning m-1" },
      didOpen: (popup) => {
        try { hooks?.didOpen?.(popup); } catch (e) { console.warn("[Township Task Helper]", e); }
        const acts = popup?.querySelector?.(".swal2-actions");
        if (acts) Object.assign(acts.style, { display: "flex", justifyContent: "center", alignItems: "center", gap: "5px", flexWrap: "nowrap", margin: "1em auto 0" });
        // order: Add to queue, Add to top, Close
        const ord = { ".swal2-deny": "1", ".swal2-cancel": "2", ".swal2-confirm": "3" };
        const sz = { height: "36px", padding: "0 16px", "font-size": "14px", "line-height": "1", "box-sizing": "border-box", display: "inline-flex", "align-items": "center", "justify-content": "center", "box-shadow": "none", outline: "none", margin: "0" };
        for (const [sel, o] of Object.entries(ord)) {
          const el = popup?.querySelector?.(sel);
          if (!el || (!onQueue && sel !== ".swal2-confirm")) continue;
          el.style.order = o;
          for (const [k, v] of Object.entries(sz)) el.style.setProperty(k, v, "important");
          if (sel === ".swal2-confirm") el.style.setProperty("min-width", "84px", "important");
        }
        popup?.addEventListener?.("change", (ev) => {
          const fs = ev.target?.closest?.("[data-mbd-farm]");
          const fr = ev.target?.closest?.("[data-mbd-risk]");
          if (fs || fr) {
            if (fs) Farm.pick[fs.dataset.mbdFarm] = fs.value;
            if (fr) Farm.risk[fr.dataset.mbdRisk] = fr.checked;
            const pop2 = popup.querySelector(".mbd-th-pop");
            if (pop2) pop2.innerHTML = bodyFn();
            return;
          }
          const s = ev.target?.closest?.("[data-mbd-astro]");
          if (!s) return;
          Astro.pick = s.value;
          const pop = popup.querySelector(".mbd-th-pop");
          if (pop) pop.innerHTML = bodyFn();
        });
        popup?.addEventListener?.("click", (ev) => {
          const wk = ev.target.closest?.("[data-mbd-wiki]");
          if (wk) {
            // always a new tab; never navigate the game's own tab
            ev.preventDefault();
            ev.stopPropagation();
            let w = null;
            try { w = window.open(wk.href, "_blank"); if (w) w.opener = null; } catch (e) { /* blocked */ }
            if (!w) { try { navigator.clipboard.writeText(wk.href); } catch (e) { /* ignore */ } tellPlayer("Your browser blocked the new tab. The wiki link was copied, paste it into a new tab."); }
            return;
          }
          const bb = ev.target.closest?.("[data-mbd-buy]");
          if (bb) {
            ev.preventDefault();
            ev.stopPropagation();
            buyFromShop(bb.dataset.mbdBuy, Number(bb.dataset.n));
            const pop = popup.querySelector(".mbd-th-pop");
            if (pop) pop.innerHTML = bodyFn();
            return;
          }
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
        } catch (e) { console.warn("[Township Task Helper]", e); }
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
        if (e.kind === "train") { e.kind = "xp"; delete e.targetLevel; delete e.now; delete e.afterLevel; } // old level goals from before Train a skill moved to its own mod
        if (e.status === "active" || e.status === "waiting" || e.status === "blocked") e.status = "pending";
        delete e.reason; delete e.ack; delete e.t0; delete e.g0; delete e.started;
      }
      updateBadge();
    },
    save() {
      try { localStorage.setItem(this.key(), JSON.stringify(this.items)); } catch (e) { console.warn("[Township Task Helper] could not save queue", e); }
      updateBadge();
      Panel.render();
    },
    add(entries, top = false) {
      const fresh = entries.map((e) => ({ ...e, id: uid(), status: "pending" }));
      this.items = top ? [...fresh, ...this.items] : [...this.items, ...fresh];
      this.save();
    },
    insertBefore(id, entries) {
      const fresh = entries.map((e) => ({ ...e, id: uid(), status: "pending" }));
      const i = this.items.findIndex((e) => e.id === id);
      if (i < 0) this.items.push(...fresh); else this.items.splice(i, 0, ...fresh);
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
    let skill = skillById(e.skillId);
    if (e.farm === "best" && e.kind === "gather") { const it = itemById(e.itemId), b = it && bestFarmSkill(it); if (b) { e.skillId = b.skill.id; e.actionId = b.a.id; skill = skillById(e.skillId); } }
    if (skill?.id === ASTRO_ID && e.constellation === "best") { const it = itemById(e.itemId), b = it && bestCon(it); if (b) e.actionId = b.c.id; }
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
        case "melvorD:Magic":
          skill.selectSpellOnClick(a);
          if (!skill.isActive) skill.castButtonOnClick();
          break;
        case "melvorD:Thieving":
          if (!a.area) return { ok: false, reason: "no thieving area found for this target" };
          skill.startThieving(a.area, a);
          break;
        case "melvorD:Firemaking":
          if (have(a.log) !== null && have(a.log) < 1) return { ok: false, reason: `no ${nm(a.log)} in the bank` };
          skill.selectLog(a);
          skill.burnLog();
          break;
        case "melvorD:Astrology":
          skill.studyConstellationOnClick(a);
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
    return { ok: false, noMaterials: e.kind === "craft" && (a.level ?? 1) <= skill.level, reason: e.kind === "craft" ? "not enough materials (or level too low)" : "the game wouldn't start it" };
  };

  // ---------- XP goals: pick the fastest XP method the player can use right now ----------
  const MELVOR_REALM = "melvorD:Melvor";
  const xpRate = (skill, a) => {
    const ms = a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
    return ms > 0 ? (((a.baseExperience ?? 0) * succ(skill, a)) / ms) * 3600000 : 0;
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
  // can the player get this item with the levels they have now? (bank, gathering, shop, monster drops, or crafting it from such things)
  const obtCache = { t: 0, m: new Map() };
  const obtainableRaw = (item, seen, depth) => {
    if (!item) return false;
    if ((have(item) ?? 0) > 0) return true;
    buildIndex();
    const id = item.id;
    if (seen.has(id) || depth > 6) return false;
    seen.add(id);
    const lvlOk = (x) => (x.a.level ?? 1) <= x.skill.level;
    if (idx.gatherers.get(id)?.some(lvlOk) || idx.randoms.get(id)?.some(lvlOk)) return true;
    try { if (idx.shop.get(id)?.some((p) => game.checkRequirements(p.purchaseRequirements))) return true; } catch (e) { /* ignore */ }
    try { if (idx.droppers.get(id)?.some((m) => areaFor(m) && !areaMissing(m).length)) return true; } catch (e) { /* ignore */ }
    for (const c of idx.crafters.get(id) ?? []) {
      if (!lvlOk(c)) continue;
      if (options(c.a).some((o) => [...baseCosts(c.a), ...o.costs].every((k) => !k?.item || obtainableRaw(k.item, new Set(seen), depth + 1)))) return true;
    }
    return false;
  };
  const obtainable = (item) => {
    const now = Date.now();
    if (now - obtCache.t > 5000) { obtCache.m.clear(); obtCache.t = now; }
    if (!item) return false;
    if (!obtCache.m.has(item.id)) obtCache.m.set(item.id, obtainableRaw(item, new Set(), 0));
    return obtCache.m.get(item.id);
  };
  const feasibleOption = (a) => {
    if (a.log) return obtainable(a.log) ? 0 : null;
    if (a.alternativeCosts?.length) {
      const i = a.alternativeCosts.findIndex((o) => [...baseCosts(a), ...(o.itemCosts ?? [])].every((k) => !k?.item || obtainable(k.item)));
      return i >= 0 ? i : null;
    }
    return baseCosts(a).every((k) => !k?.item || obtainable(k.item)) ? 0 : null;
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
        let opt = affordableOption(a);
        if (opt === null) {
          if (!ignoreMaterials) continue;
          opt = feasibleOption(a);
          if (opt === null) continue;
        }
        altIndex = opt;
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
    if (!all.length) return html + `<div class="mbd-place">Nothing found that you can train with your current levels and materials.</div>`;
    const best = all[0];
    html += `<div class="mbd-step"><div class="mbd-stepno">Fastest method right now</div>` +
      `<div class="mbd-title">${icon(best.a.product ?? best.a.log)}<b>${esc(nm(best.a))}</b></div>` +
      `<div class="mbd-chips">${chip(`Level ${best.a.level ?? 1}`)}${chip(`${num(Math.round(best.rate))} XP/hour`)}${chip(`About ${fmtTime(left / best.rate)}`, "ok", "Base XP only, ignoring mastery and other bonuses")}</div>` +
      `</div>`;
    if (!ready.length) {
      const mb = xpMaterialBatch({ id: "preview", skillId: skill.id, targetXp: target });
      if (mb.ok) {
        const steps = mb.entries.filter((x) => x.kind !== "manual").map((x) => chip(`${esc(x.label)} &times;${num(x.qty)}`)).join("");
        html += `<div class="mbd-step"><div class="mbd-stepno">First, get the materials</div><div class="mbd-chips">${steps}</div>` +
          `<div class="mbd-note">${esc(mb.note ?? "")}. You don't have them in your bank, so the queue gathers and makes them first, then trains.</div></div>`;
      } else html += `<div class="mbd-chips">${chip(esc(mb.reason), "warn")}</div>`;
    }
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
      return { ok: false, noMaterials: !!hint, reason: hint ? `no materials for ${nm(hint.a)} or anything else you can train. Get some, then press Start` : `nothing to train at ${nm(skill)} level ${skill.level}` };
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
  const areaFor = (m) => {
    for (const key of ["combatAreas", "slayerAreas"]) for (const a of list(game[key])) if ((a.monsters ?? []).includes(m)) return a;
    return null;
  };
  const killCount = (e) => { try { return game.stats.monsterKillCount(game.monsters.getObjectByID(e.monsterId)) ?? 0; } catch (err) { return 0; } };
  const startCombat = (e) => {
    const m = game.monsters.getObjectByID(e.monsterId);
    if (!m) return { ok: false, reason: "this monster wasn't found in your game version" };
    const area = areaFor(m);
    if (!area) return { ok: false, reason: "this monster is in a dungeon or special area, so fight it yourself, then press Start" };
    try {
      if (game.activeAction && game.activeAction !== game.combat) game.stopActiveAction();
      game.combat.selectMonster(m, area);
    } catch (err) { return { ok: false, reason: "error: " + err.message }; }
    if (game.activeAction === game.combat && game.combat.selectedMonster === m) return { ok: true };
    return { ok: false, reason: "couldn't start the fight (area requirements or a damage type rule)" };
  };
  const startEntry = (e) => (e.kind === "xp" ? startBest(e) : e.kind === "combat" ? startCombat(e) : startAction(e));

  // ---------- Farming: plant, wait for the crop to grow, harvest ----------
  // Farming has no "active action". Crops grow on real-time timers, so the queue plants what the step needs, waits, and harvests.
  // It only uses plots you already unlocked and seeds you already own.
  const FARMING_ID = "melvorD:Farming";
  const PLOT = { locked: 0, empty: 1, growing: 2, grown: 3, dead: 4 };
  const isFarmEntry = (e) => e?.skillId === FARMING_ID && (e.kind === "gather" || e.kind === "xp");
  const farmSkill = () => skillById(FARMING_ID);
  const plotsFor = (f, r) => {
    try { const p = [...(f.getPlotsForCategory(r.category) ?? [])]; if (p.length) return p; } catch (e) { /* use the fallback */ }
    return list(f.plots).filter((p) => p.category === r.category);
  };
  const openPlots = (f, r) => plotsFor(f, r).filter((p) => p.state !== PLOT.locked);
  const growMs = (f, r) => { try { const v = f.modifyInterval(r.baseInterval, r); return v > 0 ? v : r.baseInterval; } catch (e) { return r.baseInterval; } };
  const seedCostOf = (f, r) => { try { return f.getRecipeSeedCost(r); } catch (e) { return r.seedCost?.quantity ?? 1; } };
  const cropXp = (f, r) => (r.baseExperience ?? 0) * (r.category?.scaleXPWithQuantity ? r.baseQuantity ?? 1 : 1);
  const plotLeft = (f, p) => { try { return f.getPlotGrowthTime(p); } catch (e) { return 0; } };
  const farmCrops = (f) => list(f.actions).filter((r) => (!r.realm || r.realm.id === MELVOR_REALM) && r.seedCost?.item && (r.level ?? 1) <= f.level);
  // the crop that gives the most XP per hour with the plots and seeds you have (ownedOnly: count only what the bank can plant now)
  const bestCrop = (f, ownedOnly = true) => {
    let best = null;
    for (const r of farmCrops(f)) {
      const plots = openPlots(f, r).length;
      if (!plots) continue;
      const cost = seedCostOf(f, r), seeds = have(r.seedCost.item) ?? 0;
      if (ownedOnly && seeds < cost) continue;
      const n = ownedOnly ? Math.min(plots, Math.floor(seeds / cost)) : plots;
      const xpHr = ((cropXp(f, r) * Math.max(1, n)) / growMs(f, r)) * 3600000;
      if (!best || xpHr > best.xpHr) best = { r, xpHr, plots, n };
    }
    return best;
  };
  // one pass for a Farming step: harvest what's ready, plant what's needed, say whether to wait
  const farmStep = (cur) => {
    const f = farmSkill();
    if (!f) return { block: "Farming wasn't found in your game version" };
    const xpMode = cur.kind === "xp";
    let r = null;
    if (xpMode) {
      r = cur.cropId ? actionById(f, cur.cropId) : null;
      const busy = r && openPlots(f, r).some((p) => p.plantedRecipe === r && p.state !== PLOT.empty);
      if (!busy) {
        const b = bestCrop(f);
        if (!b) return { block: "no seeds to plant. Get some seeds, then press Start" };
        r = b.r; cur.cropId = r.id;
      }
    } else r = actionById(f, cur.actionId);
    if (!r) return { block: "this crop wasn't found in your game version" };
    if ((r.level ?? 1) > f.level) return { block: `needs Farming level ${r.level} (you have ${f.level})` };
    const plots = openPlots(f, r);
    if (!plots.length) return { block: `you haven't unlocked any ${nm(r.category)} plots yet` };
    const mine = (p) => p.plantedRecipe === r;
    for (const p of plots) if (mine(p) && p.state === PLOT.dead) f.clearDeadPlot(p);
    for (const p of plots) if (mine(p) && p.state === PLOT.grown) f.harvestPlot(p);
    const per = Math.max(1, r.baseQuantity ?? 1);
    const done = xpMode ? (f.xp ?? 0) >= cur.targetXp : Runner.gained(cur) >= cur.qty;
    if (done) return { done: true };
    const growing = plots.filter((p) => mine(p) && p.state === PLOT.growing);
    const need = xpMode ? Math.ceil((cur.targetXp - (f.xp ?? 0)) / Math.max(1, cropXp(f, r))) : Math.ceil((cur.qty - Runner.gained(cur)) / per);
    const toPlant = need - growing.length;
    if (toPlant > 0) {
      const empty = plots.filter((p) => p.state === PLOT.empty);
      const cost = seedCostOf(f, r), seeds = have(r.seedCost.item) ?? 0;
      const n = Math.min(toPlant, empty.length, Math.floor(seeds / cost));
      for (let i = 0; i < n; i++) f.plantPlot(empty[i], r);
      if (n === 0 && !growing.length) {
        return { block: empty.length ? `needs ${cost} ${nm(r.seedCost.item)} to plant ${nm(r)} and you have ${seeds}. Get some, then press Start` : `all your ${nm(r.category)} plots are busy with other crops. Harvest or clear them, then press Start` };
      }
    }
    const now = plots.filter((p) => mine(p) && p.state === PLOT.growing);
    if (!now.length) return { again: true };
    const ms = Math.max(...now.map((p) => plotLeft(f, p)));
    return { wait: ms, note: `Waiting for ${nm(r)} to grow: ${now.length} planted, ready in ${fmtDur(ms)}` };
  };
  // base-speed estimate: every planting round takes one growth time, and each round fills all your plots of that kind
  const farmEstimate = (e) => {
    const f = farmSkill();
    if (!f) return null;
    if (e.kind === "xp") {
      const b = bestCrop(f, false);
      return b && b.xpHr > 0 ? (Math.max(0, e.targetXp - (f.xp ?? 0)) / b.xpHr) * 3600000 : null;
    }
    const r = actionById(f, e.actionId);
    if (!r) return null;
    const plots = Math.max(1, openPlots(f, r).length);
    const units = Math.max(0, e.qty - Runner.gained(e));
    return Math.ceil(units / (Math.max(1, r.baseQuantity ?? 1) * plots)) * growMs(f, r);
  };

  // ---------- time estimates (base speeds; the active entry switches to its measured speed after a few seconds) ----------
  const intervalMs = (skill, a) =>
    a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
  const msPerUnit = (e) => {
    const skill = skillById(e.skillId);
    if (!skill) return null;
    if (e.kind === "combat") return null;
    if (e.kind === "xp") { const best = xpCandidates(skill, true)[0]; return best && best.rate > 0 ? 3600000 / best.rate : null; }
    const a = actionById(skill, e.actionId);
    if (!a) return null;
    if (skill.id === ASTRO_ID && e.itemId) { const r = astroPerHour(skill, a, itemById(e.itemId)); return r > 0 ? 3600000 / r : null; }
    if (e.kind === "gather" && e.itemId && (!a.product || a.product.id !== e.itemId)) { const o = farmSkills(itemById(e.itemId)).find((x) => x.a === a); return o && o.perHr > 0 ? 3600000 / o.perHr : null; }
    const ms = intervalMs(skill, a);
    if (e.kind === "gather") return ms / Math.max(1, a.baseQuantity ?? 1);
    const opt = options(a)[e.altIndex ?? 0];
    return ms / (Math.max(1, (a.baseQuantity ?? 1) * (opt?.mult ?? 1)) * succ(skill, a));
  };
  const remainingUnits = (e) => (e.kind === "combat" ? Math.max(0, e.targetKills - Runner.gained(e)) : e.kind === "xp" ? Math.max(0, e.targetXp - (skillById(e.skillId)?.xp ?? 0)) : Math.max(0, e.qty - Runner.gained(e)));
  const estimateMs = (e) => {
    if (e.kind === "manual" || e.status === "done") return 0;
    const units = remainingUnits(e);
    if (units <= 0) return 0;
    if (isFarmEntry(e)) return farmEstimate(e);
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
      if (e.kind === "combat") { const c = killCount(e); return e.rel ? Math.max(0, c - (e.k0 ?? c)) : c; }
      if (e.kind === "xp") return Math.floor(skillById(e.skillId)?.xp ?? 0);
      if (e.startQty === undefined) return 0;
      return Math.max(0, (have(itemById(e.itemId)) ?? 0) - e.startQty);
    },
    haltAction() {
      const s = this.activeSkillId === "combat" ? game.combat : this.activeSkillId ? skillById(this.activeSkillId) : null;
      try { if (s && game.activeAction === s) game.stopActiveAction(); } catch (e) { console.warn("[Township Task Helper]", e); }
    },
    leave() {
      if (this.activeId === null) return;
      const prev = Queue.items.find((e) => e.id === this.activeId);
      if (prev && prev.status === "active") prev.status = "pending";
      if (prev) delete prev.started;
      this.haltAction();
      this.activeId = null;
      this.activeSkillId = null;
    },
    start() {
      const cur = this.current();
      if (!cur) { this.setState("idle", "Nothing to run: the queue is empty or finished."); return; }
      if (cur.kind === "manual" && cur.status === "waiting") cur.ack = true;
      delete cur.started;
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
      if (cur && cur.status !== "done") { cur.status = "pending"; delete cur.startQty; delete cur.reason; delete cur.started; }
      // a manual step that was waiting for you goes back to pending, so pressing Start later doesn't count it as done
      for (const e of Queue.items) if (e.status === "waiting") e.status = "pending";
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
      delete entry.started;
      this.haltAction();
      this.activeId = null;
      this.activeSkillId = null;
      Queue.save();
      this.setState("paused", `Stopped at "${entry.label}": ${reason}. Fix it, then press Start.`);
    },
    sellExtra(entry) {
      try {
        if ((!Settings.autoSell() && !entry.sellAll) || (entry.kind !== "craft" && entry.kind !== "gather") || entry.startQty === undefined) return;
        const item = itemById(entry.itemId);
        if (!item || !(item.sellsFor?.quantity > 0) || isAstroItem(item)) return;
        const bi = game.bank.items.get(item);
        if (!bi || bi.locked) return;
        const extra = Math.min(bi.quantity, bi.quantity - entry.startQty - (entry.sellAll ? 0 : entry.qty));
        if (!(extra >= 1)) return;
        const price = game.bank.getItemSalePrice(item, extra);
        game.bank.processItemSale(item, extra);
        entry.sold = `Sold ${extra.toLocaleString()}${entry.sellAll ? "" : " extra"} for ${price.toLocaleString()} ${nm(item.sellsFor.currency)}`;
      } catch (e) { console.warn("[Township Task Helper] auto-sell", e); }
    },
    finish(entry) {
      this.sellExtra(entry);
      entry.status = "done";
      delete entry.reason;
      delete entry.started;
      const s = entry.kind === "combat" ? game.combat : skillById(entry.skillId);
      try { if (s && game.activeAction === s) game.stopActiveAction(); } catch (e) { console.warn("[Township Task Helper]", e); }
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
          this.activeSkillId = cur.kind === "combat" ? "combat" : cur.skillId ?? null;
          cur.status = "active";
          delete cur.reason;
          if (cur.kind !== "manual" && cur.kind !== "xp" && (cur.kind !== "combat" || cur.untilItem) && cur.startQty === undefined) cur.startQty = have(itemById(cur.itemId)) ?? 0;
          Queue.save();
          if (cur.kind !== "manual" && !isFarmEntry(cur)) {
            const r = startEntry(cur);
            if (!r.ok && !((cur.kind === "xp" || cur.kind === "craft") && r.noMaterials)) { // an XP step with no materials is handled just below: it adds the steps to get them
              if (r.transient) { this.message = r.reason; Panel.render(); return; }
              this.block(cur, r.reason);
              return;
            }
          }
          cur.t0 = Date.now();
          cur.g0 = this.gained(cur);
          if (cur.kind === "combat") { cur.started = true; if (cur.rel && cur.k0 === undefined) cur.k0 = killCount(cur); }
        }

        if (isFarmEntry(cur)) {
          const fr = farmStep(cur);
          if (fr.done) { this.finish(cur); continue; }
          if (fr.block) { this.block(cur, fr.block); return; }
          if (fr.again) continue;
          this.message = fr.note;
          Panel.render();
          return;
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
          if (rx.noMaterials) {
            const xpNow = Math.floor(sk?.xp ?? 0);
            if (cur.matXp !== undefined && xpNow <= cur.matXp) cur.matStall = (cur.matStall ?? 0) + 1; else cur.matStall = 0;
            cur.matXp = xpNow;
            if (cur.matStall >= 2) { this.block(cur, "getting the materials didn't lead to any XP, so the plan stopped. Check the steps above it"); return; }
            const mb = xpMaterialBatch(cur);
            if (!mb.ok) { this.block(cur, mb.reason); return; }
            Queue.insertBefore(cur.id, mb.entries);
            continue;
          }
          this.block(cur, `${rx.reason} (${this.gained(cur).toLocaleString()} of ${Number(cur.targetXp).toLocaleString()} XP)`);
          return;
        }

        if (cur.kind === "combat") {
          const mon = game.monsters.getObjectByID(cur.monsterId);
          if (cur.untilItem ? (have(itemById(cur.untilItem)) ?? 0) - (cur.startQty ?? 0) >= cur.qty : this.gained(cur) >= cur.targetKills) { this.finish(cur); continue; }
          if (game.activeAction === game.combat && game.combat.selectedMonster === mon) { Panel.render(); return; }
          if (game.activeAction && game.activeAction !== game.combat) { this.pause("Paused: something else started running."); return; }
          if (cur.started) { this.block(cur, `the fight stopped (you may have died or run out of food). ${this.gained(cur).toLocaleString()} of ${Number(cur.targetKills).toLocaleString()} kills done`); return; }
          const rc = startCombat(cur);
          if (rc.ok) { cur.started = true; Panel.render(); return; }
          this.block(cur, rc.reason);
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

        if (cur.untilLevel) {
          const us = skillById(cur.untilSkill ?? cur.skillId);
          if (us && (us.level >= cur.untilLevel || (cur.untilXp && (us.xp ?? 0) >= cur.untilXp))) { this.finish(cur); continue; }
        }
        if (owned - (cur.startQty ?? 0) >= cur.qty) { this.finish(cur); continue; }

        const skill = skillById(cur.skillId);
        if (cur.farm === "best" && skill) {
          if (cur.lvl === undefined) cur.lvl = skill.level;
          else if (skill.level > cur.lvl) {
            cur.lvl = skill.level;
            const it = itemById(cur.itemId), b = it && bestFarmSkill(it);
            if (b && (b.a.id !== cur.actionId)) { const rl = startEntry(cur); if (!rl.ok && !rl.transient) { this.block(cur, rl.reason); return; } }
          }
        }
        if (cur.constellation === "best" && skill?.id === ASTRO_ID) {
          if (cur.lvl === undefined) cur.lvl = skill.level;
          else if (skill.level > cur.lvl) {
            cur.lvl = skill.level;
            const it = itemById(cur.itemId), b = it && bestCon(it);
            if (b && b.c.id !== cur.actionId) { const rl = startEntry(cur); if (!rl.ok && !rl.transient) { this.block(cur, rl.reason); return; } }
          }
        }
        if (skill && skill.isActive && game.activeAction === skill) { Panel.render(); return; }
        if (game.activeAction && game.activeAction !== skill) { this.pause("Paused: something else started running."); return; }

        // nothing is running and the target isn't reached: the game stopped it (materials, etc.) so try again once
        const r = startEntry(cur);
        if (r.ok) { Panel.render(); return; }
        if (r.transient) { this.message = r.reason; Panel.render(); return; }
        if (r.noMaterials && cur.kind === "craft") {
          const made = this.gained(cur);
          if (cur.restockMade !== undefined && made <= cur.restockMade) cur.restockStall = (cur.restockStall ?? 0) + 1; else cur.restockStall = 0;
          cur.restockMade = made;
          const rs = restockCraft(cur);
          if (rs.ok && cur.restockStall < 2) {
            cur.restocks = (cur.restocks ?? 0) + 1;
            Queue.insertBefore(cur.id, rs.entries);
            this.message = `Short of materials for ${nm(itemById(cur.itemId))}: getting ${rs.remaining.toLocaleString()} more worth`;
            continue;
          }
          this.block(cur, `${rs.ok ? "it keeps running out of materials without making more" : rs.reason} (${made.toLocaleString()} of ${Number(cur.qty).toLocaleString()} done)`);
          return;
        }
        this.block(cur, `${r.reason} (${this.gained(cur).toLocaleString()} of ${Number(cur.qty).toLocaleString()} done)`);
        return;
      }
    },
  };

  // XP goal with no materials in the bank: work out the steps that get them (mine the ore, chop the logs, craft the parts)
  const levelForXp = (xp, cap = 120) => { let l = 1; while (l < cap && xpAt(l) < xp) l++; return l; };
  const xpMaterialBatch = (e) => {
    const skill = skillById(e.skillId);
    if (!skill) return { ok: false, reason: "this skill wasn't found in your game version" };
    if (isPlannable(skill)) {
      const r = nextBatch({ id: e.id, skillId: skill.id, targetLevel: levelForXp(e.targetXp, levelCapFor(skill)), targetXp: e.targetXp, forced: "" });
      return r;
    }
    const best = xpCandidates(skill, true)[0];
    if (!best) return { ok: false, reason: `nothing to train at ${nm(skill)} level ${skill.level}` };
    const a = best.a;
    const per = (a.log ? [{ item: a.log, quantity: 1 }] : [...baseCosts(a), ...(options(a)[best.altIndex]?.costs ?? [])]).filter((k) => k?.item);
    const goal = Math.min(e.targetXp, xpAt(Math.min(skill.level + 5, levelCapFor(skill))));
    const actions = Math.max(1, Math.ceil((goal - (skill.xp ?? 0)) / Math.max(1, (a.baseExperience ?? 1) * succ(skill, a))));
    const entries = [];
    for (const k of per) {
      const need = k.quantity * actions - (have(k.item) ?? 0);
      if (need > 0) entries.push(...toEntries(buildRows(k.item, need, true)));
    }
    if (!entries.length) return { ok: false, reason: `couldn't work out how to get the materials for ${nm(a)}` };
    if (entries.some((x) => x.kind === "manual")) return { ok: false, reason: `${nm(a)} needs something the queue can't get on its own` };
    for (const x of entries) x.parent = e.id;
    return { ok: true, entries, note: `Getting materials for ${nm(a)}` };
  };
  // A craft step ran out of ingredients before it made enough (Cooking burns food, Smithing and others can come up short):
  // work out what is still missing and the steps that get it
  const restockCraft = (e) => {
    const skill = skillById(e.skillId), a = actionById(skill, e.actionId), item = itemById(e.itemId);
    if (!skill || !a || !item) return { ok: false, reason: "this action wasn't found in your game version" };
    const opt = options(a)[e.altIndex ?? 0] ?? { costs: [], mult: 1 };
    const per = Math.max(1, (a.baseQuantity ?? 1) * opt.mult) * succ(skill, a);
    const remaining = e.qty - Math.max(0, (have(item) ?? 0) - (e.startQty ?? 0));
    const crafts = Math.max(1, Math.ceil(remaining / per));
    const entries = [];
    for (const k of [...baseCosts(a), ...opt.costs]) {
      if (!k?.item) continue;
      const need = k.quantity * crafts - (have(k.item) ?? 0);
      if (need > 0) entries.push(...toEntries(buildRows(k.item, need, true)));
    }
    if (!entries.length) return { ok: false, reason: "not enough materials (or level too low)" };
    if (entries.some((x) => x.kind === "manual")) return { ok: false, reason: `${nm(item)} needs something the queue can't get on its own` };
    for (const x of entries) x.parent = e.parent ?? e.id;
    return { ok: true, entries, remaining };
  };
  // ---------- XP planning (used by XP tasks) ----------
  // An XP goal never farms blindly: every method is ranked
  // by XP per hour of ALL the work it takes (gathering its materials included), and the plan only switches method when a
  // clearly better one opens up. The queue plans one batch at a time, so it always uses your real level and bank.
  const PLANNABLE = new Set([
    "melvorD:Woodcutting", "melvorD:Mining", "melvorD:Fishing", "melvorD:Cooking", "melvorD:Smithing",
    "melvorD:Fletching", "melvorD:Crafting", "melvorD:Runecrafting", "melvorD:Herblore",
  ]);
  const isPlannable = (s) => !!s && PLANNABLE.has(s.id);
  const levelIn = (skill, lv) => (lv && lv.has(skill.id) ? lv.get(skill.id) : skill.level);
  const xpAt = (l) => { try { return exp.level_to_xp(l); } catch (e) { return 0; } };
  const levelCapFor = (s) => (s.level >= 99 ? 120 : 99);
  const SWITCH_GAIN = 1.1; // keep the current method unless another is at least 10% faster, so plans don't split into tiny batches

  // time (ms) to get n of an item from scratch with things the queue can do itself; Infinity if it can't
  // also returns the XP those steps give in `skillId` (smelting bars trains Smithing too)
  const acquire = (item, n, lv, skillId, seen = new Set(), depth = 0) => {
    if (!(n > 0)) return { ms: 0, xp: 0 };
    buildIndex();
    const NO = { ms: Infinity, xp: 0 };
    if (depth > 10 || seen.has(item.id)) return NO;
    const c = idx.crafters.get(item.id)?.[0];
    if (c) {
      if (!isPlannable(c.skill) || (c.a.level ?? 1) > levelIn(c.skill, lv)) return NO;
      const opt = options(c.a)[0];
      const sr = succ(c.skill, c.a);
      const per = Math.max(1, (c.a.baseQuantity ?? 1) * opt.mult) * sr;
      const crafts = n / per; // attempts, not rounded up: this ranks methods by their steady rate
      let ms = crafts * intervalMs(c.skill, c.a), xp = c.skill.id === skillId ? crafts * sr * (c.a.baseExperience ?? 0) : 0;
      seen.add(item.id);
      for (const k of [...baseCosts(c.a), ...opt.costs]) {
        if (!k?.item) continue;
        const r = acquire(k.item, k.quantity * crafts, lv, skillId, seen, depth + 1);
        ms += r.ms; xp += r.xp;
      }
      seen.delete(item.id);
      return { ms, xp };
    }
    const g = idx.gatherers.get(item.id)?.[0];
    if (!g || !isPlannable(g.skill) || (g.a.level ?? 1) > levelIn(g.skill, lv)) return NO;
    const acts = n / Math.max(1, g.a.baseQuantity ?? 1);
    return { ms: acts * intervalMs(g.skill, g.a), xp: g.skill.id === skillId ? acts * (g.a.baseExperience ?? 0) : 0 };
  };
  const acquireMs = (item, n, lv) => acquire(item, n, lv, null).ms;
  // the same step the queue would really run for this product (first crafter / first gatherer)
  const stepFor = (a) => {
    buildIndex();
    const c = a.product && idx.crafters.get(a.product.id)?.[0];
    const g = a.product && idx.gatherers.get(a.product.id)?.[0];
    return c ? (c.a === a ? { craft: true } : null) : g && g.a === a ? { craft: false } : null;
  };
  // XP methods open at this level, best first by XP per hour of everything they need
  const methodCands = (skill, lv) => {
    const out = [];
    const L = levelIn(skill, lv);
    for (const a of list(skill.actions)) {
      if (a.realm && a.realm.id !== MELVOR_REALM) continue;
      if ((a.level ?? 1) > L || !(a.baseExperience > 0) || !a.product) continue;
      const st = stepFor(a);
      if (!st) continue;
      const opt = st.craft ? options(a)[0] : { costs: [], mult: 1 };
      const sr = succ(skill, a);
      const per = Math.max(1, (a.baseQuantity ?? 1) * opt.mult) * sr; // products per attempt
      let ms = intervalMs(skill, a), xpPer = a.baseExperience * sr;
      if (st.craft) for (const k of [...baseCosts(a), ...opt.costs]) if (k?.item) { const r = acquire(k.item, k.quantity, lv, skill.id); ms += r.ms; xpPer += r.xp; }
      if (!isFinite(ms) || ms <= 0) continue;
      const rate = (xpPer / ms) * 3600000;
      out.push({ a, per, ms, xpPer, rate, score: rate });
    }
    return out.sort((x, y) => y.score - x.score);
  };
  const levelPlan = (skill, target, forcedId, fromLevel = skill.level, fromXp = skill.xp ?? 0, seed = null) => {
    const sim = new Map(seed ?? []);
    const batches = [];
    let L = fromLevel, cur = null, blocked = null;
    for (let guard = 0; L < target && guard < 140; guard++) {
      sim.set(skill.id, L);
      let cands = methodCands(skill, sim);
      if (forcedId) cands = cands.filter((c) => c.a.id === forcedId);
      if (!cands.length) { blocked = L; break; }
      let pick = cands[0];
      if (cur) { const same = cands.find((c) => c.a === cur.c.a); if (same && pick.score < same.score * SWITCH_GAIN) pick = same; }
      if (!cur || cur.c.a !== pick.a) { cur = { c: pick, from: L, to: L }; batches.push(cur); }
      L++;
      cur.to = L;
    }
    let total = 0, xpPrev = fromXp;
    for (const b of batches) {
      const startXp = Math.max(xpPrev, xpAt(b.from));
      b.xpGain = Math.max(0, xpAt(b.to) - startXp);
      b.actions = Math.max(1, Math.ceil(b.xpGain / b.c.xpPer));
      b.ms = b.actions * b.c.ms;
      total += b.ms;
      xpPrev = xpAt(b.to);
    }
    return { batches, totalMs: total, blocked };
  };
  // the next batch of real queue steps for an XP goal, planned from the player's level and bank right now
  const nextBatch = (e) => {
    const skill = skillById(e.skillId);
    if (!skill) return { ok: false, reason: "this skill wasn't found in your game version" };
    const plan = levelPlan(skill, e.targetLevel, e.forced);
    if (!plan.batches.length) {
      const fa = e.forced && actionById(skill, e.forced);
      return { ok: false, reason: fa ? `${nm(fa)} can't be trained by the queue at level ${skill.level}` : `nothing at ${nm(skill)} level ${skill.level} can be trained by the queue on its own (it may need shop items or monster drops)` };
    }
    const b = plan.batches[0];
    const goalXp = Math.min(xpAt(b.to), e.targetXp ?? Infinity);
    const actions = Math.max(1, Math.ceil((goalXp - (skill.xp ?? 0)) / b.c.xpPer));
    const item = b.c.a.product;
    const rows = buildRows(item, Math.ceil(actions * b.c.per), true);
    const entries = toEntries(rows);
    const last = entries[entries.length - 1];
    if (!last || last.itemId !== item.id) return { ok: false, reason: "couldn't work out the steps" };
    if (entries.some((x) => x.kind === "manual")) return { ok: false, reason: `${nm(item)} needs something the queue can't get on its own` };
    Object.assign(last, { untilLevel: b.to, untilSkill: skill.id, sellAll: !!e.sellMade });
    if (e.targetXp !== undefined && e.targetXp <= xpAt(b.to)) last.untilXp = e.targetXp;
    for (const x of entries) x.parent = e.id;
    return { ok: true, entries, to: b.to, note: `${nm(b.c.a)} until level ${b.to} (about ${Math.round(b.c.rate).toLocaleString()} XP/h)` };
  };
  // ---------- floating panel ----------
  const levelIssue = (e) => {
    if (e.kind !== "craft" && e.kind !== "gather") return null;
    const sk = skillById(e.skillId), a = sk && actionById(sk, e.actionId);
    return a && (a.level ?? 1) > sk.level ? `Needs ${nm(sk)} level ${a.level} (you have ${sk.level})` : null;
  };
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
        else if (act === "autosell") { Settings.set("autoSell", !Settings.autoSell()); this.last = ""; this.render(); }
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
      const isCombat = e.kind === "combat";
      const item = isXp ? skillById(e.skillId) : isCombat ? game.monsters.getObjectByID(e.monsterId) : itemById(e.itemId);
      const manual = e.kind === "manual";
      const done = e.status === "done";
      const issue = !done && !manual ? levelIssue(e) : null;
      const warn = e.status === "blocked" || e.status === "waiting" || !!issue;
      const lead = done ? '<i class="fa fa-check text-success mr-2"></i>'
        : e.status === "active" ? '<i class="fa fa-play text-success mr-2"></i>'
        : warn ? '<i class="fa fa-exclamation-triangle text-warning mr-2"></i>'
        : '<i class="fa fa-circle mr-2" style="opacity:.25;font-size:8px;vertical-align:middle"></i>';
      const showProgress = !manual && !done && (isXp || isCombat || (e.startQty !== undefined && (e.status === "active" || e.status === "blocked" || Runner.gained(e) > 0)));
      const amount = isCombat ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.targetKills).toLocaleString()} kills</b>` : isXp ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.targetXp).toLocaleString()} XP</b>` : showProgress ? `<b>${Runner.gained(e).toLocaleString()} / ${Number(e.qty).toLocaleString()}</b>` : `<b>x${Number(e.qty).toLocaleString()}</b>`;
      const btn = (act, ic, title) =>
        `<a data-act="${act}" data-id="${esc(e.id)}" class="pointer-enabled text-white-50 ml-2" title="${title}"><i class="fa ${ic}"></i></a>`;
      const sub = done && e.sold ? `<br><small class="text-muted">${esc(e.sold)}</small>`
        : e.reason ? `<br><small class="text-warning">${esc(e.reason)}</small>`
        : issue ? `<br><small class="text-warning"><i class="fa fa-exclamation-triangle"></i> ${esc(issue)}</small>`
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
      const asOn = Settings.autoStart(), slOn = Settings.autoSell();
      const toggles =
        `<a data-act="autostart" class="pointer-enabled mr-2" title="Auto-start: ${asOn ? "On" : "Off"}" style="font-size:19px;line-height:1;${asOn ? "color:#30c78d" : "opacity:.45"}"><i class="fa ${asOn ? "fa-toggle-on" : "fa-toggle-off"}"></i></a>` +
        `<a data-act="autosell" class="pointer-enabled mr-2" title="Auto-sell extras: ${slOn ? "On" : "Off"}" style="font-size:15px;line-height:1;${slOn ? "color:#e5ae67" : "opacity:.45"}"><i class="fa fa-dollar-sign"></i></a>`;
      const html =
        `<div data-drag style="display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);cursor:move;user-select:none;touch-action:none" title="Drag to move">` +
        `<i class="fa fa-grip-vertical mr-2" style="opacity:.4"></i>${toggles}<b style="flex:1">Action Queue</b><span class="text-muted mr-2">${pending} action${pending === 1 ? "" : "s"} left</span>` +
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
  // ---------- duplicates ----------
  const entryKey = (e) => `${e.kind}|${e.itemId ?? e.monsterId ?? e.skillId ?? ""}|${e.actionId ?? e.forced ?? ""}|${e.targetXp ?? ""}`;
  const queuedKeys = () => new Set(Queue.items.filter((x) => x.status !== "done").map(entryKey));
  const dupHtml = (entries) => {
    if (!entries?.length) return "";
    const keys = queuedKeys();
    const dups = entries.filter((e) => keys.has(entryKey(e)));
    if (!dups.length) return "";
    const all = dups.length === entries.length;
    return `<div class="mbd-step"><div class="mbd-chips">${chip(`<i class="fa fa-exclamation-triangle"></i>&nbsp;${all ? "This task is already in your queue" : `${dups.length} of ${entries.length} steps are already in your queue`}`, "warn")}</div>` +
      `<div class="mbd-chips">${dups.map((e) => chip(esc(e.label))).join("")}</div>` +
      `<div class="mbd-note">${all ? "Adding it again does nothing." : "Those steps will be skipped, the rest are added."}</div></div>`;
  };
  const tellPlayer = (msg) => {
    try { notifyPlayer(game.township ?? game.attack, msg, "info"); } catch (e) { console.log("[Township Task Helper]", msg); }
  };
  const addUnique = (entries, top) => {
    const seen = queuedKeys();
    const fresh = [], skipped = [];
    for (const e of entries) {
      const k = entryKey(e);
      if (seen.has(k)) skipped.push(e.label); else { seen.add(k); fresh.push(e); }
    }
    if (fresh.length) Queue.add(fresh, top);
    if (skipped.length) tellPlayer(fresh.length ? `${skipped.length} step${skipped.length === 1 ? " was" : "s were"} already in the queue and skipped: ${skipped.join(", ")}` : "That task is already in your queue.");
    return fresh.length;
  };

  const killEntry = (goal, total) => {
    const m = goal.monster;
    const need = total ? goal.quantity : Math.max(0, goal.quantity - (goal._progress ?? 0));
    if (total ? game.stats.monsterKillCount(m) >= goal.quantity : need <= 0) return [];
    return [{ kind: "combat", monsterId: m.id, targetKills: need, rel: !total, qty: need, label: `Defeat ${nm(m)}` }];
  };
  const describeGoal = (goal) => {
    const type = goal?.constructor?.name;
    if (type === "TownshipItemGoal" && goal.item) {
      return {
        title: `${goal.quantity.toLocaleString()} x ${esc(nm(goal.item))}`,
        body: () => { const miss = itemMissing(goal.item, goal.quantity); return miss.length ? missingHtml(miss) : itemSection(goal.item, goal.quantity); },
        queue: () => (itemMissing(goal.item, goal.quantity).length ? [] : toEntries(buildRows(goal.item, goal.quantity))),
        blocked: () => itemMissing(goal.item, goal.quantity).length > 0 || !buildRows(goal.item, goal.quantity).length,
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
      return {
        title: esc(nm(goal.monster)),
        body: () => { const miss = areaMissing(goal.monster); return (miss.length ? missingHtml(miss) : "") + monsterSection(goal.monster, goal.quantity); },
        queue: () => (areaMissing(goal.monster).length ? [] : killEntry(goal, type === "TownshipMonsterGoal")),
        blocked: () => areaMissing(goal.monster).length > 0,
      };
    }
    if (type === "TownshipMonsterWithItemsGoal" && goal.monster) {
      return {
        title: esc(nm(goal.monster)),
        body: () => {
          const all = [...areaMissing(goal.monster), ...(goal.items ?? []).flatMap((it) => itemMissing(it, 1))];
          return (all.length ? missingHtml(all) : "") + monsterSection(goal.monster, goal.quantity) +
            (all.length ? "" : (goal.items ?? []).map((it) => heading(`Equipment needed: ${esc(nm(it))}`) + itemSection(it, 1)).join(""));
        },
        blocked: () => areaMissing(goal.monster).length > 0 || (goal.items ?? []).some((it) => itemMissing(it, 1).length > 0),
        queue: () => (areaMissing(goal.monster).length || (goal.items ?? []).some((it) => itemMissing(it, 1).length) ? [] : [...(goal.items ?? []).flatMap((it) => toEntries(buildRows(it, 1))), ...killEntry(goal, false)]),
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
        Astro.pick = "best"; Farm.pick = {}; Farm.risk = {};
        const onQueue = info.queue && !info.blocked?.() ? (top) => {
          const added = addUnique(info.queue(), top);
          Panel.open();
          if (added && Settings.autoStart() && Runner.state !== "running") Runner.start();
        } : null;
        fire(info.title, () => dupHtml(info.queue?.()) + info.body(), onQueue);
      } catch (e) { console.warn("[Township Task Helper]", e); }
    });
    holder.appendChild(btn);
  };

  // ---------- install ----------
  const refresh = () => {
    try {
      const t = game.township.tasks;
      for (const task of list(t.tasks)) t.renderQueue.taskGoals.add(task);
      t.render();
    } catch (e) { console.warn("[Township Task Helper] refresh failed", e); }
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
      .mbd-chip>span{display:inline;line-height:20px}
      .mbd-chip small{opacity:.8;font-size:.8em}
      .mbd-sets .btn{margin:0 2px}
      .mbd-place{margin:3px 0;font-size:13px}
      .mbd-place img{width:18px;height:18px;margin-right:4px;vertical-align:middle}
      .mbd-note{margin-top:8px;font-size:12px;opacity:.7}
      .mbd-form{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center;text-align:left;margin:0 0 10px}
      .mbd-form label{margin:0;font-size:13px;opacity:.85}
      .mbd-form select,.mbd-form input[type=number]{width:100%}
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
      try { decorate(this, goal); } catch (e) { console.warn("[Township Task Helper]", e); }
    };
    Queue.load();
    mountButton();
    clearInterval(window.__mbdThTimer);
    window.__mbdThTimer = setInterval(mountButton, 2000); // the game can rebuild the menu; put our button back if it vanishes
    clearInterval(window.__mbdThRunTimer);
    window.__mbdThRunTimer = setInterval(() => { try { Runner.step(); } catch (e) { console.warn("[Township Task Helper] runner", e); } }, 1000);
    refresh();
    window.townshipHelper = {
      version: VERSION,
      showItem: (id, qty = 1) => {
        Astro.pick = "best"; Farm.pick = {}; Farm.risk = {};
        const it = itemById(id);
        const miss = itemMissing(it, qty);
        fire(`${qty} x ${esc(nm(it))}`, () => (itemMissing(it, qty).length ? missingHtml(itemMissing(it, qty)) : dupHtml(toEntries(buildRows(it, qty))) + itemSection(it, qty)), miss.length || !buildRows(it, qty).length ? null : (top) => {
          const added = addUnique(toEntries(buildRows(it, qty)), top);
          Panel.open();
          if (added && Settings.autoStart() && Runner.state !== "running") Runner.start();
        });
      },
      refresh,
      queue: Queue,
      panel: Panel,
      runner: Runner,
      settings: Settings,
      // internals exposed for the test suite in tests/
      _dev: {
        itemMissing, areaMissing, missingHtml, reqText, buildRows, toEntries, itemSection, sourceHtml, buyHtml, buyFromShop, wikiUrl,
        monsterSection, foodHtml, setsHtml, describeGoal, entryKey, addUnique, dupHtml, tellPlayer, xpCandidates, xpSection, estimateMs,
        startAction, startEntry, killEntry, areaFor, obtainable, fire,
        succ, xpMaterialBatch, restockCraft, levelPlan, methodCands, acquireMs, nextBatch, fmtDur, Astro, Farm, farmSkills, farmFights, farmPlan, fightSafety, monsterMaxHit, dropPerKill, isFarmItem, farmHtml, astroCons, astroOptions, bestCon, astroHtml, isAstroItem,
      },
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
