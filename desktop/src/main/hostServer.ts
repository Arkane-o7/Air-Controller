import { EventEmitter } from 'node:events'
import { networkInterfaces } from 'node:os'

import { Bonjour } from 'bonjour-service'
import QRCode from 'qrcode'
import { WebSocketServer, type WebSocket } from 'ws'

import {
  AIRCONTROLLER_MAX_CONTROLLERS,
  AIRCONTROLLER_PORT,
  type ClientInboundMessage,
  type HostController,
  type HostEvent,
  type HostState,
  type LayoutType,
  type SetupCheck,
  parseClientInboundMessage,
  toJson
} from '../shared/protocol'
import { VigemBridge } from './vigemBridge'

type SocketClient = {
  socket: WebSocket
  controllerId: number | null
  paired: boolean
  remoteAddress: string
  connectedAt: number
  lastSeenAt: number
  inputCount: number
}

export class HostServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private bonjour: Bonjour | null = null
  private publishHandle: ReturnType<Bonjour['publish']> | null = null
  private readonly clients = new Map<WebSocket, SocketClient>()
  private readonly events: HostEvent[] = []
  private readonly port: number
  private pairingCode = generateCode()
  private layout: LayoutType = 'xbox'
  private ip = getBestLanIp()
  private qrDataUrl = ''
  private pingTimer: NodeJS.Timeout | null = null
  private readonly vigem = new VigemBridge()

  constructor(port = AIRCONTROLLER_PORT) {
    super()
    this.port = port
  }

  async start(): Promise<void> {
    if (this.wss) return

    this.ip = getBestLanIp()
    this.qrDataUrl = await QRCode.toDataURL(this.deepLink, { margin: 1, width: 360 })

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({ port: this.port }, () => {
        this.wss = server
        this.log('info', `Host started on ws://${this.ip}:${this.port}`)
        resolve()
      })

      server.on('connection', (socket, request) => {
        const remoteAddress = request.socket.remoteAddress ?? 'unknown'
        const client: SocketClient = {
          socket,
          controllerId: null,
          paired: false,
          remoteAddress,
          connectedAt: Date.now(),
          lastSeenAt: Date.now(),
          inputCount: 0
        }
        this.clients.set(socket, client)
        this.log('info', `Socket opened from ${remoteAddress}`)
        this.emitState()

        socket.on('message', (raw) => {
          if (typeof raw !== 'string') {
            this.onMessage(client, raw.toString('utf8'))
            return
          }
          this.onMessage(client, raw)
        })

        socket.on('close', () => {
          const tracked = this.clients.get(socket)
          if (tracked?.controllerId != null) {
            this.vigem.detachController(tracked.controllerId)
            this.log('info', `Controller P${tracked.controllerId} disconnected`)
          }
          this.clients.delete(socket)
          this.emitState()
        })

        socket.on('error', (err) => {
          this.log('warn', `Socket error from ${remoteAddress}: ${err.message}`)
        })
      })

      server.on('error', (err) => {
        reject(err)
      })
    })

    this.startBonjour()
    this.startPingLoop()
    this.log('info', this.vigem.getStatus().message)
    this.emitState()
  }

  async stop(): Promise<void> {
    this.stopPingLoop()
    this.stopBonjour()

    for (const client of this.clients.values()) {
      if (client.controllerId != null) {
        this.vigem.detachController(client.controllerId)
      }
      client.socket.close(1001, 'Host stopping')
    }
    this.clients.clear()
    this.vigem.shutdown()

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()))
      this.wss = null
    }

    this.log('info', 'Host stopped')
    this.emitState()
  }

  async regeneratePairingCode(): Promise<void> {
    this.pairingCode = generateCode()
    this.ip = getBestLanIp()
    this.qrDataUrl = await QRCode.toDataURL(this.deepLink, { margin: 1, width: 360 })
    this.restartBonjour()
    this.log('info', 'Pairing code regenerated')
    this.emitState()
  }

  setLayout(layout: LayoutType): void {
    if (this.layout === layout) return
    this.layout = layout
    for (const client of this.clients.values()) {
      if (!client.paired) continue
      client.socket.send(toJson({ type: 'layout_change', layout }))
    }
    this.log('info', `Layout changed to ${layout}`)
    this.emitState()
  }

  getState(): HostState {
    return {
      running: this.wss != null,
      port: this.port,
      ip: this.ip,
      pairingCode: this.pairingCode,
      deepLink: this.deepLink,
      qrDataUrl: this.qrDataUrl,
      layout: this.layout,
      virtualGamepad: this.vigem.getStatus(),
      setupChecks: this.getSetupChecks(),
      controllers: this.controllerSnapshots,
      events: [...this.events]
    }
  }

  private getSetupChecks(): SetupCheck[] {
    const virtualGamepad = this.vigem.getStatus()
    const isWindows = process.platform === 'win32'

    return [
      {
        id: 'host-server',
        label: 'WebSocket host server',
        ok: this.wss != null,
        required: true,
        details:
          this.wss != null
            ? `Listening on ws://${this.ip}:${this.port}`
            : 'Host server is not running yet.'
      },
      {
        id: 'mdns',
        label: 'LAN discovery broadcast (mDNS)',
        ok: this.bonjour != null,
        required: true,
        details:
          this.bonjour != null
            ? 'Advertising _aircontroller._tcp for auto-discovery.'
            : 'Not advertising yet. Clients must use direct details if this stays off.'
      },
      {
        id: 'pairing',
        label: 'Pairing payload generation',
        ok: this.pairingCode.length === 6 && this.qrDataUrl.length > 0,
        required: true,
        details:
          this.qrDataUrl.length > 0
            ? '6-digit code and QR deep-link are ready.'
            : 'QR payload has not been generated yet.'
      },
      {
        id: 'virtual-gamepad',
        label: 'Virtual gamepad backend',
        ok: isWindows ? virtualGamepad.enabled : true,
        required: isWindows,
        details: isWindows
          ? virtualGamepad.message
          : 'Optional on this platform (controller passthrough is Windows-only).'
      }
    ]
  }

  private get deepLink(): string {
    return `aircontroller://connect?ip=${encodeURIComponent(this.ip)}&port=${this.port}&code=${this.pairingCode}`
  }

  private get controllerSnapshots(): HostController[] {
    return [...this.clients.values()]
      .filter((c) => c.paired && c.controllerId != null)
      .sort((a, b) => (a.controllerId ?? 0) - (b.controllerId ?? 0))
      .map((c) => ({
        controllerId: c.controllerId ?? -1,
        connectedAt: c.connectedAt,
        lastSeenAt: c.lastSeenAt,
        inputCount: c.inputCount,
        remoteAddress: c.remoteAddress
      }))
  }

  private emitState(): void {
    this.emit('state', this.getState())
  }

  private log(level: HostEvent['level'], message: string): void {
    this.events.unshift({ at: Date.now(), level, message })
    if (this.events.length > 120) {
      this.events.length = 120
    }
    this.emitState()
  }

  private onMessage(client: SocketClient, raw: string): void {
    client.lastSeenAt = Date.now()
    const message = parseClientInboundMessage(raw)
    if (!message) {
      this.log('warn', `Invalid JSON from ${client.remoteAddress}`)
      return
    }

    if (!client.paired) {
      if (message.type !== 'pair') {
        client.socket.send(toJson({ type: 'reject', reason: 'invalid_code' }))
        client.socket.close(1008, 'Expected pair first')
        return
      }
      this.handlePair(client, message)
      return
    }

    this.handleInput(client, message)
  }

  private handlePair(client: SocketClient, message: Extract<ClientInboundMessage, { type: 'pair' }>): void {
    if (client.paired) {
      client.socket.send(toJson({ type: 'reject', reason: 'already_connected' }))
      return
    }

    if (message.code !== this.pairingCode) {
      client.socket.send(toJson({ type: 'reject', reason: 'invalid_code' }))
      this.log('warn', `Rejected ${client.remoteAddress} with wrong code`)
      client.socket.close(1008, 'invalid_code')
      return
    }

    const slot = this.findOpenSlot()
    if (slot === null) {
      client.socket.send(toJson({ type: 'reject', reason: 'server_full' }))
      this.log('warn', 'Rejected incoming controller because host is full')
      client.socket.close(1008, 'server_full')
      return
    }

    client.paired = true
    client.controllerId = slot

    const attach = this.vigem.attachController(slot)
    if (!attach.ok && attach.message) {
      this.log('warn', `P${slot} paired, but virtual gamepad is unavailable: ${attach.message}`)
    }

    client.socket.send(toJson({ type: 'welcome', controllerId: slot, layout: this.layout }))
    this.log('info', `Controller paired: P${slot} (${client.remoteAddress})`)
    this.emitState()
  }

  private handleInput(client: SocketClient, message: ClientInboundMessage): void {
    if (message.type === 'pong') return
    if (message.type === 'ping') {
      client.socket.send(toJson({ type: 'pong' }))
      return
    }

    client.inputCount += 1

    if (client.controllerId != null) {
      this.vigem.applyInput(client.controllerId, message)
    }

    if (client.inputCount % 60 === 0) {
      this.emitState()
    }
  }

  private findOpenSlot(): number | null {
    for (let id = 1; id <= AIRCONTROLLER_MAX_CONTROLLERS; id += 1) {
      const used = [...this.clients.values()].some((c) => c.paired && c.controllerId === id)
      if (!used) return id
    }
    return null
  }

  private startPingLoop(): void {
    this.stopPingLoop()
    this.pingTimer = setInterval(() => {
      for (const client of this.clients.values()) {
        if (!client.paired) continue
        client.socket.send(toJson({ type: 'ping' }))
      }
    }, 5000)
  }

  private stopPingLoop(): void {
    if (!this.pingTimer) return
    clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private restartBonjour(): void {
    this.stopBonjour()
    this.startBonjour()
  }

  private startBonjour(): void {
    this.bonjour = new Bonjour()
    this.publishHandle = this.bonjour.publish({
      name: 'AirController Host',
      type: 'aircontroller',
      port: this.port,
      txt: {
        code: this.pairingCode
      }
    })
  }

  private stopBonjour(): void {
    this.publishHandle?.stop?.()
    this.publishHandle = null
    if (this.bonjour) {
      this.bonjour.unpublishAll(() => {
        this.bonjour?.destroy()
      })
      this.bonjour = null
    }
  }
}

