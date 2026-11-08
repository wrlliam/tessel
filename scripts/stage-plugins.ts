// Copies each first-party plugin into build/plugins/<id> with real (not symlinked) runtime
// dependencies, so the packaged app can load them from its resources folder.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const out = join(root, 'build', 'plugins')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

for (const dir of await readdir(join(root, 'plugins'))) {
  const src = join(root, 'plugins', dir)
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8')) as { id: string }
  const pkg = JSON.parse(await readFile(join(src, 'package.json'), 'utf8')) as {
    name: string
    dependencies?: object
  }
  const target = join(out, manifest.id)
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
    // pnpm deploy writes the package with a flat, real node_modules of its production dependencies.
    execFileSync(
      'pnpm',
      [
        '--filter',
        pkg.name,
        'deploy',
        '--prod',
        '--legacy',
        '--config.node-linker=hoisted',
        target,
      ],
      { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
    )
  } else {
    await mkdir(target, { recursive: true })
  }
  await cp(join(src, 'manifest.json'), join(target, 'manifest.json'))
  await cp(join(src, 'dist'), join(target, 'dist'), { recursive: true })
  for (const extra of ['src', 'test', 'tsconfig.json'])
    await rm(join(target, extra), { recursive: true, force: true })
  console.log(`staged ${manifest.id}`)
}
