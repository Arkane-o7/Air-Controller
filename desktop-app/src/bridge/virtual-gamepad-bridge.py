#!/usr/bin/env python3
"""AIR Controller virtual gamepad bridge for Windows/Linux.

Connects to an AIR session and maps controller payloads to a virtual
Xbox 360 or DualShock 4 device via vgamepad.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
from pathlib import Path
from typing import Dict, List, Set, Tuple


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AIR Controller virtual gamepad bridge (Windows/Linux)",
    )
    parser.add_argument(
        "--server",
        default=os.getenv("AIR_CONTROLLER_SERVER", "http://localhost:3000"),
        help="AIR server URL",
    )
    parser.add_argument(
        "--code",
        default=os.getenv("AIR_CONTROLLER_CODE", ""),
        help="Session code from /host",
    )
    parser.add_argument(
        "--device",
        default=os.getenv("AIR_CONTROLLER_VIRTUAL_DEVICE", "xbox"),
        choices=["xbox", "ds4"],
        help="Virtual controller type",
    )
    parser.add_argument(
        "--profile",
        default=os.getenv("AIR_CONTROLLER_PROFILE", ""),
        help="Optional fixed mapping profile id (platformer/racing/arena)",
    )
    parser.add_argument(
        "--name",
        default=os.getenv("AIR_CONTROLLER_BRIDGE_NAME", "Virtual Gamepad Bridge"),
        help="Bridge label shown in host UI",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.getenv("AIR_CONTROLLER_DRY_RUN", "0") == "1",
        help="Print resolved actions without injecting a virtual device",
    )
    return parser.parse_args()


def normalize_session_code(raw: str) -> str:
    cleaned = "".join(ch for ch in str(raw or "").upper().strip() if ch.isalnum())
    return cleaned[:6]


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(value)))


def log(message: str) -> None:
    sys.stdout.write(f"{message}\n")
    sys.stdout.flush()


def normalize_action(action: str) -> str:
    return "".join(ch for ch in str(action or "").strip().lower() if ch.isalnum() or ch == "_")


def as_action_list(value: object) -> List[str]:
    if isinstance(value, list):
        return [normalize_action(entry) for entry in value if normalize_action(entry)]
    single = normalize_action(str(value or ""))
    return [single] if single else []


def load_profile_catalog(repo_root: Path) -> Dict[str, object]:
    catalog_path = repo_root / "config" / "profiles.json"
    with catalog_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_virtual_map(raw_map: Dict[str, object]) -> Dict[str, List[str]]:
    normalized: Dict[str, List[str]] = {}

    for button_name, actions in (raw_map or {}).items():
        key = str(button_name or "").strip()
        if not key:
            continue
        normalized[key] = as_action_list(actions)

    return normalized


def build_profile_maps(catalog: Dict[str, object]) -> Dict[str, Dict[str, List[str]]]:
    profile_maps: Dict[str, Dict[str, List[str]]] = {}
    for profile in catalog.get("gameProfiles", []):
        profile_id = str(profile.get("id", "")).strip()
        if not profile_id:
            continue

        profile_maps[profile_id] = normalize_virtual_map(profile.get("virtualMap") or {})

    return profile_maps


def resolve_profile_id(requested: str, available: Dict[str, Dict[str, List[str]]], default_id: str) -> str:
    candidate = str(requested or "").strip().lower()
    if candidate in available:
        return candidate
    return default_id if default_id in available else next(iter(available.keys()), "")


def resolve_dpad_actions(active_actions: Set[str]) -> Set[str]:
    up = "dpad_up" in active_actions
    down = "dpad_down" in active_actions
    left = "dpad_left" in active_actions
    right = "dpad_right" in active_actions

    if up and down:
        up = False
        down = False

    if left and right:
        left = False
        right = False

    resolved = set(active_actions)
    resolved.difference_update({"dpad_up", "dpad_down", "dpad_left", "dpad_right"})

    if up:
        resolved.add("dpad_up")
    if down:
        resolved.add("dpad_down")
    if left:
        resolved.add("dpad_left")
    if right:
        resolved.add("dpad_right")

    return resolved


def _extract_stick(payload: Dict[str, object], key: str, fallback: str = "") -> Tuple[float, float]:
    raw = payload.get(key) or {}
    if not isinstance(raw, dict) and fallback:
        raw = payload.get(fallback) or {}

    if not isinstance(raw, dict):
        raw = {}

    return clamp(raw.get("x", 0.0), -1.0, 1.0), clamp(raw.get("y", 0.0), -1.0, 1.0)


def derive_actions(
    payload: Dict[str, object],
    virtual_map: Dict[str, List[str]],
) -> Tuple[Set[str], float, float, float, float, float, float]:
    buttons = payload.get("buttons") or {}
    if not isinstance(buttons, dict):
        buttons = {}

    triggers = payload.get("triggers") or {}
    if not isinstance(triggers, dict):
        triggers = {}

    left_x, left_y = _extract_stick(payload, "leftStick", fallback="stick")
    right_x, right_y = _extract_stick(payload, "rightStick")

    actions: Set[str] = set()

    for direction in ("up", "down", "left", "right"):
        if buttons.get(direction):
            actions.add(f"dpad_{direction}")

    for button_name, pressed in buttons.items():
        if not pressed:
            continue

        for action in virtual_map.get(str(button_name), []):
            if action:
                actions.add(action)

    actions = resolve_dpad_actions(actions)

    lt_value = clamp(triggers.get("lt", 0.0), 0.0, 1.0)
    rt_value = clamp(triggers.get("rt", 0.0), 0.0, 1.0)

    if "lt" in actions:
        lt_value = max(lt_value, 1.0)

    if "rt" in actions:
        rt_value = max(rt_value, 1.0)

    return actions, left_x, left_y, right_x, right_y, lt_value, rt_value


class DryRunPad:
    def __init__(self) -> None:
        self._pressed: Set[str] = set()
        self._last_lt = 0.0
        self._last_rt = 0.0

    def apply(
        self,
        actions: Set[str],
        left_x: float,
        left_y: float,
        right_x: float,
        right_y: float,
        lt_value: float,
        rt_value: float,
    ) -> None:
        digital_actions = {a for a in actions if a not in {"lt", "rt"}}

        for action in sorted(digital_actions - self._pressed):
            log(f"[dry-run] down {action}")
        for action in sorted(self._pressed - digital_actions):
            log(f"[dry-run] up {action}")

        self._pressed = set(digital_actions)

        if lt_value != self._last_lt:
            log(f"[dry-run] lt {lt_value:.2f}")
            self._last_lt = lt_value

        if rt_value != self._last_rt:
            log(f"[dry-run] rt {rt_value:.2f}")
            self._last_rt = rt_value

        log(f"[dry-run] ls x={left_x:.3f} y={left_y:.3f}")
        log(f"[dry-run] rs x={right_x:.3f} y={right_y:.3f}")

    def reset(self) -> None:
        if self._pressed:
            log("[dry-run] reset digital")
        self._pressed.clear()
        self._last_lt = 0.0
        self._last_rt = 0.0


class XboxPad:
    def __init__(self, vg_module) -> None:
        self.vg = vg_module
        self.pad = vg_module.VX360Gamepad()
        self._pressed: Set[str] = set()
        self._button_map = {
            "south": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_A,
            "east": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_B,
            "west": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_X,
            "north": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_Y,
            "lb": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
            "rb": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
            "back": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
            "start": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_START,
            "ls": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB,
            "rs": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB,
            "dpad_up": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
            "dpad_down": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
            "dpad_left": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
            "dpad_right": vg_module.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
        }

    def apply(
        self,
        actions: Set[str],
        left_x: float,
        left_y: float,
        right_x: float,
        right_y: float,
        lt_value: float,
        rt_value: float,
    ) -> None:
        digital_next = {action for action in actions if action in self._button_map}

        for action in sorted(self._pressed - digital_next):
            self.pad.release_button(button=self._button_map[action])

        for action in sorted(digital_next - self._pressed):
            self.pad.press_button(button=self._button_map[action])

        self._pressed = set(digital_next)

        self.pad.left_trigger_float(lt_value)
        self.pad.right_trigger_float(rt_value)

        self.pad.left_joystick_float(left_x, -left_y)
        self.pad.right_joystick_float(right_x, -right_y)
        self.pad.update()

    def reset(self) -> None:
        self.pad.reset()
        self.pad.update()
        self._pressed.clear()


class DualShockPad:
    def __init__(self, vg_module) -> None:
        self.vg = vg_module
        self.pad = vg_module.VDS4Gamepad()
        self._pressed: Set[str] = set()
        self._button_map = {
            "south": vg_module.DS4_BUTTONS.DS4_BUTTON_CROSS,
            "east": vg_module.DS4_BUTTONS.DS4_BUTTON_CIRCLE,
            "west": vg_module.DS4_BUTTONS.DS4_BUTTON_SQUARE,
            "north": vg_module.DS4_BUTTONS.DS4_BUTTON_TRIANGLE,
            "lb": vg_module.DS4_BUTTONS.DS4_BUTTON_SHOULDER_LEFT,
            "rb": vg_module.DS4_BUTTONS.DS4_BUTTON_SHOULDER_RIGHT,
            "back": vg_module.DS4_BUTTONS.DS4_BUTTON_SHARE,
            "start": vg_module.DS4_BUTTONS.DS4_BUTTON_OPTIONS,
            "ls": vg_module.DS4_BUTTONS.DS4_BUTTON_THUMB_LEFT,
            "rs": vg_module.DS4_BUTTONS.DS4_BUTTON_THUMB_RIGHT,
        }

    def _resolve_dpad_direction(self, actions: Set[str]):
        vg = self.vg
        up = "dpad_up" in actions
        down = "dpad_down" in actions
        left = "dpad_left" in actions
        right = "dpad_right" in actions

        if up and right:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_NORTHEAST
        if up and left:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_NORTHWEST
        if down and right:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_SOUTHEAST
        if down and left:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_SOUTHWEST
        if up:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_NORTH
        if down:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_SOUTH
        if left:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_WEST
        if right:
            return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_EAST
        return vg.DS4_DPAD_DIRECTIONS.DS4_BUTTON_DPAD_NONE

    def apply(
        self,
        actions: Set[str],
        left_x: float,
        left_y: float,
        right_x: float,
        right_y: float,
        lt_value: float,
        rt_value: float,
    ) -> None:
        digital_next = {action for action in actions if action in self._button_map}

        for action in sorted(self._pressed - digital_next):
            self.pad.release_button(button=self._button_map[action])

        for action in sorted(digital_next - self._pressed):
            self.pad.press_button(button=self._button_map[action])

        self._pressed = set(digital_next)

        self.pad.left_trigger_float(lt_value)
        self.pad.right_trigger_float(rt_value)

        self.pad.left_joystick_float(left_x, left_y)
        self.pad.right_joystick_float(right_x, right_y)
        self.pad.directional_pad(self._resolve_dpad_direction(actions))
        self.pad.update()

    def reset(self) -> None:
        self.pad.reset()
        self.pad.update()
        self._pressed.clear()


class BridgeRuntime:
    def __init__(
        self,
        sio_module,
        pad,
        server_url: str,
        session_code: str,
        bridge_name: str,
        default_profile_id: str,
        profile_maps: Dict[str, Dict[str, List[str]]],
        profile_locked: bool,
    ) -> None:
        self.socketio = sio_module
        self.pad = pad
        self.server_url = server_url
        self.session_code = session_code
        self.bridge_name = bridge_name
        self.profile_maps = profile_maps
        self.profile_locked = profile_locked
        self.default_profile_id = default_profile_id

        self.lock = threading.Lock()
        self.active_profile_id = default_profile_id
        self.client = self.socketio.Client(reconnection=True)
        self._setup_handlers()

    def _set_active_profile(self, profile_id: str, reason: str) -> None:
        resolved = resolve_profile_id(profile_id, self.profile_maps, self.default_profile_id)
        if not resolved:
            return

        if resolved != self.active_profile_id:
            self.active_profile_id = resolved
            log(f"[virtual-bridge] profile -> {resolved} ({reason})")
        else:
            self.active_profile_id = resolved

    def _ingest_profile_payload(self, profile_payload) -> None:
        if not isinstance(profile_payload, dict):
            return

        profile_id = str(profile_payload.get("id", "")).strip()
        if not profile_id:
            return

        virtual_map = normalize_virtual_map(profile_payload.get("virtualMap") or {})
        self.profile_maps[profile_id] = virtual_map

    def _setup_handlers(self) -> None:
        @self.client.event
        def connect():
            log(f"[virtual-bridge] connected to {self.server_url}")
            self.client.emit(
                "bridge:join-session",
                {
                    "code": self.session_code,
                    "name": self.bridge_name,
                },
                callback=self._handle_join_ack,
            )

        @self.client.event
        def disconnect():
            log("[virtual-bridge] disconnected; resetting virtual device")
            with self.lock:
                self.pad.reset()

        @self.client.on("session:input")
        def on_session_input(event):
            payload = (event or {}).get("payload") or {}
            with self.lock:
                virtual_map = self.profile_maps.get(self.active_profile_id, {})
                parsed = derive_actions(payload, virtual_map)
                self.pad.apply(*parsed)

        @self.client.on("session:config-updated")
        def on_config_updated(event):
            if self.profile_locked:
                return

            config = (event or {}).get("config") or {}
            profile_payload = (event or {}).get("profile") or {}
            self._ingest_profile_payload(profile_payload)

            profile_id = config.get("gameProfileId")
            if profile_id:
                self._set_active_profile(profile_id, "host update")

        @self.client.on("session:closed")
        def on_session_closed(_event):
            log("[virtual-bridge] session closed by host")
            with self.lock:
                self.pad.reset()
            os._exit(0)

    def _handle_join_ack(self, response):
        if not response or not response.get("ok"):
            message = (response or {}).get("error", "unknown")
            log(f"[virtual-bridge] join failed: {message}")
            os._exit(1)

        self._ingest_profile_payload(response.get("profile") or {})

        if not self.profile_locked:
            config = response.get("config") or {}
            requested = config.get("gameProfileId")
            if requested:
                self._set_active_profile(requested, "session config")

        log(f"[virtual-bridge] joined session {self.session_code}")

    def connect_and_wait(self) -> None:
        self.client.connect(self.server_url, transports=["websocket", "polling"])
        self.client.wait()

    def shutdown(self, signal_name: str) -> None:
        log(f"[virtual-bridge] {signal_name} received; shutting down")
        with self.lock:
            self.pad.reset()
        try:
            self.client.disconnect()
        finally:
            os._exit(0)


def main() -> int:
    args = parse_args()
    session_code = normalize_session_code(args.code)
    if not session_code:
        log("Error: --code <SESSION_CODE> is required")
        return 1

    repo_root = Path(__file__).resolve().parents[1]

    try:
        catalog = load_profile_catalog(repo_root)
    except FileNotFoundError:
        log("Error: missing config/profiles.json")
        return 1

    profile_maps = build_profile_maps(catalog)
    default_profile_id = str((catalog.get("defaults") or {}).get("gameProfileId", "platformer"))
    profile_id = resolve_profile_id(args.profile, profile_maps, default_profile_id)

    if not profile_maps:
        log("Error: no virtual profiles available in config/profiles.json")
        return 1

    try:
        import socketio as sio_module
    except Exception as exc:  # pragma: no cover
        log("Error: python-socketio is required.")
        log("Install: pip install \"python-socketio[client]\"")
        log(f"Detail: {exc}")
        return 1

    if args.dry_run:
        pad = DryRunPad()
    else:
        try:
            import vgamepad as vg_module
        except Exception as exc:  # pragma: no cover
            log("Error: vgamepad is required for non-dry-run mode.")
            log("Install: pip install vgamepad")
            log(f"Detail: {exc}")
            return 1

        try:
            if args.device == "xbox":
                pad = XboxPad(vg_module)
            else:
                pad = DualShockPad(vg_module)
        except Exception as exc:
            log("Error: failed to initialize virtual controller device.")
            log("On Linux, ensure /dev/uinput is available and uinput module is loaded.")
            log("On Windows, ensure ViGEmBus driver is installed.")
            log(f"Detail: {exc}")
            return 1

    bridge_name = f"{args.name} ({args.device.upper()})"
    runtime = BridgeRuntime(
        sio_module=sio_module,
        pad=pad,
        server_url=args.server,
        session_code=session_code,
        bridge_name=bridge_name,
        default_profile_id=profile_id,
        profile_maps=profile_maps,
        profile_locked=bool(args.profile),
    )

    log(f"[virtual-bridge] server: {args.server}")
    log(f"[virtual-bridge] session: {session_code}")
    log(f"[virtual-bridge] device: {args.device}")
    log(f"[virtual-bridge] mode: {'dry-run' if args.dry_run else 'virtual-device'}")
    log(f"[virtual-bridge] profile: {profile_id}{' (locked)' if args.profile else ''}")

    signal.signal(signal.SIGINT, lambda *_: runtime.shutdown("SIGINT"))
    signal.signal(signal.SIGTERM, lambda *_: runtime.shutdown("SIGTERM"))

    try:
        runtime.connect_and_wait()
    except KeyboardInterrupt:
        runtime.shutdown("KeyboardInterrupt")
    except Exception as exc:
        log(f"[virtual-bridge] fatal error: {exc}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
