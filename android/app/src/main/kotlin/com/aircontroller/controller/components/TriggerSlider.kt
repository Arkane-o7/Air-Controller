package com.aircontroller.controller.components

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp

@Composable
fun TriggerSlider(
    label: String,
    onValueChanged: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val value = remember { mutableFloatStateOf(0f) }

    Box(
        modifier = modifier
            .height(140.dp)
            .width(52.dp)
            .background(Color(0xFF252A3F), RoundedCornerShape(16.dp))
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onVerticalDrag = { change, dragAmount ->
                        change.consume()
                        val next = (value.floatValue - dragAmount / 220f).coerceIn(0f, 1f)
                        value.floatValue = next
                        onValueChanged(next)
                    },
                    onDragEnd = {
                        value.floatValue = 0f
                        onValueChanged(0f)
                    },
                    onDragCancel = {
                        value.floatValue = 0f
                        onValueChanged(0f)
                    }
                )
            }
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(value.floatValue)
                .background(Color(0xFF6C63FF), RoundedCornerShape(16.dp))
        )
        Text(text = label, color = Color.White, modifier = Modifier.align(Alignment.Center))
    }
}