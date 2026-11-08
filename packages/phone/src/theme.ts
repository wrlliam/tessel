import type { PhoneSettings } from '@tessel/core'

/** Applies the theme chosen on the desktop. 'system' follows the phone. */
export function applyTheme(theme: PhoneSettings['theme']) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset['theme']
  else root.dataset['theme'] = theme
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0E1116' : '#F4F6F8')
}
