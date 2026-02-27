"""Configuration constants for AIR Controller server."""

# Server settings
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8765
MAX_CONTROLLERS = 4

# Controller mapping
# Joystick values range: -1.0 to 1.0
# Trigger values range: 0.0 to 1.0
# Button values: 0 (released) or 1 (pressed)

# Message types
MSG_TYPE_BUTTON = "button"
MSG_TYPE_JOYSTICK = "joystick"
MSG_TYPE_TRIGGER = "trigger"
MSG_TYPE_DPAD = "dpad"
MSG_TYPE_CONNECT = "connect"
MSG_TYPE_DISCONNECT = "disconnect"
MSG_TYPE_HEARTBEAT = "heartbeat"
MSG_TYPE_SERVER_INFO = "server_info"

# Heartbeat interval (seconds)
HEARTBEAT_INTERVAL = 5
HEARTBEAT_TIMEOUT = 15
