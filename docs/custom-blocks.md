# Your own blocks

Write blocks in TypeScript and use them in any tile like the built-in ones. They live in a folder on your computer, run as a plugin called **My blocks**, and reload when you save.

## Start

1. In Tessel, open **Plugins** and press **Create my blocks folder**. Tessel makes the folder, adds a few examples and asks once to let them run.
2. Press **Open folder** and open it in your editor (VS Code works well: it understands the types).
3. Press **New block**, or copy an example in `blocks/`. Save, and the block appears in the editor's palette under **Plugins**, as **My blocks › <name>**.

Nothing to build or install: Tessel runs the TypeScript as it is. Only use TypeScript that just adds types (no `enum`s or `namespace`s), which is what the examples do.

## The folder

```
my-blocks/
  blocks/            your blocks, one per file; the file name is the block's id
    _starter.ts      copied by New block (files starting with _ are skipped)
    after-december.ts
    ...
  tessel/            block() and the std library; Tessel refreshes these on updates
  index.ts           loads blocks/ (leave it as it is)
  manifest.json      the plugin's name, permissions and settings
  package.json       for npm packages
```

## A block

```ts
import { block } from '../tessel/index.ts'

export default block({
  name: 'Is it past a month?',
  description: "Goes out 'yes' from the chosen month on, otherwise 'no'.",
  params: {
    month: { type: 'number', label: 'Month (1-12)', default: 12, min: 1, max: 12 },
  },
  inputs: { date: 'string' },
  outputs: ['yes', 'no'],
  values: { monthName: 'string' },
  run({ params, inputs, std }) {
    const when = inputs.date ? std.date.parse(inputs.date) : std.date.now()
    const past = std.date.month(when) >= params.month
    return { next: past ? 'yes' : 'no', values: { monthName: std.date.monthName(when) } }
  },
})
```

| Field            | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `name`           | Shown in the palette and on the canvas.                                                                        |
| `params`         | Settings in the inspector. Types: `text`, `textarea`, `number` (`min`, `max`), `toggle`, `select` (`options`). |
| `inputs`         | Value inputs other blocks can wire into: `string`, `number`, `boolean` or `any`.                               |
| `outputs`        | Flow outputs to choose between. Leave out for a single `out`.                                                  |
| `values`         | Value outputs other blocks can read.                                                                           |
| `timeoutSeconds` | For slow work. Runs stop after 30 s unless you raise this (up to 600).                                         |
| `run`            | Does the work. Gets `params`, `inputs`, `ctx` and `std`.                                                       |

What `run` returns:

- nothing: carry on through the first output;
- a string, e.g. `'yes'`: carry on through that output;
- `{ next, values }`: choose an output and hand values to the blocks wired after it.

Throw an `Error` to fail the run; its message shows in the run log and on the phone.

### ctx

| Name                     | Use                                                                             |
| ------------------------ | ------------------------------------------------------------------------------- |
| `ctx.settings`           | Values from **Plugins › My blocks › Settings** (add fields in `manifest.json`). |
| `ctx.storage`            | `get`, `set`, `delete`: kept on disk between runs and restarts.                 |
| `ctx.setTileState(k, v)` | Sets `{{state.k}}` on the tile, so its live appearance can show it.             |
| `ctx.signal`             | Aborted when the tile stops. Pass it to `fetch` and `std.sleep`.                |
| `ctx.log`                | `info`, `warn`, `error`: written to Tessel's activity log.                      |
| `ctx.tileId`, `ctx.os`   | Which tile is running, and `darwin`, `win32` or `linux`.                        |

## std

| Group               | Functions                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `std.date`          | `now`, `parse`, `month` (1-12), `monthName`, `weekday`, `weekdayName`, `isWeekend`, `isAfter`, `isBefore`, `addDays`, `startOfDay`, `daysBetween`, `daysUntil`, `format(d, 'dddd D MMMM HH:mm')` |
| `std.text`          | `truncate`, `titleCase`, `slug`, `words`, `fill('Hi {name}', { name })`                                                                                                                          |
| `std.math`          | `clamp`, `round(n, digits)`, `lerp`, `map` (one range onto another), `random`, `randomInt`, `pick`, `sum`, `average`                                                                             |
| `std.http`          | `getText`, `getJson`, `postJson`; options `headers`, `signal`, `timeout`                                                                                                                         |
| `std.sleep`         | `sleep(ms, ctx.signal)`                                                                                                                                                                          |
| `std.parseJson`     | `parseJson(text, fallback)`                                                                                                                                                                      |
| `std.homeAssistant` | `homeAssistant({ url, token })` gives `state`, `states`, `call('light.turn_on', data)`, `toggle`, `turnOn`, `turnOff`                                                                            |

## zx

Tessel puts a copy of [zx](https://google.github.io/zx/) in the folder, so blocks can run commands without installing anything:

```ts
import { $ } from 'zx'
import { block } from '../tessel/index.ts'

export default block({
  name: 'Git branch',
  params: { folder: { type: 'text', label: 'Project folder', default: '.' } },
  values: { branch: 'string' },
  async run({ params, ctx }) {
    const { stdout } = await $({
      cwd: params.folder,
      signal: ctx.signal,
      quiet: true,
    })`git branch --show-current`
    return { values: { branch: stdout.trim() } }
  },
})
```

Pass `ctx.signal` so a stopped tile stops the command. For a quick script without writing a block, use the built-in **Run a zx script** block.

## Sharing

Tiles that use your blocks can be shared as a `.tel` file (right-click a tile, **Share as .tel…**). The file carries the code of the blocks they use; whoever opens it sees that it contains code and chooses whether to add it.

## Packages

Run `npm install <package>` (or pnpm, yarn) in the folder, then import it as usual:

```ts
import { block } from '../tessel/index.ts'
import slugify from 'slugify'
```

## Home Assistant

Put your Home Assistant address and a long-lived access token in **Plugins › My blocks › Settings** (create the token on your profile page in Home Assistant). Then:

```ts
const ha = std.homeAssistant({
  url: String(ctx.settings['haUrl']),
  token: String(ctx.settings['haToken']),
  signal: ctx.signal,
})
await ha.call('scene.turn_on', { entity_id: 'scene.movie_night' })
const { state, attributes } = await ha.state('sensor.living_room_temperature')
```

The separate **Home Assistant** plugin has ready-made blocks for the common cases (call a service, toggle, read a state, watch for changes) and uses the same client.

## Permissions

My blocks asks for network, files and programs, since it is your own code. Tessel runs it in its own process, so a mistake can't crash the app, but treat code you paste from elsewhere like any program you run.

## Trouble

- **The block doesn't appear.** Check the activity log on the Phones tab: a file with a syntax error, a missing package, or no `export default block(...)` is skipped, and the log says which file and why. The other blocks keep working.
- **"Unsupported TypeScript syntax".** Remove `enum`, `namespace` or constructor parameter properties; use plain objects and types instead.
- **Changes don't show.** Tessel reloads when files change; **Reload** on the Plugins tab forces it.
