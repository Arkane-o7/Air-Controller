package com.aircontroller.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.aircontroller.controller.ControllerViewModel
import com.aircontroller.controller.components.DPad
import com.aircontroller.controller.components.GameButton
import com.aircontroller.controller.components.Joystick
import com.aircontroller.controller.components.TriggerSlider
import com.aircontroller.network.WsClient
import com.aircontroller.network.WsState

@Composable
fun ControllerScreen(
    wsClient: WsClient?,
    wsState: WsState,
    viewModel: ControllerViewModel,
    onDisconnect: () -> Unit
) {
    val layout by viewModel.layout.collectAsState()
    val controllerId by viewModel.controllerId.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Controller P${if (controllerId > 0) controllerId else "?"} • ${layout.type.name}")
            Button(onClick = onDisconnect) { Text("Disconnect") }
        }

        if (wsState is WsState.Connected || wsState is WsState.Connecting) {
            Box(modifier = Modifier.fillMaxSize()) {
                if (layout.showTriggers) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        TriggerSlider(label = "LT") { v ->
                            wsClient?.let { viewModel.sendTrigger(it, "left", v) }
                        }
                        TriggerSlider(label = "RT") { v ->
                            wsClient?.let { viewModel.sendTrigger(it, "right", v) }
                        }
                    }
                }

                Row(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(top = 90.dp, bottom = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (layout.showLeftStick) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Joystick { x, y ->
                                wsClient?.let { viewModel.sendStick(it, "left", x, y) }
                            }
                        }
                    } else {
                        Box(modifier = Modifier.weight(1f))
                    }

                    if (layout.showDpad) {
                        DPad { direction ->
                            wsClient?.let { viewModel.sendDpad(it, direction) }
                        }
                    }

                    if (layout.showFaceButtons) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GameButton(
                                    label = "Y",
                                    onPress = { wsClient?.let { viewModel.sendButton(it, "Y", true) } },
                                    onRelease = { wsClient?.let { viewModel.sendButton(it, "Y", false) } }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GameButton(
                                    label = "X",
                                    onPress = { wsClient?.let { viewModel.sendButton(it, "X", true) } },
                                    onRelease = { wsClient?.let { viewModel.sendButton(it, "X", false) } }
                                )
                                GameButton(
                                    label = "B",
                                    onPress = { wsClient?.let { viewModel.sendButton(it, "B", true) } },
                                    onRelease = { wsClient?.let { viewModel.sendButton(it, "B", false) } }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                GameButton(
                                    label = "A",
                                    onPress = { wsClient?.let { viewModel.sendButton(it, "A", true) } },
                                    onRelease = { wsClient?.let { viewModel.sendButton(it, "A", false) } }
                                )
                            }
                        }
                    }

                    if (layout.showRightStick) {
                        Joystick { x, y ->
                            wsClient?.let { viewModel.sendStick(it, "right", x, y) }
                        }
                    }
                }
            }
        } else {
            Column {
                Text("Not connected")
                Text("Go back and connect to a host")
            }
        }
    }
}