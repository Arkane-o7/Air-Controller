import { createRequire } from 'node:module'

import type { ButtonMessage, ClientInboundMessage, DpadMessage, StickMessage, TriggerMessage } from '../shared/protocol'

type AxisName = 'leftX' | 'leftY' | 'rightX' | 'rightY' | 'leftTrigger' | 'rightTrigger' | 'dpadHorz' | 'dpadVert'
type ButtonName =
  | 'START'
  | 'BACK'
  | 'LEFT_THUMB'
  | 'RIGHT_THUMB'
  | 'LEFT_SHOULDER'
  | 'RIGHT_SHOULDER'
  | 'GUIDE'
  | 'A'
  | 'B'
  | 'X'
  | 'Y'

type InputAxis = { setValue: (value: number) => unknown }
type InputButton = { setValue: (value: boolean) => unknown }

type X360ControllerLike = {
  updateMode: 'auto' | 'manual'
  connect: () => Error | null
  disconnect: () => Error | null
  update: () => Error | null
  resetInputs: () => void
  axis: Record<AxisName, InputAxis>
  button: Record<ButtonName, InputButton>
}

type VigemClientLike = {
  connect: () => Error | null
  createX360Controller: () => X360ControllerLike
}

type BridgeStatus = {
  enabled: boolean
  backend: 'vigem' | 'none'
  message: string
}

export class VigemBridge {
  private readonly slots = new Map<number, X360ControllerLike>()
  private readonly client: VigemClientLike | null
  private readonly statusValue: BridgeStatus

  constructor() {
    if (process.platform !== 'win32') {
      this.client = null
      this.statusValue = {
        enabled: false,
        backend: 'none',
        message: 'Virtual gamepad passthrough is only active on Windows (ViGEm).'
      }
      return
    }

    try {
      const require = createRequire(import.meta.url)
      const vigemPackage = require('vigemclient') as { ViGEmClient?: new () => VigemClientLike } | (new () => VigemClientLike)
      const ViGEmClientCtor =
        typeof vigemPackage === 'function'
          ? vigemPackage
          : (vigemPackage.ViGEmClient as (new () => VigemClientLike) | undefined)

      if (!ViGEmClientCtor) {
        this.client = null
        this.statusValue = {
          enabled: false,
          backend: 'none',
          message: 'vigemclient module found, but ViGEmClient export is missing.'
        }
        return
      }

      const client: VigemClientLike = new ViGEmClientCtor()
      const connectErr = client.connect()
      if (connectErr) {
        this.client = null
        this.statusValue = {
          enabled: false,
          backend: 'none',
          message: `ViGEm bus connection failed: ${connectErr.message}`
        }
        return
      }

      this.client = client
      this.statusValue = {
        enabled: true,
        backend: 'vigem',
        message: 'ViGEm virtual Xbox controller bridge enabled.'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      this.client = null
      this.statusValue = {
        enabled: false,
        backend: 'none',
        message: `ViGEm unavailable: ${message}`
      }
    }
  }

  getStatus(): BridgeStatus {
    return this.statusValue
  }

  attachController(slot: number): { ok: boolean; message?: string } {
    if (!this.client) {
      return { ok: false, message: this.statusValue.message }
    }
    if (this.slots.has(slot)) {
      return { ok: true }
    }

    const controller = this.client.createX360Controller()
    const connectErr = controller.connect()
    if (connectErr) {
      return { ok: false, message: connectErr.message }
    }

    controller.updateMode = 'manual'
    controller.resetInputs()
    controller.update()
    this.slots.set(slot, controller)
    return { ok: true }
  }

  detachController(slot: number): void {
    const controller = this.slots.get(slot)
    if (!controller) return
    try {
      controller.resetInputs()
      controller.update()
      controller.disconnect()
    } finally {
      this.slots.delete(slot)
    }
  }

  applyInput(slot: number, message: ClientInboundMessage): void {
    const controller = this.slots.get(slot)
    if (!controller) return

    switch (message.type) {
      case 'button':
        this.applyButton(controller, message)
        break
      case 'stick':
        this.applyStick(controller, message)
        break
      case 'trigger':
        this.applyTrigger(controller, message)
        break
      case 'dpad':
        this.applyDpad(controller, message)
        break
      default:
        return
    }

    controller.update()
  }

  shutdown(): void {
    for (const slot of [...this.slots.keys()]) {
      this.detachController(slot)
    }
  }

  private applyButton(controller: X360ControllerLike, message: ButtonMessage): void {
    const mapped = BUTTON_MAPPING[message.button]
    if (!mapped) return
    controller.button[mapped].setValue(message.state === 'pressed')
  }

  private applyStick(controller: X360ControllerLike, message: StickMessage): void {
    if (message.stick === 'left') {
      controller.axis.leftX.setValue(clamp(message.x, -1, 1))
      controller.axis.leftY.setValue(clamp(message.y, -1, 1))
      return
    }
    controller.axis.rightX.setValue(clamp(message.x, -1, 1))
    controller.axis.rightY.setValue(clamp(message.y, -1, 1))
  }

  private applyTrigger(controller: X360ControllerLike, message: TriggerMessage): void {
    if (message.trigger === 'left') {
      controller.axis.leftTrigger.setValue(clamp(message.value, 0, 1))
      return
    }
    controller.axis.rightTrigger.setValue(clamp(message.value, 0, 1))
  }

  private applyDpad(controller: X360ControllerLike, message: DpadMessage): void {
    const mapped = DPAD_MAPPING[message.direction] ?? { h: 0, v: 0 }
    controller.axis.dpadHorz.setValue(mapped.h)
    controller.axis.dpadVert.setValue(mapped.v)
  }
}

const BUTTON_MAPPING: Record<string, ButtonName | undefined> = {
  A: 'A',
  B: 'B',
  X: 'X',
  Y: 'Y',
  LB: 'LEFT_SHOULDER',
  RB: 'RIGHT_SHOULDER',
  START: 'START',
  SELECT: 'BACK',
  GUIDE: 'GUIDE',
  LS: 'LEFT_THUMB',
  RS: 'RIGHT_THUMB'
}

const DPAD_MAPPING: Record<DpadMessage['direction'], { h: number; v: number }> = {
  up: { h: 0, v: 1 },
  down: { h: 0, v: -1 },
  left: { h: -1, v: 0 },
  right: { h: 1, v: 0 },
  none: { h: 0, v: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
