// Chooses a path: flows out of 'yes' from December on, 'no' before it.
// Change the month in the inspector, or wire a date into "date" to check that instead of today.
import { block } from '../tessel/index.ts'

export default block({
  name: 'Is it past a month?',
  description: "Goes out 'yes' when the date is in or after the chosen month, otherwise 'no'.",
  params: {
    month: { type: 'number', label: 'Month (1-12)', default: 12, min: 1, max: 12 },
  },
  inputs: { date: 'string' },
  outputs: ['yes', 'no'],
  values: { monthName: 'string' },
  run({ params, inputs, std }) {
    const when = inputs.date ? std.date.parse(inputs.date) : std.date.now()
    const past = std.date.month(when) >= params.month
    // Pick the way out with next, and hand on values by name alongside it.
    return { next: past ? 'yes' : 'no', monthName: std.date.monthName(when) }
  },
})
