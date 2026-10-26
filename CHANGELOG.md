# Changelog

## 0.13.5
- The automatic fight for dropped items is now the most efficient safe one, not just the one with the best drop rate. It weighs how long you take to kill the monster, how many kills the farm needs, and how much of your food it burns. A Slayer task monster gets a bonus because those kills count twice.
- Each fight in the picker shows about how long the farm takes, and the chosen fight shows kills, time and food.

## 0.13.4
- Fixed: the fight list showed "UNDEFINED TRANSLATION" twice, for the placeholder monsters in Into the Mist and the Lair of the Spider Queen. They stand in for random monsters and have no real stats, so they can't be judged safe or risky, and they are no longer offered. Anywhere else a nameless monster shows, it reads "Random monster in <area>".

## 0.13.3
- The fight picker for dropped items now shows each monster's combat level and lists them lowest level first, so it's easier to pick one that suits you. The chosen fight shows its combat level too.

## 0.13.2
- Fixed: a craft step that runs out of ingredients no longer stops the whole queue. Cooking burns some food, so 63 raw shrimp can give fewer than 63 cooked. The queue now works out how many are still missing, gathers or makes just that many ingredients again, and carries on. If it keeps running short without making any more, it stops with a note.

## 0.13.1
- Fixed: Township XP tasks no longer stop at "you don't have the materials". When the bank can't pay for the best method, the queue now adds the steps to get them first (mine the ore, chop the logs, smelt, craft) and then trains. It works a few levels at a time, so it keeps using your real level and bank.
- The XP task popup lists what it will gather first.

## 0.13.0
- New: items that only drop, like Bird Nest or Bones, now get a real plan instead of a "go get it yourself" step.
- If a skill drops the item while you train it (Bird Nest from Woodcutting), the queue does that skill with the best XP per hour you can use, and moves up as you level.
- If only monsters drop it, the queue fights the one with the best drop rate that is safe for you. Safe means two of its biggest hits can't kill you, and either it barely scratches you or your equipped food heals more than its average hit.
- Safe fights take auto eat into account. A fight is only safe if auto eat is on and starts at or above the monster's biggest hit, and the food it can use (after its efficiency) covers the whole farm. With auto eat off, food doesn't count, because nothing eats it while the queue runs. No food equipped always counts as risky.
- If every fight looks risky, the popup says why and asks you to tick a box before it queues the fight.
- The popup has a picker, so you can choose a specific tree, or a specific monster, instead of the automatic pick.
- If your active Slayer task is a monster that drops the item, it shows up in the list marked as your task, so the kills count twice.
- A fight step for an item runs until the item is in your bank, not for a fixed number of kills.

## 0.12.0
- New: Stardust and Golden Stardust tasks now send you to Astrology, where they drop while you study a constellation. Before, they only showed a wiki link.
- Astrology also levels other skills, so the popup asks which constellation to study. Pick one on purpose, or leave it on Best XP/hour. Each option shows the skills it boosts and its XP per hour.
- On Best XP/hour the queue switches to a better constellation by itself when you level up.
- The estimate uses the real drop chance, and Stardust is never auto-sold since you spend it on constellation upgrades.

## 0.11.1
- Fixed: pressing Stop while a manual step was waiting for you left it marked as waiting, so the next Start counted it as done. Stop now puts it back to pending.
- Fixed: the source and shop lookups no longer depend on another popup having been opened first.
- Adds a test suite (see the tests folder) and the hooks it needs.

## 0.11.0
- New: train a skill without a Township task. The new button next to the queue button (chart icon) opens a planner for Woodcutting, Mining, Fishing, Cooking, Smithing, Fletching, Runecrafting and the other skills the queue can run.
- Make an item: pick the item and an amount. The queue gathers and crafts everything it needs, using what is already in your bank, and makes the full amount even if you already own some.
- Train to a level: pick a target level and the queue trains until you get there. By default it uses the best method open to you, or you can choose one. Methods are ranked by XP per hour including the time it takes to gather their materials, so it won't farm a mountain of materials for little XP. It switches method only when a clearly better one opens up.
- The queue plans one batch at a time, so it always uses your real level and bank, and it stops each batch the moment you hit the level.
- Optional "Sell the items it makes" for level goals.
- Queue items for level goals show your level and what the queue is doing now.

## 0.10.1
- The wiki link now always opens in a new tab and never changes the game's own tab. If the browser blocks the new tab, the link is copied instead.

## 0.10.0
- The mod now checks the queue for duplicates. If steps from a task are already queued, the popup says so and lists them.
- Adding a task skips steps that are already in the queue and tells you which ones were skipped. If the whole task is already queued, nothing is added.

