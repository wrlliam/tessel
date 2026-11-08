import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.tessel.shell',
  appName: 'Tessel',
  webDir: 'dist',
  backgroundColor: '#0E1116',
  ios: {
    contentInset: 'never',
    // The phone client sets its own zoom and gestures.
    scrollEnabled: false,
  },
  server: {
    // The app opens Tessel's phone page from the computer on your network.
    allowNavigation: ['*'],
  },
  plugins: {
    // Don't patch fetch; the start screen calls CapacitorHttp directly to check a computer without CORS.
    CapacitorHttp: { enabled: false },
  },
}

export default config
