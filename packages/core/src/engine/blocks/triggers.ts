import { z } from 'zod'
import { defineBlock, flowOut } from '../block.ts'

export const onPress = defineBlock({
  id: 'trigger.press',
  category: 'trigger',
  name: 'On press',
  description: 'Starts when the tile is tapped.',
  trigger: 'press',
  inputs: [],
  outputs: [flowOut],
  paramsSchema: z.object({}),
  run: () => {},
})

export const triggerBlocks = [onPress]
