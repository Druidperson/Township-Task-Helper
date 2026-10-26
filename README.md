# Township Helper

A mod for Melvor Idle that does two things:

1. Shows you how to get whatever a Township task asks for.
2. Gives you a saved action queue, so the game can grind while you're away.

## Task breakdowns

Every item and monster requirement in the Township task list, including the daily tasks, gets a green play button. Click it and you get the whole recipe in order.

For example, 300 Bronze Arrows turns into: mine copper and tin, smelt the bars, smith the arrowtips, make the shafts and headless arrows, then craft the arrows.

For monsters, it shows where to find them and what gear you need to bring.

For skill XP tasks, it shows the fastest XP method you can use at your current level and about how long it'll take. Queue it and the mod picks that method for you, and switches to a better one when you level up.

## Action Queue

Open the queue from the menu at the bottom right. From any breakdown you can add its steps to the queue, or add them to the top so they happen first.

- Start, Pause and Stop controls
- Combat tasks show the enemy's attack styles and weaknesses, your food, and an equipment set switcher
- Combat tasks can be queued too: it fights the monster and counts the kills
- Warnings when you're missing a level, and a Buy button for shop items
- A setting to start the queue automatically when you add a task
- Drag the panel anywhere, and a progress bar shows the estimated time left
- A "Do this first" button on each row runs that entry now without moving it in the list
- The queue works from top to bottom
- It pauses and tells you why if you run out of materials
- It waits on steps you have to do yourself (like getting an item from a monster)
- It's saved locally, one list per character

## Install

Subscribe to it on mod.io from the in-game Mod Manager (Browse tab).

To try it from source, zip `manifest.json` and `setup.mjs` (both at the root of the zip) and load it as a local mod in the Melvor Creator Toolkit.

https://mod.io/g/melvoridle/m/action-queue

## Known limits

- XP ranking uses base XP per hour only. Mastery and other bonuses aren't counted.
- Tested with Woodcutting, Mining, Smithing and Firemaking. Cooking, Fishing, Crafting, Herblore and Runecrafting should work but haven't been tested much.
- The game has to stay open for the queue to run.
- If an item has several recipes, the breakdown shows the first one.

## Bugs and ideas

Open an issue. If it's a bug, say which task or item it happened on and what you expected.

## License

MIT, see [LICENSE](LICENSE).
