// The My blocks folder's starting files, bundled into the app as text.
import tesselIndex from '@tessel/plugin-sdk/custom/index.ts?raw'
import tesselStd from '@tessel/plugin-sdk/custom/std.ts?raw'
import afterDecember from '@tessel/plugin-sdk/custom/scaffold/blocks/after-december.ts?raw'
import countdownTo from '@tessel/plugin-sdk/custom/scaffold/blocks/countdown-to.ts?raw'
import homeAssistantToggle from '@tessel/plugin-sdk/custom/scaffold/blocks/home-assistant-toggle.ts?raw'
import pickOne from '@tessel/plugin-sdk/custom/scaffold/blocks/pick-one.ts?raw'
import webJson from '@tessel/plugin-sdk/custom/scaffold/blocks/web-json.ts?raw'
import gitBranch from '@tessel/plugin-sdk/custom/scaffold/blocks/git-branch.ts?raw'
import starter from '@tessel/plugin-sdk/custom/scaffold/blocks/_starter.ts?raw'
import entry from '@tessel/plugin-sdk/custom/scaffold/index.ts?raw'
import manifest from '@tessel/plugin-sdk/custom/scaffold/manifest.json?raw'
import pkg from '@tessel/plugin-sdk/custom/scaffold/package.json?raw'
import readme from '@tessel/plugin-sdk/custom/scaffold/README.md?raw'
import tsconfig from '@tessel/plugin-sdk/custom/scaffold/tsconfig.json?raw'
import type { BlockFiles } from './custom-blocks.ts'

export const STARTER = starter

export const MY_BLOCKS_FILES: BlockFiles = {
  'tessel/index.ts': tesselIndex,
  'tessel/std.ts': tesselStd,
  'index.ts': entry,
  'manifest.json': manifest,
  'package.json': pkg,
  'tsconfig.json': tsconfig,
  'README.md': readme,
  'blocks/_starter.ts': starter,
  'blocks/after-december.ts': afterDecember,
  'blocks/countdown-to.ts': countdownTo,
  'blocks/pick-one.ts': pickOne,
  'blocks/web-json.ts': webJson,
  'blocks/home-assistant-toggle.ts': homeAssistantToggle,
  'blocks/git-branch.ts': gitBranch,
}
