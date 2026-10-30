// Township Task Helper: Township task breakdowns for Melvor Idle. The steps run in the Action Queue mod.
export function setup(ctx) {
(() => {
  "use strict";

  const VERSION = "0.20.1";
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
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const icon = (o) => (typeof o?.media === "string" ? `<img class="skill-icon-xs mr-1" src="${esc(o.media)}">` : "");
  const have = (item) => {
    try { const q = game.bank.getQty(item); return Number.isFinite(q) ? q : null; } catch (e) { return null; }
  };
  // This mod needs two others: Action Queue (the queue and its panel, where the steps go) and Skill Trainer (which knows how
  // to train each skill and run those steps). Township Task Helper works out what a task takes and adds the steps.
  const aq = () => (typeof mod !== "undefined" && mod?.api?.actionQueue) || window.actionQueue;
  const st = () => (typeof mod !== "undefined" && mod?.api?.skillTrainer) || window.skillTrainer;
  const MELVOR_REALM = "melvorD:Melvor", HITPOINTS = "melvorD:Hitpoints";
  const intervalMs = (skill, a) =>
    a.baseInterval ?? (a.baseMinInterval !== undefined && a.baseMaxInterval !== undefined ? (a.baseMinInterval + a.baseMaxInterval) / 2 : skill.baseInterval) ?? 3000;
  const fmtDur = (ms) => {
    if (!isFinite(ms)) return "an unknown time";
    const m = Math.round(ms / 60000);
    if (m < 1) return "under 1 min";
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const areaFor = (m) => {
    for (const key of ["combatAreas", "slayerAreas"]) for (const a of list(game[key])) if ((a.monsters ?? []).includes(m)) return a;
    return null;
  };
  const itemById = (id) => { try { return game.items.getObjectByID(id); } catch (e) { return null; } };
  const skillById = (id) => list(game.skills).find((s) => s.id === id);

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
  const Farm = { pick: {} };
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
      if (!o.safety.safe) html += `<div class="mbd-chips">${chip("<i class='fa fa-exclamation-triangle'></i> The queue won't run this fight, you do it yourself", "warn", "The queue only runs fights that are safe while you're away")}</div>`;
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
      if (!g) { const d = dropEntry(n.item, n.qty); if (d) return { ...base, ...d }; }
      if (g) return { ...base, kind: "gather", skillId: g.skill.id, actionId: g.a.id, label: `${nm(g.skill)}: gather ${nm(n.item)}` };
      const why = riskyFightNote(n.item, n.qty);
      return { ...base, qty: n.need ?? n.qty, kind: "manual", label: why ? `Fight ${why.name} for ${nm(n.item)}` : `Get ${nm(n.item)}`, note: why ? why.note : plain(sourceText(n.item.id)) };
    });
  // The best fight for a random drop isn't safe, so the queue can't run it. Say which fight it is and why, instead of a vague note.
  const riskyFightNote = (item, qty) => {
    if (!isFarmItem(item)) return null;
    const o = farmPlan(item, false, qty).opt;
    if (o?.type !== "fight" || o.safety.safe) return null;
    const kills = Math.ceil(qty / o.perKill);
    return { name: nm(o.m), note: `Kill ${nm(o.m)} until you own ${num(qty)} ${nm(item)} (about ${num(kills)} kills). The queue only runs fights that are safe while you're away, and this one isn't: ${o.safety.why}. Do it yourself, or fix that and add the step again.` };
  };
  // A random drop runs as an Action Queue gather step: study a constellation, train a skill that drops it, or fight a monster
  // that drops it (safe fights only). unitMs is the average time per item, so the queue's time estimate is right.
  const dropEntry = (item, qty) => {
    if (isAstroItem(item)) {
      const ch = conChoice(item);
      if (ch) return { kind: "gather", skillId: ASTRO_ID, actionId: ch.c.id, unitMs: ch.perHr > 0 ? 3600000 / ch.perHr : undefined, label: `${nm(astroSkill())}: study ${nm(ch.c)} for ${nm(item)}` };
    }
    if (!isFarmItem(item)) return null;
    const o = farmPlan(item, false, qty).opt, fid = o?.type === "fight" && st()?.fightId(o.m);
    if (o?.type === "skill") return { kind: "gather", skillId: o.skill.id, actionId: o.a.id, unitMs: o.perHr > 0 ? 3600000 / o.perHr : undefined, label: `${nm(o.skill)}: ${nm(o.a)} for ${nm(item)}` };
    if (fid && o.safety.safe) return { kind: "gather", skillId: HITPOINTS, actionId: fid, unitMs: isFinite(o.ms) ? o.ms / Math.max(1, qty) : undefined, label: `Fight ${nm(o.m)} for ${nm(item)}` };
    return null;
  };

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
          if (fs) {
            Farm.pick[fs.dataset.mbdFarm] = fs.value;
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

  // ---------- goal -> popup ----------
  const tellPlayer = (msg) => {
    try { notifyPlayer(game.township ?? game.attack, msg, "info"); } catch (e) { console.log("[Township Task Helper]", msg); }
  };
  // steps go into Action Queue; it skips any that are already queued and says so
  const dupHtml = (entries) => (entries?.length ? aq().queue.dupHtml(entries) : "");
  const queueSteps = (entries, top) => {
    const A = aq(), added = A.queue.add(entries, top, game.township);
    A.panel.open();
    if (added && A.settings.get("autoStart") && A.runner.state !== "running") A.runner.start();
  };
  // an XP task: Action Queue plans the fastest way there, gathering what the methods need, and re-plans as you level up
  const levelForXp = (xp) => { const at = st().skills.xpAt; let l = 1; while (l < 120 && at(l) < xp) l++; return l; };
  const xpEntry = (skill, target) => ({ kind: "train", xpGoal: true, skillId: skill.id, targetXp: target, targetLevel: levelForXp(target), qty: target, label: `${nm(skill)}: reach ${num(target)} XP` });
  const xpSection = (skill, target) => {
    const S = st(), now = skill.xp ?? 0, left = Math.max(0, target - now);
    let html = `<div class="mbd-step"><div class="mbd-title">${icon(skill)}<b>${esc(nm(skill))}</b></div><div class="mbd-chips">` +
      chip(`${num(Math.floor(now))} / ${num(target)} XP`) + (left > 0 ? chip(`${num(Math.ceil(left))} to go`) : chip('<i class="fa fa-check"></i> Done', "ok")) + `</div></div>`;
    if (left <= 0) return html;
    if (!S.skills.isTrainable(skill)) return html + `<div class="mbd-place">The queue can't train ${esc(nm(skill))} on its own.</div>`;
    const plan = S.plan.trainPlan(skill, levelForXp(target)), b = plan.batches[0];
    if (!b) {
      const first = S.plan.goalFirst(skill), why = S.plan.blockedWhy(skill);
      return html + (first ? `<div class="mbd-chips">${chip(esc(first), "ok")}</div>` : `<div class="mbd-place">${why ? `Nothing can be trained right now: ${esc(why)}.` : "Nothing found that the queue can train with your current levels."}</div>`);
    }
    const ms = Math.ceil(left / Math.max(1e-9, b.c.xpPer)) * b.c.ms;
    html += `<div class="mbd-step"><div class="mbd-stepno">Fastest method right now</div><div class="mbd-title">${icon(b.c.a)}<b>${esc(b.c.a.name)}</b></div>` +
      `<div class="mbd-chips">${chip(`Level ${b.c.a.level ?? 1}`)}${chip(`${num(Math.round(b.c.rate))} XP/hour`, "", "Counting the time to gather or make what it needs")}${chip(`About ${fmtDur(ms)}`, "ok", "Base speeds, gathering the materials included")}</div></div>`;
    return html + `<div class="mbd-note">Queued, it gathers what the method needs and picks a better method as you level up, until you reach ${num(target)} XP.</div>`;
  };

  const killEntry = (goal, total) => {
    const m = goal.monster;
    const need = total ? goal.quantity : Math.max(0, goal.quantity - (goal._progress ?? 0));
    if (total ? game.stats.monsterKillCount(m) >= goal.quantity : need <= 0) return [];
    const left = total ? goal.quantity - game.stats.monsterKillCount(m) : need;
    return [{ kind: "kill", monsterId: m.id, skillId: HITPOINTS, actionId: st().fightId(m) ?? `fight:none:${m.id}`, qty: left, label: `Defeat ${nm(m)}` }];
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
          return [xpEntry(goal.skill, goal.quantity)];
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
        Astro.pick = "best"; Farm.pick = {};
        const onQueue = info.queue && !info.blocked?.() ? (top) => queueSteps(info.queue(), top) : null;
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
    const missing = [!aq() && "Action Queue", !st() && "Skill Trainer"].filter(Boolean);
    if (missing.length) {
      const msg = `Township Task Helper needs the ${missing.join(" and ")} mod${missing.length > 1 ? "s" : ""}. Install ${missing.length > 1 ? "them" : "it"} from the Mod Manager, then reload the game.`;
      try { SwalLocale.fire({ title: "Township Task Helper", html: msg, icon: "warning" }); } catch (e) { console.warn("[Township Task Helper]", msg); }
      return;
    }
    injectStyle();
    const proto = customElements.get("township-task-goal").prototype;
    const orig = proto.__mbdOrig ?? proto.setGoal;
    proto.__mbdOrig = orig;
    proto.setGoal = function (goal) {
      orig.call(this, goal);
      try { decorate(this, goal); } catch (e) { console.warn("[Township Task Helper]", e); }
    };
    // the queue can use what this mod knows about random drops when a recipe step runs short
    st().addSource((item, qty) => dropEntry(item, qty));
    refresh();
    window.townshipHelper = {
      version: VERSION,
      showItem: (id, qty = 1) => {
        Astro.pick = "best"; Farm.pick = {};
        const it = itemById(id);
        const miss = itemMissing(it, qty);
        fire(`${qty} x ${esc(nm(it))}`, () => (itemMissing(it, qty).length ? missingHtml(itemMissing(it, qty)) : dupHtml(toEntries(buildRows(it, qty))) + itemSection(it, qty)), miss.length || !buildRows(it, qty).length ? null : (top) => queueSteps(toEntries(buildRows(it, qty)), top));
      },
      refresh,
      // internals for testing
      _dev: { itemMissing, areaMissing, buildRows, toEntries, itemSection, sourceHtml, describeGoal, killEntry, xpEntry, xpSection, dropEntry, farmPlan, farmSkills, farmFights, fightSafety, astroOptions, bestCon, isFarmItem, isAstroItem, fire },
    };
    LOG("installed", VERSION);
  };

  const ready = () =>
    typeof game !== "undefined" &&
    list(game?.township?.tasks?.tasks).length > 0 &&
    customElements.get("township-task-goal") &&
    typeof SwalLocale !== "undefined";

  // wait a moment past the game loading so Action Queue (a dependency) is set up first
  const go = () => setTimeout(install, 1500);
  if (ready()) go();
  else {
    const timer = setInterval(() => { if (ready()) { clearInterval(timer); go(); } }, 500);
  }
})();
}