function generateCode(): string {
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')
}

function getBestLanIp(): string {
  const ifaces = networkInterfaces()

  // Patterns that indicate virtual / non-physical adapters (case-insensitive)
  const virtualPatterns =
    /^(vEthernet|veth|Hyper-V|WSL|docker|br-|vmnet|vmware|VirtualBox|virbr|tailscale|tun|tap|utun|ham|npcap|loopback)/i

  // Subnet ranges commonly used by virtual adapters (Windows Mobile Hotspot, etc.)
  const virtualSubnets = ['192.168.137.', '172.17.', '172.18.', '172.19.']

  interface Candidate {
    address: string
    score: number
  }

  const candidates: Candidate[] = []

  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue

      let score = 0

      // Prefer real adapter names (Wi-Fi, Ethernet, en0, wlan0, eth0)
      if (/^(Wi-?Fi|Ethernet|en\d|wlan\d|eth\d)/i.test(name)) {
        score += 100
      }

      // Penalise virtual adapters
      if (virtualPatterns.test(name)) {
        score -= 200
      }

      // Penalise virtual subnets
      if (virtualSubnets.some((s) => entry.address.startsWith(s))) {
        score -= 150
      }

      candidates.push({ address: entry.address, score })
    }
  }

  if (candidates.length === 0) return '127.0.0.1'

  // Sort descending by score; first entry wins
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0].address
}
