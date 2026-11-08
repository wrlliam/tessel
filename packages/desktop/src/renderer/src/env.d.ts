import type { TesselApi } from '../../shared/api.ts'

declare global {
  interface Window {
    tessel: TesselApi
  }
}

declare module '@tessel/brand/*.svg' {
  const url: string
  export default url
}
