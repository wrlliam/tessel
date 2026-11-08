// Runs commands with zx, which Tessel puts in this folder for you: $`...` runs a command.
// Shows which git branch a project is on, e.g. as a tile label.
import { $ } from 'zx'
import { block } from '../tessel/index.ts'

export default block({
  name: 'Git branch',
  description: 'The current git branch of a folder, using zx to run git.',
  params: {
    folder: {
      type: 'text',
      label: 'Project folder',
      default: '.',
      placeholder: '/Users/me/code/app',
    },
  },
  values: { branch: 'string' },
  async run({ params, ctx }) {
    const { stdout } = await $({
      cwd: params.folder,
      signal: ctx.signal,
      quiet: true,
    })`git branch --show-current`
    const branch = stdout.trim()
    ctx.setTileState('branch', branch)
    return { values: { branch } }
  },
})
