import { BlockRegistry } from '../block.ts'
import { actionBlocks } from './actions.ts'
import { dataBlocks } from './data.ts'
import { liveBlocks } from './live.ts'
import { logicBlocks } from './logic.ts'
import { triggerBlocks } from './triggers.ts'

export const builtinBlocks = [
  ...triggerBlocks,
  ...actionBlocks,
  ...logicBlocks,
  ...dataBlocks,
  ...liveBlocks,
]

export const createRegistry = () => new BlockRegistry(builtinBlocks)

export { checkCondition, Condition } from './logic.ts'
export { cronError, nextRuns, slideValue } from './triggers.ts'
export { describeWeather, formatDuration } from './live.ts'
