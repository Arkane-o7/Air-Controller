"""
Virtual gamepad manager for AIR Controller.
Creates and manages virtual Xbox 360 controllers using vgamepad.
"""

import vgamepad as vg
import logging
from typing import Optional

logger = logging.getLogger("air_controller.gamepad")


# Button mapping from string names to vgamepad constants
BUTTON_MAP = {
    "a": vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
    "b": vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
    "x": vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
    "y": vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
    "lb": vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
    "rb": vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
    "start": vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
    "select": vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
    "home": vg.XUSB_BUTTON.XUSB_GAMEPAD_GUIDE,
    "ls": vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_THUMB,
    "rs": vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_THUMB,
    "dpad_up": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
    "dpad_down": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
    "dpad_left": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
    "dpad_right": vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
}


class VirtualGamepad:
    """Wraps a single virtual Xbox 360 controller."""

    def __init__(self, player_index: int):
        self.player_index = player_index
        self.gamepad = vg.VX360Gamepad()
        self._active = True
        logger.info(f"Virtual gamepad created for Player {player_index + 1}")

    def press_button(self, button_name: str):
        """Press a button by name."""
        btn = BUTTON_MAP.get(button_name.lower())
        if btn:
            self.gamepad.press_button(button=btn)
            self.gamepad.update()
            logger.debug(f"P{self.player_index + 1}: Button press '{button_name}'")

    def release_button(self, button_name: str):
        """Release a button by name."""
        btn = BUTTON_MAP.get(button_name.lower())
        if btn:
            self.gamepad.release_button(button=btn)
            self.gamepad.update()
            logger.debug(f"P{self.player_index + 1}: Button release '{button_name}'")

    def set_left_joystick(self, x: float, y: float):
        """Set left joystick position. x, y in range [-1.0, 1.0]."""
        x = max(-1.0, min(1.0, x))
        y = max(-1.0, min(1.0, y))
        self.gamepad.left_joystick_float(x_value_float=x, y_value_float=y)
        self.gamepad.update()

    def set_right_joystick(self, x: float, y: float):
        """Set right joystick position. x, y in range [-1.0, 1.0]."""
        x = max(-1.0, min(1.0, x))
        y = max(-1.0, min(1.0, y))
        self.gamepad.right_joystick_float(x_value_float=x, y_value_float=y)
        self.gamepad.update()

    def set_left_trigger(self, value: float):
        """Set left trigger. value in range [0.0, 1.0]."""
        value = max(0.0, min(1.0, value))
        self.gamepad.left_trigger_float(value_float=value)
        self.gamepad.update()

    def set_right_trigger(self, value: float):
        """Set right trigger. value in range [0.0, 1.0]."""
        value = max(0.0, min(1.0, value))
        self.gamepad.right_trigger_float(value_float=value)
        self.gamepad.update()

    def reset(self):
        """Reset all inputs to neutral."""
        self.gamepad.reset()
        self.gamepad.update()

    def close(self):
        """Clean up the virtual gamepad."""
        if self._active:
            self.reset()
            self._active = False
            logger.info(f"Virtual gamepad closed for Player {self.player_index + 1}")


class GamepadManager:
    """Manages multiple virtual gamepads, one per connected controller."""

    def __init__(self, max_controllers: int = 4):
        self.max_controllers = max_controllers
        self._gamepads: dict[int, VirtualGamepad] = {}
        self._next_index = 0

    def create_gamepad(self) -> Optional[VirtualGamepad]:
        """Create a new virtual gamepad. Returns None if max reached."""
        if len(self._gamepads) >= self.max_controllers:
            logger.warning(f"Max controllers ({self.max_controllers}) reached")
            return None

        index = self._next_index
        self._next_index += 1
        gamepad = VirtualGamepad(index)
        self._gamepads[index] = gamepad
        return gamepad

    def remove_gamepad(self, player_index: int):
        """Remove and clean up a virtual gamepad."""
        if player_index in self._gamepads:
            self._gamepads[player_index].close()
            del self._gamepads[player_index]

    def get_gamepad(self, player_index: int) -> Optional[VirtualGamepad]:
        """Get a gamepad by player index."""
        return self._gamepads.get(player_index)

    @property
    def connected_count(self) -> int:
        return len(self._gamepads)

    def close_all(self):
        """Clean up all gamepads."""
        for gamepad in self._gamepads.values():
            gamepad.close()
        self._gamepads.clear()
        logger.info("All virtual gamepads closed")
