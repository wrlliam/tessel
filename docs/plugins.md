# Writing Tessel plugins

A plugin adds blocks and triggers to the editor. It runs in its own process, talks to Tessel over messages, and can crash without taking Tessel down (Tessel restarts it with backoff, then gives up after repeated crashes).

## Start a plugin

```sh
pnpm create-plugin my-plugin      # inside the Tessel repo
pnpm create tessel-plugin my-plugin   # once create-tessel-plugin is published to npm
cd my-plugin && pnpm install && pnpm build
```

In Tessel, open **Plugins › Load for development…** and pick the folder. Run `pnpm dev` to rebuild on save; Tessel reloads development plugins when their files change.

## Layout

```
my-plugin/
  manifest.json     name, version, permissions, settings form
  src/index.ts      definePlugin({ blocks, triggers, onLoad, onUnload, onSettings })
  dist/index.js     what Tessel runs (the build output named by "main")
```

### manifest.json

| Field                                              |                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                               | Lowercase letters, numbers and dashes. Block ids become `<id>.<block id>`.                                                                                                                                        |
| `name`, `version`, `description`, `author`, `icon` | Shown in the Plugins tab. `icon` is a tile icon name or one emoji.                                                                                                                                                |
| `apiVersion`                                       | `1`                                                                                                                                                                                                               |
| `main`                                             | Built ES module inside the folder, e.g. `dist/index.js`. Its default export is the plugin.                                                                                                                        |
| `platforms`                                        | Optional: `darwin`, `win32`, `linux`. Shown to the user; the plugin still loads elsewhere, so make its blocks say what's wrong.                                                                                   |
| `permissions`                                      | `shell`, `network`, `filesystem`, `input`, `native`. Shown before the plugin may start.                                                                                                                           |
| `settingsSchema`                                   | `{ "type": "object", "properties": { key: { "type": "string" \| "number" \| "boolean", "title", "description", "default", "enum", "minimum", "maximum", "secret" } } }`. Tessel builds the settings form from it. |

## SDK

```ts
import { defineBlock, definePlugin, defineTrigger, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export default definePlugin({
  onLoad(ctx) {}, // ctx: pluginId, os, settings, log, storage
  onSettings(settings) {},
  onUnload() {},
  blocks: [
    defineBlock({
      id: 'hello',
      name: 'Say hello',
      description: '…',
      inputs: [{ id: 'in', kind: 'flow' }],
      outputs: [
        { id: 'out', kind: 'flow' },
        { id: 'text', kind: 'value', type: 'string' },
      ],
      paramsSchema: z.object({ name: z.string() }),
      fields: [{ key: 'name', label: 'Name', widget: 'text' }],
      defaults: { name: 'world' },
      run(ctx, params, input) {
        ctx.setTileState('greeting', 'hi') // {{state.greeting}} in live appearance
        return { values: { text: `Hi ${params.name}` } }
      },
    }),
  ],
  triggers: [
    defineTrigger({
      id: 'every',
      name: 'Every few seconds',
      description: '…',
      outputs: [{ id: 'count', kind: 'value', type: 'number' }],
      paramsSchema: z.object({ seconds: z.coerce.number() }),
      subscribe(ctx, sub) {
        const t = setInterval(() => sub.emit({ count: 1 }), sub.params.seconds * 1000)
        return () => clearInterval(t)
      },
    }),
  ],
})
```

- **Blocks** work like built-in ones: flow and typed value ports, a form (`fields`), and `run`. Params are checked with your `paramsSchema` before `run`; the first issue is shown to the user. `ctx.signal` aborts when the tile is stopped or times out. Throw `PluginError` (or any `Error`) with a message written for the person pressing the tile.
- **Triggers** are told about each trigger block placed on a tile of the profile phones are using (`subscribe`), and stop watching when it goes away (the function you return). Call `sub.emit(values)` to start the tile; `values` appear on the trigger's value outputs and as `{{trigger.<name>}}`. `sub.setTileState` updates the tile between runs, which is how a status tile stays current.
- **Storage:** `ctx.storage.get/set/delete` keeps small JSON values (up to 1 MB per plugin) in Tessel's data folder.
- **Logging:** `ctx.log.info/warn/error` goes to Tessel's activity log, prefixed with the plugin name.

## Testing

```ts
import { createHarness } from '@tessel/plugin-sdk/testing'
const h = createHarness(plugin, { os: 'win32', settings: {} })
await h.load()
await h.run('hello', { name: 'Tessel' }) // returns { values, next }
const sub = h.subscribe('every', { seconds: 1 }) // sub.events collects emits
```

The harness runs blocks and triggers in your test process, with in-memory storage and tile state. Nothing needs Tessel running.

## How it runs

Tessel starts each enabled plugin with Electron's `utilityProcess` (Node's `fork` in tests), passing the plugin folder to a small runner from the SDK. Messages are JSON-RPC style (`packages/plugin-sdk/src/protocol.ts`): Tessel sends `init`, `describe`, `run`, `cancel`, `subscribe`, `settings` and `shutdown`; the plugin sends `storage.*` requests and `log`, `event` and `tileState` notifications. Calls time out after 10 s, except block runs, which follow the tile's own 30 s limit.

## Trust

Permissions are what a plugin declares. Tessel shows them, and asks, before an installed or development plugin starts, but plugin processes run with your account's rights and are not sandboxed. Install only plugins you trust. Phones have no way to install, enable or configure plugins.
