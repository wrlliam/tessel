// Loads every block in blocks/. You don't need to change this file.
import { loadBlocks } from './tessel/index.ts'

export default await loadBlocks(new URL('./blocks/', import.meta.url))
