// Uploads the installers in bin/ to a draft GitHub release for the desktop app's version.
// Usage: pnpm release            (creates or updates draft v<version>)
//        pnpm release --publish  (also publishes it)
// Needs the GitHub CLI, signed in: `gh auth login`.
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const bin = join(root, 'bin')
const { version } = JSON.parse(
  await readFile(join(root, 'packages', 'desktop', 'package.json'), 'utf8'),
) as { version: string }
const tag = `v${version}`
const publish = process.argv.includes('--publish')

// Installers, plus the files installed copies read to update themselves.
const installers = /\.(dmg|exe|AppImage|deb|zip|blockmap)$/
const updateInfo = /^latest(-mac|-linux)?\.yml$/
const files = (await readdir(bin).catch(() => []))
  .filter((f) => (installers.test(f) && f.includes(version)) || updateInfo.test(f))
  .map((f) => join(bin, f))
if (files.length === 0) {
  console.error(`No installers for ${version} in bin/. Run \`pnpm package:mac-win\` first.`)
  process.exit(1)
}

const NOTES = `## Download

- **macOS** (Apple silicon and Intel): \`Tessel-${version}-universal.dmg\`
- **Windows** (x64): \`Tessel-Setup-${version}.exe\`

These builds aren't signed yet. On macOS, right-click Tessel, choose Open, then Open again. On Windows, choose More info, then Run anyway.
`

const gh = (args: string[]) =>
  execFileSync('gh', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
const exists = (() => {
  try {
    execFileSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

if (exists) {
  // Replaces assets with the same name, so re-running after a rebuild is safe.
  gh(['release', 'upload', tag, ...files, '--clobber'])
} else {
  gh([
    'release',
    'create',
    tag,
    ...files,
    '--draft',
    '--target',
    'main',
    '--title',
    `Tessel ${version}`,
    '--notes',
    NOTES,
    '--generate-notes',
  ])
}
if (publish) gh(['release', 'edit', tag, '--draft=false'])
console.log(`${publish ? 'Published' : 'Draft'} ${tag} with ${files.length} file(s).`)
