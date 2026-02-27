"""
AIR Controller - WebSocket Server
Accepts connections from Android controller apps and maps them
to virtual Xbox 360 controllers on the PC.
"""

import asyncio
import json
import logging
import socket
import time
import signal
import sys
from typing import Optional

import websockets
from websockets.server import WebSocketServerProtocol

from config import (
    SERVER_HOST, SERVER_PORT, MAX_CONTROLLERS,
    MSG_TYPE_BUTTON, MSG_TYPE_JOYSTICK, MSG_TYPE_TRIGGER,
    MSG_TYPE_DPAD, MSG_TYPE_CONNECT, MSG_TYPE_DISCONNECT,
    MSG_TYPE_HEARTBEAT, MSG_TYPE_SERVER_INFO,
    HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT,
)
from gamepad_manager import GamepadManager, VirtualGamepad

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("air_controller.server")


class ControllerSession:
    """Tracks a single connected controller client."""

    def __init__(self, ws: WebSocketServerProtocol, gamepad: VirtualGamepad, player_index: int):
        self.ws = ws
        self.gamepad = gamepad
        self.player_index = player_index
        self.client_name = f"Player {player_index + 1}"
        self.last_heartbeat = time.time()
        self.connected_at = time.time()


class AirControllerServer:
    """Main WebSocket server for AIR Controller."""

    def __init__(self):
        self.gamepad_manager = GamepadManager(max_controllers=MAX_CONTROLLERS)
        self.sessions: dict[WebSocketServerProtocol, ControllerSession] = {}
        self._running = False

    def get_local_ip(self) -> str:
        """Get the local network IP address of this machine."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    async def handle_connection(self, ws: WebSocketServerProtocol):
        """Handle a new WebSocket connection from a controller."""
        session: Optional[ControllerSession] = None

        try:
            # Create a virtual gamepad for this connection
            gamepad = self.gamepad_manager.create_gamepad()
            if gamepad is None:
                await ws.send(json.dumps({
                    "type": "error",
                    "message": f"Server full. Maximum {MAX_CONTROLLERS} controllers supported."
                }))
                await ws.close()
                return

            session = ControllerSession(ws, gamepad, gamepad.player_index)
            self.sessions[ws] = session

            # Send connection confirmation
            await ws.send(json.dumps({
                "type": MSG_TYPE_SERVER_INFO,
                "player_index": session.player_index,
                "player_name": session.client_name,
                "max_controllers": MAX_CONTROLLERS,
                "connected_controllers": self.gamepad_manager.connected_count,
            }))

            logger.info(
                f"{session.client_name} connected from {ws.remote_address} "
                f"({self.gamepad_manager.connected_count}/{MAX_CONTROLLERS})"
            )

            # Notify all other clients about the new connection count
            await self._broadcast_player_count()

            # Process messages
            async for raw_message in ws:
                try:
                    message = json.loads(raw_message)
                    await self._handle_message(session, message)
                except json.JSONDecodeError:
                    logger.warning(f"{session.client_name}: Invalid JSON received")
                except Exception as e:
                    logger.error(f"{session.client_name}: Error processing message: {e}")

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.error(f"Connection error: {e}")
        finally:
            # Clean up on disconnect
            if session:
                self.gamepad_manager.remove_gamepad(session.player_index)
                del self.sessions[ws]
                logger.info(
                    f"{session.client_name} disconnected "
                    f"({self.gamepad_manager.connected_count}/{MAX_CONTROLLERS})"
                )
                await self._broadcast_player_count()

    async def _handle_message(self, session: ControllerSession, message: dict):
        """Route an incoming message to the appropriate handler."""
        msg_type = message.get("type")

        if msg_type == MSG_TYPE_BUTTON:
            button = message.get("button", "")
            pressed = message.get("pressed", False)
            if pressed:
                session.gamepad.press_button(button)
            else:
                session.gamepad.release_button(button)

        elif msg_type == MSG_TYPE_JOYSTICK:
            stick = message.get("stick", "left")
            x = float(message.get("x", 0))
            y = float(message.get("y", 0))
            if stick == "left":
                session.gamepad.set_left_joystick(x, y)
            else:
                session.gamepad.set_right_joystick(x, y)

        elif msg_type == MSG_TYPE_TRIGGER:
            trigger = message.get("trigger", "left")
            value = float(message.get("value", 0))
            if trigger == "left":
                session.gamepad.set_left_trigger(value)
            else:
                session.gamepad.set_right_trigger(value)

        elif msg_type == MSG_TYPE_DPAD:
            direction = message.get("direction", "")
            pressed = message.get("pressed", False)
            button_name = f"dpad_{direction}"
            if pressed:
                session.gamepad.press_button(button_name)
            else:
                session.gamepad.release_button(button_name)

        elif msg_type == MSG_TYPE_HEARTBEAT:
            session.last_heartbeat = time.time()
            await session.ws.send(json.dumps({"type": MSG_TYPE_HEARTBEAT, "ts": time.time()}))

        else:
            logger.debug(f"{session.client_name}: Unknown message type '{msg_type}'")

    async def _broadcast_player_count(self):
        """Notify all connected clients of the current player count."""
        msg = json.dumps({
            "type": "player_count",
            "count": self.gamepad_manager.connected_count,
            "max": MAX_CONTROLLERS,
        })
        for session in self.sessions.values():
            try:
                await session.ws.send(msg)
            except Exception:
                pass

    async def _heartbeat_monitor(self):
        """Periodically check for timed-out connections."""
        while self._running:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            now = time.time()
            timed_out = [
                session for session in self.sessions.values()
                if now - session.last_heartbeat > HEARTBEAT_TIMEOUT
            ]
            for session in timed_out:
                logger.warning(f"{session.client_name}: Heartbeat timeout, disconnecting")
                try:
                    await session.ws.close()
                except Exception:
                    pass

    def _show_qr_code(self, url: str):
        """Display a QR code in the terminal for easy connection."""
        try:
            import qrcode
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=1,
                border=1,
            )
            qr.add_data(url)
            qr.make(fit=True)
            qr.print_ascii(invert=True)
        except ImportError:
            logger.info("Install 'qrcode' package for QR code display")

    async def start(self):
        """Start the WebSocket server."""
        self._running = True
        local_ip = self.get_local_ip()
        connection_url = f"ws://{local_ip}:{SERVER_PORT}"

        print("\n" + "=" * 50)
        print("       AIR Controller Server")
        print("=" * 50)
        print(f"  Local IP:    {local_ip}")
        print(f"  Port:        {SERVER_PORT}")
        print(f"  WebSocket:   {connection_url}")
        print(f"  Max Players: {MAX_CONTROLLERS}")
        print("=" * 50)
        print("\n  Scan QR code with AIR Controller app:\n")
        self._show_qr_code(connection_url)
        print(f"\n  Or enter manually: {connection_url}")
        print(f"\n  Waiting for controllers to connect...")
        print("  Press Ctrl+C to stop\n")

        # Start heartbeat monitor
        asyncio.create_task(self._heartbeat_monitor())

        async with websockets.serve(
            self.handle_connection,
            SERVER_HOST,
            SERVER_PORT,
            ping_interval=20,
            ping_timeout=20,
        ):
            # Run forever
            stop = asyncio.Future()

            def signal_handler():
                stop.set_result(None)

            loop = asyncio.get_event_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                try:
                    loop.add_signal_handler(sig, signal_handler)
                except NotImplementedError:
                    # Windows doesn't support add_signal_handler
                    pass

            try:
                await stop
            except (KeyboardInterrupt, asyncio.CancelledError):
                pass
            finally:
                self._running = False
                self.gamepad_manager.close_all()
                print("\n  Server stopped. All controllers disconnected.\n")


def main():
    server = AirControllerServer()
    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
