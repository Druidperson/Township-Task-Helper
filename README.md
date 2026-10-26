# Township Helper

A mod for Melvor Idle that does two things:

1. Shows you how to get whatever a Township task asks for.
2. Gives you a saved activity queue, so the game can grind while you're away.

## Task breakdowns

Every item and monster requirement in the Township task list, including the daily tasks, gets a green play button. Click it and you get the whole recipe in order.

For example, 300 Bronze Arrows turns into: mine copper and tin, smelt the bars, smith the arrowtips, make the shafts and headless arrows, then craft the arrows.

For monsters, it shows where to find them and what gear you need to bring.

## Activity queue

Open the queue from the menu at the bottom right. From any breakdown you can add its steps to the queue, or add them to the top so they happen first.

- Start, Pause and Stop controls
- The queue works from top to bottom
- It pauses and tells you why if you run out of materials
- It waits on steps you have to do yourself (like getting an item from a monster)
- It's saved locally, one list per character

## Install

Subscribe to it on mod.io from the in-game Mod Manager (Browse tab).

To try it from source, zip `manifest.json` and `setup.mjs` (both at the root of the zip) and load it as a local mod in the Melvor Creator Toolkit.

https://mod.io/g/melvoridle/m/action-queue

## Known limits

- Tested with Woodcutting, Mining and Smithing. Cooking, Fishing, Crafting, Herblore and Runecrafting should work but haven't been tested much.
- The game has to stay open for the queue to run.
- If an item has several recipes, the breakdown shows the first one.

## Bugs and ideas

Open an issue. If it's a bug, say which task or item it happened on and what you expected.

## License

MIT, see [LICENSE](LICENSE).
