# AirController WebSocket Protocol

All messages are JSON objects sent over a WebSocket connection.  
Server (PC) listens on port **8765**.  
mDNS service type: `_aircontroller._tcp`  
QR / deep-link URI format: `aircontroller://connect?ip=<IP>&port=8765&code=<CODE>`

---

## Connection Lifecycle

```
Phone                          PC Server
  |                                |
  |---[ WebSocket open ]---------->|
  |                                |
  |---[ pair ]-------------------->|   phone sends 6-digit code
  |                                |
  |<--[ welcome ] or [ reject ]----| 
  |                                |
  |<==[ controller input loop ]===>|
  |                                |
  |---[ WebSocket close ]--------->|   or server-side disconnect
```

---

## Message Types

### 1. `pair`  (Phone → PC)
Sent immediately after opening the WebSocket connection.

```json
{
  "type": "pair",
  "code": "123456"
}
```

---

### 2. `welcome`  (PC → Phone)
Sent on successful pairing. `controllerId` is 1–4.

```json
{
  "type": "welcome",
  "controllerId": 1,
  "layout": "xbox"
}
```

Available layouts: `"xbox"` | `"simple"` | `"custom"`

---

### 3. `reject`  (PC → Phone)
Sent when the code is wrong or the server is full (max 4 controllers).

```json
{
  "type": "reject",
  "reason": "invalid_code"
}
```

Reason codes: `"invalid_code"` | `"server_full"` | `"already_connected"`

---

### 4. `button`  (Phone → PC)
Fired on any digital button press or release.

```json
{
  "type": "button",
  "button": "A",
  "state": "pressed"
}
```

`state`: `"pressed"` | `"released"`

Button names:
- Face: `A`, `B`, `X`, `Y`
- Shoulder: `LB`, `RB`
- Special: `START`, `SELECT`, `GUIDE`
- Stick clicks: `LS`, `RS`

---

### 5. `stick`  (Phone → PC)
Sent at up to 60 Hz while a joystick is being moved.  
Values are floats in the range `[-1.0, 1.0]`.

```json
{
  "type": "stick",
  "stick": "left",
  "x": 0.42,
  "y": -0.87
}
```

`stick`: `"left"` | `"right"`

---

### 6. `trigger`  (Phone → PC)
Sent at up to 60 Hz while an analogue trigger is pressed.  
Value is a float in the range `[0.0, 1.0]`.

```json
{
  "type": "trigger",
  "trigger": "left",
  "value": 0.75
}
```

`trigger`: `"left"` | `"right"`

---

### 7. `dpad`  (Phone → PC)
Sent on D-pad touch changes.

```json
{
  "type": "dpad",
  "direction": "up"
}
```

`direction`: `"up"` | `"down"` | `"left"` | `"right"` | `"none"`

---

### 8. `layout_change`  (PC → Phone)
PC requests the phone to switch its on-screen layout.

```json
{
  "type": "layout_change",
  "layout": "simple"
}
```

---

### 9. `ping` / `pong`  (Either direction)
Keepalive — sent every 5 seconds. The receiver replies with `pong`.

```json
{ "type": "ping" }
{ "type": "pong" }
```

---

## Controller Slot Numbering

| Controller ID | ViGEm Slot     |
|---------------|----------------|
| 1             | Player 1 (Xbox)|
| 2             | Player 2 (Xbox)|
| 3             | Player 3 (Xbox)|
| 4             | Player 4 (Xbox)|

Maximum of **4 simultaneous controllers**.
