// Uses Tessel's own blocks and this folder's blocks as functions:
// std.blocks.* are Tessel's blocks (and installed plugins'), std.my.* are the blocks in this folder.
// Their names and settings are filled in each time My blocks loads, so your editor can suggest them.
import { block } from '../tessel/index.ts'

export default block({
  name: 'Pick lunch and pop it up',
  description: 'Picks a lunch with Pick one, flips a Toggle, and shows the choice in a pop-up.',
  params: {
    choices: { type: 'textarea', label: 'Choices, one per line', default: 'Pizza\nSushi\nSalad' },
  },
  values: { choice: 'string' },
  async run({ params, std }) {
    const { choice = '' } = await std.my.pickOne({ choices: params.choices })
    const { next } = await std.blocks.toggle({ key: 'askedToday' })
    await std.blocks.popup({
      title: next === 'on' ? 'Lunch idea' : 'Another idea',
      body: String(choice),
      seconds: 4,
    })
    return { choice: String(choice) }
  },
})
