# Township Helper

A Melvor Idle mod for the Township task list. Every task requirement gets a green play button. Click it and the mod lays out what you need to do to finish that task. You can then send those steps to a queue that does them for you, which is handy for leaving the game running overnight.

## The play button

**Items.** You get the whole chain in order, from raw materials to the finished item. The mod looks at your bank first, so steps you already have enough for are left out, and partly owned items only count what you're missing. Each step says where the item comes from. When something can be bought in the shop (feathers for arrows, say), there's a button that buys exactly the amount you need. If the mod can't find a source in the game data, it links you to the Melvor wiki.

If you don't meet a requirement yet, you get a warning instead of the steps, like "Warning: 88 Fletching required for Arrow Shafts". This covers skill levels and monster area requirements such as Slayer level or a required item.

**Monsters.** The window shows combat level, hitpoints, attack styles, special attacks, passives, weaknesses, defence bonuses, resistances and where to find the monster. It also shows what food you have equipped (or warns you if there's none) and has buttons to switch equipment sets, so you can gear up before the fight.

**Skill XP.** It shows the fastest method you can use right now, roughly how long it will take, and the next best options. A method only counts if you can get its materials with your current levels, so it won't suggest Fletching with logs you have no way to cut.

## Action queue

Open it from the menu at the bottom right. Every breakdown has an Add to queue button and an Add to top button. The queue works from the top down and can run gathering, crafting, XP goals and combat tasks. Combat tasks fight the monster in the right area and count kills.

Some things it does along the way:

- Start, Pause and Stop buttons, plus a "Do this first" button on each row that runs that step now without moving it in the list.
- A progress bar with an estimated time left and a rough finish time.
- If a step can't continue (you ran out of materials, or you died), the queue pauses and tells you why.
- Steps you have to do yourself, like getting a drop from a monster, make the queue wait for you.
- If a task is already in the queue, the popup tells you and the duplicate steps are skipped.
- If a step makes more than the task needs, such as arrowtips crafted in batches of 15, the extras are sold. It only sells what the queue made, never items you already had.
- The panel can be dragged anywhere and remembers its spot. Each character keeps its own saved queue.

Two toggles sit in the title bar. The switch on the left is auto-start, which starts the queue as soon as you add something. The dollar sign turns auto-selling on or off. Hover over either one to see its state. Both are also in the mod settings.

## Install

Subscribe on mod.io from the in-game Mod Manager (Browse tab): https://mod.io/g/melvoridle/m/action-queue

To try it from source, zip `manifest.json` and `setup.mjs` (both at the top level of the zip) and load it as a local mod with the Melvor Creator Toolkit.

## Known limits

- The XP ranking uses base XP per hour. Mastery and other bonuses aren't counted.
- The queue can't start fights in dungeons or strongholds. It pauses on those and asks you to fight them yourself.
- For XP goals, the queue doesn't gather materials first. If you don't have them in your bank when it reaches that step, it pauses.
- When an item has several recipes, the breakdown uses the first one.
- The game has to stay open for the queue to run. A hidden browser tab slows the game down.
- Tested the most with Woodcutting, Mining, Smithing, Firemaking and low-level combat. Cooking, Fishing, Crafting, Herblore and Runecrafting should work but haven't had much testing.

## Bugs and ideas

Open an issue. For a bug, say which task or item it happened on and what you expected to see.

## License

MIT, see [LICENSE](LICENSE).
