# AIR Controller 🎮

Turn your Android phone into a wireless game controller for your PC using WebSockets.

## Features

- **Virtual Xbox 360 Controller** — Your phone emulates a full Xbox 360 gamepad
- **Multi-controller support** — Connect up to 4 phones simultaneously (each as a separate controller)
- **Low-latency WebSocket** — Real-time input over your local Wi-Fi network
- **Full controller layout** — Dual analog sticks, ABXY buttons, D-pad, triggers, bumpers, Start/Select
- **Haptic feedback** — Vibration on button press
- **Auto-reconnect** — Reconnects automatically if connection drops
- **QR code connection** — Server displays a QR code for easy setup

## Architecture

```
┌─────────────────┐     WebSocket (Wi-Fi)     ┌──────────────────┐
│   Android App   │ ◄──────────────────────► │   PC Server      │
│   (Controller)  │     JSON messages         │   (Python)       │
│                 │                            │                  │
│  • Joysticks    │                            │  • WebSocket srv │
│  • ABXY / D-pad │                            │  • vgamepad      │
│  • Triggers     │                            │  • Virtual Xbox  │
└─────────────────┘                            └──────────────────┘
     Phone 1..4                                   ↓
                                              Windows sees up to
                                              4 Xbox controllers
```

## Prerequisites

### PC (Server)
- **Python 3.9+**
- **Windows**: [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases) (required for virtual controller emulation)
- **macOS/Linux**: Not supported for virtual gamepad (vgamepad requires ViGEmBus on Windows)

### Android (Client)
- Android 7.0+ (API 24)
- Android Studio (for building)
- Phone and PC must be on the **same Wi-Fi network**

## Quick Start

### 1. Start the Server (PC)

**Windows:**
```bash
# Double-click start_server.bat
# Or from terminal:
start_server.bat
```

**macOS/Linux (for development/testing only):**
```bash
chmod +x start_server.sh
./start_server.sh
```

The server will display:
- Your local IP address
- A QR code for easy connection
- Connection status for each controller

### 2. Install the Android App

```bash
cd android
# Open in Android Studio and build, or:
./gradlew assembleDebug
# Install the APK on your phone
adb install app/build/outputs/apk/debug/app-debug.apk
```

### 3. Connect

1. Open **AIR Controller** on your phone
2. Enter the **IP address** shown by the server (e.g., `192.168.1.100`)
3. Port defaults to `8765`
4. Tap **CONNECT**
5. Controller screen appears in landscape — start playing!

## Protocol

Communication uses JSON messages over WebSocket:

### Button Press/Release
```json
{"type": "button", "button": "a", "pressed": true}
```
Buttons: `a`, `b`, `x`, `y`, `lb`, `rb`, `start`, `select`, `ls`, `rs`

### Joystick
```json
{"type": "joystick", "stick": "left", "x": 0.5, "y": -0.3}
```
`x`, `y` range: `-1.0` to `1.0`

### Trigger
```json
{"type": "trigger", "trigger": "left", "value": 0.8}
```
`value` range: `0.0` to `1.0`

### D-Pad
```json
{"type": "dpad", "direction": "up", "pressed": true}
```
Directions: `up`, `down`, `left`, `right`

### Heartbeat
```json
{"type": "heartbeat"}
```

## Project Structure

```
AIR Controller/
├── server/                    # Python WebSocket server
│   ├── server.py              # Main server entry point
│   ├── gamepad_manager.py     # Virtual gamepad management (vgamepad)
│   ├── config.py              # Configuration constants
│   └── requirements.txt       # Python dependencies
├── android/                   # Android app (Kotlin)
│   └── app/src/main/
│       ├── java/com/aircontroller/app/
│       │   ├── network/
│       │   │   └── ControllerWebSocket.kt    # WebSocket client
│       │   └── ui/
│       │       ├── ConnectActivity.kt        # Connection screen
│       │       ├── ControllerActivity.kt     # Controller screen
│       │       └── views/
│       │           └── JoystickView.kt       # Custom joystick widget
│       └── res/
│           ├── layout/
│           │   ├── activity_connect.xml      # Connection UI
│           │   └── activity_controller.xml   # Controller UI
│           └── drawable/                     # Button graphics
├── start_server.sh            # macOS/Linux launcher
├── start_server.bat           # Windows launcher
└── README.md
```

## Configuration

Edit `server/config.py` to customize:

| Setting | Default | Description |
|---------|---------|-------------|
| `SERVER_PORT` | `8765` | WebSocket server port |
| `MAX_CONTROLLERS` | `4` | Maximum simultaneous controllers |
| `HEARTBEAT_INTERVAL` | `5s` | Heartbeat check interval |
| `HEARTBEAT_TIMEOUT` | `15s` | Disconnect timeout |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't connect | Ensure phone & PC are on the same Wi-Fi network |
| No controller detected in game | Install [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases) (Windows) |
| High latency | Use 5GHz Wi-Fi band, reduce distance to router |
| Connection drops | Check `HEARTBEAT_TIMEOUT` in config, ensure stable Wi-Fi |
| Server full | Increase `MAX_CONTROLLERS` in config (max depends on system) |

## License

MIT
