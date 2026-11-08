import { Profile } from './model.ts'

/** Hard-coded starter profile used until the editor lands. */
export const sampleProfile: Profile = Profile.parse({
  id: 'default',
  name: 'Default',
  pages: [
    {
      id: 'home',
      name: 'Home',
      cols: 3,
      rows: 5,
      tiles: [
        { id: 'discord', label: 'Discord', colour: '#4FA3F7', position: { col: 0, row: 0 } },
        { id: 'browser', label: 'Browser', colour: '#22D3C5', position: { col: 1, row: 0 } },
        { id: 'mute', label: 'Mute mic', colour: '#F25C6E', position: { col: 2, row: 0 } },
        { id: 'play', label: 'Play/Pause', colour: '#8B7CF6', position: { col: 0, row: 1 } },
        { id: 'dark', label: 'Dark mode', colour: '#212833', position: { col: 1, row: 1 } },
        { id: 'email', label: 'Type email', colour: '#F5B63D', position: { col: 2, row: 1 } },
        {
          id: 'big',
          label: 'Focus',
          colour: '#FF7A59',
          position: { col: 0, row: 2 },
          span: { w: 2, h: 2 },
        },
        { id: 'lock', label: 'Lock', colour: '#161B22', position: { col: 2, row: 2 } },
      ],
    },
  ],
})
