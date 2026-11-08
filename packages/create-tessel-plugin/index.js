#!/usr/bin/env node
// Scaffolds a Tessel plugin: `pnpm create tessel-plugin my-plugin` (or `pnpm create-plugin my-plugin` in the Tessel repo).
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoSdk = resolve(here, '../plugin-sdk')

export function pluginId(folder) {
  const id = basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (id.length < 2)
    throw new Error('Choose a folder name with at least two letters or numbers, like my-plugin')
  return id
}

const title = (id) =>
  id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

/** Writes a new plugin project into `dir`. Returns the list of files created. */
export async function scaffold(dir, { name, sdk } = {}) {
  const target = resolve(dir)
  if (existsSync(target) && (await readdir(target)).length > 0)
    throw new Error(`${target} already exists and isn't empty`)
  const id = pluginId(target)
  const displayName = name ?? title(id)
  // Inside the Tessel repo, link the local SDK; otherwise use the published one.
  const sdkVersion =
    sdk ??
    (existsSync(join(repoSdk, 'package.json')) ? `link:${relative(target, repoSdk)}` : '^0.1.0')

  const files = {
    'manifest.json': JSON.stringify(
      {
        id,
        name: displayName,
        version: '0.1.0',
        apiVersion: 1,
        description: 'Says hello, and starts tiles every few seconds.',
        main: 'dist/index.js',
        permissions: [],
        icon: 'zap',
        settingsSchema: {
          type: 'object',
          properties: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' } },
        },
      },
      null,
      2,
    ),
    'package.json': JSON.stringify(
      {
        name: id,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          build:
            'esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js',
          dev: 'esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/index.js --watch',
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
        },
        dependencies: { zod: '^4.0.0' },
        devDependencies: {
          '@tessel/plugin-sdk': sdkVersion,
          '@types/node': '^22.0.0',
          esbuild: '^0.28.0',
          typescript: '^6.0.0',
          vitest: '^5.0.0',
        },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          noEmit: true,
          types: ['node'],
        },
        include: ['src', 'test'],
      },
      null,
      2,
    ),
    '.gitignore': 'node_modules\ndist\n',
    'src/index.ts': `import { defineBlock, definePlugin, defineTrigger } from '@tessel/plugin-sdk'
import { z } from 'zod'

let greeting = 'Hello'

export default definePlugin({
  onLoad(ctx) {
    greeting = String(ctx.settings['greeting'] ?? 'Hello')
    ctx.log.info('${displayName} is ready')
  },
  onSettings(settings) {
    greeting = String(settings['greeting'] ?? 'Hello')
  },
  blocks: [
    defineBlock({
      id: 'hello',
      name: 'Say hello',
      description: 'Makes a greeting, ready to type or show on the tile.',
      inputs: [{ id: 'in', kind: 'flow' }],
      outputs: [
        { id: 'out', kind: 'flow' },
        { id: 'text', kind: 'value', type: 'string' },
      ],
      paramsSchema: z.object({ name: z.string().trim().min(1, 'Enter a name') }),
      fields: [{ key: 'name', label: 'Name', widget: 'text', placeholder: 'world' }],
      defaults: { name: 'world' },
      run(ctx, params) {
        const text = \`\${greeting}, \${params.name}!\`
        // Live appearance can show this with {{state.greeting}}.
        ctx.setTileState('greeting', text)
        return { values: { text } }
      },
    }),
  ],
  triggers: [
    defineTrigger({
      id: 'every',
      name: 'Every few seconds',
      description: 'Starts the tile on a timer while the profile is in use.',
      outputs: [{ id: 'count', kind: 'value', type: 'number' }],
      paramsSchema: z.object({ seconds: z.coerce.number().min(1).max(3600) }),
      fields: [{ key: 'seconds', label: 'Seconds', widget: 'number', placeholder: '10' }],
      defaults: { seconds: 10 },
      subscribe(_ctx, sub) {
        let count = 0
        const timer = setInterval(() => sub.emit({ count: ++count }), sub.params.seconds * 1000)
        return () => clearInterval(timer)
      },
    }),
  ],
})
`,
    'test/plugin.test.ts': `import { createHarness } from '@tessel/plugin-sdk/testing'
import { expect, it } from 'vitest'
import plugin from '../src/index.ts'

it('says hello', async () => {
  const h = createHarness(plugin, { settings: { greeting: 'Hi' } })
  await h.load()
  expect(await h.run('hello', { name: 'Tessel' })).toEqual({ values: { text: 'Hi, Tessel!' } })
  expect(h.tileState.get('greeting')).toBe('Hi, Tessel!')
})
`,
    'README.md': `# ${displayName}

A Tessel plugin with one block (Say hello) and one trigger (Every few seconds).

\`\`\`sh
pnpm install
pnpm build      # writes dist/index.js
pnpm test
\`\`\`

In Tessel, open **Plugins › Load for development…** and pick this folder. Run \`pnpm dev\` to rebuild on save; Tessel reloads the plugin when files change.

- \`manifest.json\` names the plugin, its permissions and its settings form.
- \`src/index.ts\` defines blocks and triggers with \`@tessel/plugin-sdk\`.
- Block ids become \`${id}.<block id>\` in Tessel.
`,
  }

  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(target, file)), { recursive: true })
    await writeFile(join(target, file), content.endsWith('\n') ? content : `${content}\n`)
  }
  return Object.keys(files)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const [dir, ...rest] = process.argv.slice(2)
  if (!dir || dir === '--help') {
    console.log('Usage: create-tessel-plugin <folder> [--name "My plugin"]')
    process.exit(dir ? 0 : 1)
  }
  const nameAt = rest.indexOf('--name')
  try {
    const files = await scaffold(dir, nameAt >= 0 ? { name: rest[nameAt + 1] } : {})
    console.log(
      `Created ${files.length} files in ${resolve(dir)}.\n\nNext:\n  cd ${dir}\n  pnpm install\n  pnpm build\n\nThen in Tessel: Plugins › Load for development…`,
    )
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
