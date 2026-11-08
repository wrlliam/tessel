// Days until a date, as a number and as words, e.g. for a tile label "12 days to go".
import { block } from '../tessel/index.ts'

export default block({
  name: 'Days until',
  description: 'How many days until a date, e.g. 2026-12-25.',
  params: {
    date: { type: 'text', label: 'Date', default: '2026-12-25', placeholder: 'YYYY-MM-DD' },
  },
  values: { days: 'number', words: 'string' },
  run({ params, std }) {
    const days = std.date.daysUntil(params.date)
    const words =
      days > 1
        ? `${days} days to go`
        : days === 1
          ? 'Tomorrow'
          : days === 0
            ? 'Today'
            : `${-days} days ago`
    // Several values at once: return them by name.
    return { days, words }
  },
})
