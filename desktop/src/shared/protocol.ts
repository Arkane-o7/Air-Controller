export const AIRCONTROLLER_PORT = 8765
export const AIRCONTROLLER_MAX_CONTROLLERS = 4

export type LayoutType = 'xbox' | 'simple' | 'custom'

export type PairMessage = {
  type: 'pair'
  code: string
}

export type ButtonMessage = {
  type: 'button'
  button: string
  state: 'pressed' | 'released'
}

export type StickMessage = {
  type: 'stick'
  stick: 'left' | 'right'
  x: number
  y: number
}

export type TriggerMessage = {
  type: 'trigger'
  trigger: 'left' | 'right'
  value: number
}

export type DpadMessage = {
  type: 'dpad'
  direction: 'up' | 'down' | 'left' | 'right' | 'none'
}

export type PingMessage = {
  type: 'ping'
}

export type PongMessage = {
  type: 'pong'
}

export type ClientInboundMessage =
  | PairMessage
  | ButtonMessage
  | StickMessage
  | TriggerMessage
  | DpadMessage
  | PingMessage
  | PongMessage

export type WelcomeMessage = {
  type: 'welcome'
  controllerId: number
  layout: LayoutType
}

export type RejectMessage = {
  type: 'reject'
  reason: 'invalid_code' | 'server_full' | 'already_connected'
}

export type LayoutChangeMessage = {
  type: 'layout_change'
  layout: LayoutType
}

export type HostOutboundMessage = WelcomeMessage | RejectMessage | LayoutChangeMessage | PingMessage | PongMessage

export type HostController = {
  controllerId: number
  connectedAt: number
  lastSeenAt: number
  inputCount: number
  remoteAddress: string
}

export type HostEvent = {
  at: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export type SetupCheck = {
  id: string
  label: string
  ok: boolean
  required: boolean
  details: string
}

export type HostState = {
  running: boolean
  port: number
  ip: string
  pairingCode: string
  deepLink: string
  qrDataUrl: string
  layout: LayoutType
  virtualGamepad: {
    enabled: boolean
    backend: 'vigem' | 'none'
    message: string
  }
  setupChecks: SetupCheck[]
  controllers: HostController[]
  events: HostEvent[]
}

export type AirControllerBridgeApi = {
  getState: () => Promise<HostState>
  regenerateCode: () => Promise<HostState>
  setLayout: (layout: LayoutType) => Promise<HostState>
  onState: (listener: (state: HostState) => void) => () => void
}

export type HostEventPayload = {
  kind: 'state'
  state: HostState
}

export function parseClientInboundMessage(raw: string): ClientInboundMessage | null {
  try {
    const value = JSON.parse(raw) as { type?: string }
    if (!value || typeof value.type !== 'string') return null
    return value as ClientInboundMessage
  } catch {
    return null
  }
}

export function toJson(message: HostOutboundMessage): string {
  return JSON.stringify(message)
}
