package com.aircontroller.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aircontroller.network.WsState

@Composable
fun ConnectScreen(
    wsState: WsState,
    onScanQr: () -> Unit,
    onEnterCode: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "AirController",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Use your phone as a game controller",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 24.dp)
        )

        Button(onClick = onScanQr, modifier = Modifier.padding(vertical = 6.dp)) {
            Text("Scan QR code")
        }
        Button(onClick = onEnterCode, modifier = Modifier.padding(vertical = 6.dp)) {
            Text("Enter 6-digit code")
        }

        val statusText = when (wsState) {
            is WsState.Connecting -> "Connecting..."
            is WsState.Connected -> "Connected as controller ${wsState.controllerId}"
            is WsState.Rejected -> "Connection rejected: ${wsState.reason}"
            is WsState.Error -> "Error: ${wsState.message}"
            WsState.Disconnected -> ""
        }

        if (statusText.isNotBlank()) {
            Text(
                text = statusText,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 22.dp)
            )
        }
    }
}