## 0.9.3
- When the mod can't find where an item comes from, the step now has a "Look it up on the Melvor wiki" link that searches https://wiki.melvoridle.com/ for the item. The same link is in the note on manual queue steps.

## 0.9.2
- XP tasks no longer suggest a method you can't actually feed. If the best XP per hour needs materials you can't get yet (the ore needs a Mining level you don't have, for example), it is skipped and the best method you can really do is picked. Materials count if they are in your bank or you have the levels to gather, craft, buy or farm them.

## 0.9.1
- The breakdown and the queue now count what's in your bank. Steps you already have enough for are skipped, and partly owned items only make the rest (250 air runes with 100 in the bank queues 150 rune essence and 150 crafts). If you already have everything, the popup says so.

## 0.9.0
- Auto-start is now a toggle in the Action Queue title bar, to the left of the title. Hover it to see "Auto-start: On" or "Off".
- If you don't meet the requirements for a task, the popup now shows warnings like "Warning: 88 Fletching required for Arrow Shafts" instead of the step list, and the queue buttons are hidden. This covers skill levels and monster area requirements such as Slayer level or a required item.
- Extras are sold automatically. If a step makes more than the task needs (100 arrowtips needed, crafted in batches of 15 so 105 made), the extra 5 are sold. It only sells what the queue itself made, never items you already owned. The queue row shows what was sold.
- New $ toggle in the title bar turns auto-sell on or off. It is also in the mod settings.

## 0.8.0
- Combat tasks can now be queued. The Action Queue starts the fight in the right combat area and counts kills. If the fight stops (you died or ran out of food), it pauses and tells you.
- Dungeon and stronghold monsters can't be started by the queue yet, so those pause with a message.
- Steps now show a warning when you don't have the level for them, in the task popup and in the queue.
- Steps for items sold in the shop (feathers for arrows, for example) get a Buy button that buys the exact amount needed.
- Random drops list the skill once (Woodcutting for bird nests) instead of every action in it.
- The three popup buttons are now the same height.
- "Weak to" now says what the weakness is based on (for example "Magic beats Melee").
- Fixed the small numbers in the defence bonus chips sitting a few pixels off.

## 0.7.1
- The buttons in the task popup sit closer together (about 5px apart) and stay centered.

## 0.7.0
- New setting: "Automatically start the Action Queue when adding a task" (On or Off). It is in the mod's settings, and there is also an Auto-start toggle at the bottom of the queue panel.
- Popup buttons now read Add to queue, Add to top, Close, with Close on the right.
- The queue header now says "N action(s) left".
- Popup headings are no longer in capitals, and "Where to find it" is now "Location:".
- Combat tasks show the enemy's attack styles, special attacks, passives, what it is weak to and its defence bonuses and resistances.
- Combat tasks have a Gear card: an equipment set switcher and a warning if you have no food equipped, otherwise your food and how much is left.

## 0.6.0
- Action Queue: Start, Pause, Stop and the clear buttons now sit centered at the bottom of the panel.
- "Clear Done" is now "Clear Queue".
- The panel can be dragged anywhere on the screen by its title bar, and it remembers where you put it.
- The status line is now a progress bar with an estimated time left and a rough finish time.
- Popups got a full visual pass: step cards, chips for levels, quantities and sources, item and skill icons.
- Monsters show Combat Level, a hitpoints icon with the real HP, and the attack type with its icon.
- Fixed monster HP: it was showing the Hitpoints level instead of the actual HP.

## 0.5.0
- The queue is now called Action Queue.
- Clear Done and Clear All are real buttons, like Start, Pause and Stop.
- New "Do this first" button on each queue row. It runs that entry now without moving it in the list. When it's done, the queue carries on from the top.
- Popup: text is centered, and the Add to queue (green) and Add to top (amber) buttons match the Close button's size and sit evenly spaced next to it.

## 0.4.0
- Skill XP tasks ("Earn 5,000 Woodcutting XP" and the like) now have a green play button too.
- The popup shows the fastest XP method you can use right now, its XP per hour, and a rough time to finish.
- Adding it to the queue picks that method for you, and picks again when you level up or run out of materials.
- Works for Woodcutting, Fishing, Mining, Firemaking, Cooking and Smithing. Cooking, Firemaking and Smithing need the materials in your bank.
- Firemaking can now be started by the queue.

## 0.3.2
- The button next to each task requirement is now a green play button.
- "Add to queue" and "Add to top" in the breakdown window use the same green style.

## 0.3.0
- Queue controls: Start, Pause, Stop, and Add to top.
- The queue now runs from top to bottom.
- The queue menu button matches the size of the other menu buttons.
- The task button is centered in the task row.

## 0.2.0
- Activity queue panel in the bottom-right menu.

## 0.1.0
- Task breakdowns for item and monster requirements, including daily tasks.
