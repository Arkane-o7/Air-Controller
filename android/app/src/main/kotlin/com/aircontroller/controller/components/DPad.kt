package com.aircontroller.controller.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun DPad(
    onDirection: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
    ) {
        DPadKey("↑", onPress = { onDirection("up") }, onRelease = { onDirection("none") })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DPadKey("←", onPress = { onDirection("left") }, onRelease = { onDirection("none") })
            DPadKey("•", onPress = { onDirection("none") }, onRelease = { onDirection("none") })
            DPadKey("→", onPress = { onDirection("right") }, onRelease = { onDirection("none") })
        }
        DPadKey("↓", onPress = { onDirection("down") }, onRelease = { onDirection("none") })
    }
}

@Composable
private fun DPadKey(label: String, onPress: () -> Unit, onRelease: () -> Unit) {
    GameButton(
        label = label,
        onPress = onPress,
        onRelease = onRelease,
        modifier = Modifier
            .size(52.dp)
            .background(Color(0xFF2B314A), RoundedCornerShape(12.dp))
    )
}