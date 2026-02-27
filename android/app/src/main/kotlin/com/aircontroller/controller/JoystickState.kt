package com.aircontroller.controller

import androidx.compose.ui.geometry.Offset

data class JoystickState(
    val isDragging: Boolean = false,
    val center: Offset = Offset.Zero,
    val knob: Offset = Offset.Zero,
    val normalizedX: Float = 0f,
    val normalizedY: Float = 0f
)