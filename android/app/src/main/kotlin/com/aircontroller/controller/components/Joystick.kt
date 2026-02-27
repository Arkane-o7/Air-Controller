package com.aircontroller.controller.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlin.math.sqrt

@Composable
fun Joystick(
    onMove: (x: Float, y: Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val knob = remember { mutableStateOf(Offset.Zero) }

    Canvas(
        modifier = modifier
            .size(150.dp)
            .pointerInput(Unit) {
                val centerOffset = Offset(size.width / 2f, size.height / 2f)
                detectDragGestures(
                    onDragStart = { start ->
                        knob.value = normalizeToRadius(start - centerOffset, 56f)
                        val (nx, ny) = normalized(knob.value, 56f)
                        onMove(nx, ny)
                    },
                    onDrag = { change, _ ->
                        val p = change.position - centerOffset
                        knob.value = normalizeToRadius(p, 56f)
                        val (nx, ny) = normalized(knob.value, 56f)
                        onMove(nx, ny)
                    },
                    onDragEnd = {
                        knob.value = Offset.Zero
                        onMove(0f, 0f)
                    },
                    onDragCancel = {
                        knob.value = Offset.Zero
                        onMove(0f, 0f)
                    }
                )
            }
    ) {
        val bgRadius = size.minDimension / 2f
        val knobRadius = bgRadius / 2.5f
        drawCircle(
            color = Color(0xFF252A3F),
            radius = bgRadius,
            center = center
        )
        drawCircle(
            color = Color(0xFF6C63FF),
            radius = knobRadius,
            center = center + knob.value
        )
    }
}

private fun normalizeToRadius(offset: Offset, radius: Float): Offset {
    val mag = sqrt(offset.x * offset.x + offset.y * offset.y)
    return if (mag <= radius || mag == 0f) offset else {
        val scale = radius / mag
        Offset(offset.x * scale, offset.y * scale)
    }
}

private fun normalized(offset: Offset, radius: Float): Pair<Float, Float> {
    val nx = (offset.x / radius).coerceIn(-1f, 1f)
    val ny = (offset.y / radius).coerceIn(-1f, 1f)
    return nx to ny
}