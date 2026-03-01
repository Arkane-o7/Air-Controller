import type { AirControllerBridgeApi } from '../../shared/protocol'

declare global {
  interface Window {
    aircontroller: AirControllerBridgeApi
  }
}

export {}
