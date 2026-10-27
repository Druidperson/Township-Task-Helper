# Tests

The suite runs inside Melvor Idle, against the real game, so it catches both bugs in the mod and things a game update moved.

## Run it

1. Open the game, load a character (a test save is best), and keep the tab in front.
2. Open the browser console (F12) and paste the contents of `township-task-helper.tests.js`, or load it straight from GitHub:

```js
(0,eval)(await fetch("https://raw.githubusercontent.com/Druidperson/Township-Task-Helper/main/tests/township-task-helper.tests.js").then(r => r.text()));
await TTHTests.run();
```

The result is a summary line, a table of anything that failed or was skipped, and a returned object with every result.

| Option | What it does |
| --- | --- |
| `TTHTests.run({ live: false })` | Skips the tests that start real game actions (chopping, fighting). |
| `TTHTests.run({ group: "Queue" })` | One group only. |
| `TTHTests.run({ only: /duplicate/i })` | Tests whose name matches. |

`TTHTests.tests` lists every test name.

## What it covers

| Group | What is checked |
| --- | --- |
| Game contract | The game objects and methods the mod depends on, the XP table, recipe data, and the task goal types. Start here after a game update. |
| Install | Version, minibar buttons, play buttons on task goals, the panel opening and closing. |
| Task breakdown | Every task in the game builds a popup and queue entries, recipe chains, bank subtraction, level warnings, the shop Buy button, source lookups for every item, the wiki link and its new-tab behaviour, popup button order. |
| Monster info | Location, attack styles and weaknesses for every monster, equipment set buttons, kill goals. |
| Queue | Add, remove, move, move to top, insert, clear, saving per character, status reset on load, the badge. |
| Duplicates | Skipping repeated steps, the notice, the popup warning. |
| Auto-sell | Selling only the extra, locked items, the setting, "sell what I make". |
| Settings | Auto-start and auto-sell, and the panel toggles. |
| Panel | A row for every kind of step, the empty state, time estimates. |
| Runner | Idle on an empty queue, manual steps, blocked steps, Stop, monsters outside normal areas. |
| Live actions | Gathering to completion, XP goals, pause and resume, "do this first", starting a fight, auto-start. These start real actions for a few seconds. |
| XP planner | Methods sorted best first and open at your level. |
| Train a skill | The planner behind XP tasks: plans are contiguous and reach the target, the chosen method is never much slower than the best one, batches become real steps, the bank is used first, estimates. |

## Safety

Each test backs up and restores the queue, settings, and anything it stubs (bank lookups, selling, buying, notices). Selling and buying are stubbed, so nothing is sold or bought. The live tests chop a few logs and gain a little XP.

## Notes

- Some tests skip themselves when your save doesn't allow them, for example when you are above every recipe level. The reason is shown in the table.
- Hidden or background tabs pause the game. The live tests skip, and the rest run slowly.
- "Task goal types without a play button" at the end lists goal types the mod doesn't handle. A new name there after a game update may be worth a look.
- When you add a feature, add a test for it in the matching group.
