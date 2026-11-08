// Picks one line at random from a list, e.g. what to have for lunch.
import { block } from '../tessel/index.ts'

export default block({
  name: 'Pick one',
  description: 'Chooses a random line from the list.',
  params: {
    choices: { type: 'textarea', label: 'Choices, one per line', default: 'Pizza\nSushi\nSalad' },
  },
  values: { choice: 'string' },
  run({ params, std }) {
    const lines = params.choices
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    return { values: { choice: std.math.pick(lines) ?? '' } }
  },
})
