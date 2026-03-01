import { useEffect, useMemo, useState } from 'react'

import type { HostController, HostEvent, HostState, LayoutType, SetupCheck } from '../../shared/protocol'

const layoutOptions: LayoutType[] = ['xbox', 'simple', 'custom']

export function App(): JSX.Element {
  const [state, setState] = useState<HostState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true

    window.aircontroller.getState().then((snapshot) => {
      if (mounted) setState(snapshot)
    })

    const off = window.aircontroller.onState((snapshot) => setState(snapshot))

    return () => {
      mounted = false
      off()
    }
  }, [])

  const controllerSlots = useMemo(() => {
    const byId = new Map<number, HostController>()
    for (const controller of state?.controllers ?? []) {
      byId.set(controller.controllerId, controller)
    }
    return [1, 2, 3, 4].map((id) => byId.get(id) ?? null)
  }, [state?.controllers])

  async function regenerateCode(): Promise<void> {
    setBusy(true)
    try {
      const next = await window.aircontroller.regenerateCode()
      setState(next)
    } finally {
      setBusy(false)
    }
  }

  async function setLayout(layout: LayoutType): Promise<void> {
    setBusy(true)
    try {
      const next = await window.aircontroller.setLayout(layout)
      setState(next)
    } finally {
      setBusy(false)
    }
  }

  if (!state) {
    return <div className="loading">Starting AirController Host…</div>
  }

  return (
    <main className="app-shell">
      <section className="panel pairing-panel">
        <div className="row between">
          <h1>AirController Host</h1>
          <span className={`pill ${state.running ? 'online' : 'offline'}`}>{state.running ? 'Running' : 'Stopped'}</span>
        </div>

        <div className="code">{state.pairingCode}</div>
        <p className="muted">Open the Android app → Scan QR or enter this code.</p>

        <img className="qr" src={state.qrDataUrl} alt="Pairing QR" />

        <div className="field">
          <label>LAN Endpoint</label>
          <code>{`ws://${state.ip}:${state.port}`}</code>
        </div>

        <div className="field">
          <label>Deep Link</label>
          <code className="wrap">{state.deepLink}</code>
        </div>

        <div className="field">
          <label>Gamepad bridge</label>
          <code className={`bridge ${state.virtualGamepad.enabled ? 'ok' : 'off'}`}>
            {`${state.virtualGamepad.backend.toUpperCase()} • ${state.virtualGamepad.message}`}
          </code>
        </div>

        <div className="button-row">
          <button disabled={busy} onClick={regenerateCode}>
            Regenerate code
          </button>
          <select
            value={state.layout}
            disabled={busy}
            onChange={(event) => {
              void setLayout(event.target.value as LayoutType)
            }}
          >
            {layoutOptions.map((layout) => (
              <option key={layout} value={layout}>
                Layout: {layout}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel controllers-panel">
        <h2>Controllers</h2>
        <div className="grid">
          {controllerSlots.map((controller, index) => (
            <ControllerCard key={index} slot={index + 1} controller={controller} />
          ))}
        </div>
      </section>

      <section className="panel setup-panel">
        <h2>Setup diagnostics</h2>
        <div className="setup-list">
          {state.setupChecks.map((check) => (
            <SetupCheckRow key={check.id} check={check} />
          ))}
        </div>
      </section>

      <section className="panel events-panel">
        <h2>Host events</h2>
        <div className="events">
          {(state.events ?? []).map((event) => (
            <EventRow key={`${event.at}-${event.message}`} event={event} />
          ))}
        </div>
      </section>
    </main>
  )
}

function SetupCheckRow(props: { check: SetupCheck }): JSX.Element {
  const { check } = props
  return (
    <article className={`setup-item ${check.ok ? 'ok' : 'fail'}`}>
      <div className="row between">
        <h3>{check.label}</h3>
        <span className={`pill ${check.ok ? 'online' : 'offline'}`}>{check.ok ? 'OK' : 'Needs attention'}</span>
      </div>
      <p>{check.details}</p>
      <p className="muted-small">{check.required ? 'Required' : 'Optional'}</p>
    </article>
  )
}

function ControllerCard(props: { slot: number; controller: HostController | null }): JSX.Element {
  const { slot, controller } = props
  return (
    <article className={`controller ${controller ? 'connected' : 'empty'}`}>
      <h3>{`Player ${slot}`}</h3>
      {controller ? (
        <>
          <p>{controller.remoteAddress}</p>
          <p>{`Inputs: ${controller.inputCount}`}</p>
          <p>{`Last update: ${timeAgo(controller.lastSeenAt)}`}</p>
        </>
      ) : (
        <p>Waiting for phone…</p>
      )}
    </article>
  )
}

function EventRow(props: { event: HostEvent }): JSX.Element {
  const { event } = props
  return (
    <div className="event-row">
      <span className={`dot ${event.level}`} />
      <span className="time">{new Date(event.at).toLocaleTimeString()}</span>
      <span>{event.message}</span>
    </div>
  )
}

function timeAgo(timestamp: number): string {
  const deltaMs = Math.max(0, Date.now() - timestamp)
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 2) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  return `${hours}h ago`
}
