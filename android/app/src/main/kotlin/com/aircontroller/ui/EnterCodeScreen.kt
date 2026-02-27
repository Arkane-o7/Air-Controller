package com.aircontroller.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aircontroller.network.ConnectionParams
import com.aircontroller.network.DiscoveryService
import kotlinx.coroutines.launch

@Composable
fun EnterCodeScreen(
    onBack: () -> Unit,
    onConnect: (ConnectionParams) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var code by remember { mutableStateOf("") }
    var discoveredIp by remember { mutableStateOf("") }
    var discoveredPort by remember { mutableStateOf(8765) }
    var isDiscovering by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Enter 6-digit code")

        OutlinedTextField(
            value = code,
            onValueChange = { code = it.take(6).filter(Char::isDigit) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Code") },
            placeholder = { Text("123456") },
            singleLine = true
        )

        Button(onClick = {
            scope.launch {
                isDiscovering = true
                message = "Discovering server..."
                try {
                    val params = DiscoveryService(context).discover()
                    discoveredIp = params.ip
                    discoveredPort = params.port
                    if (code.length == 6) {
                        onConnect(ConnectionParams(discoveredIp, discoveredPort, code))
                    } else {
                        message = "Server found: $discoveredIp:$discoveredPort. Enter code to continue."
                    }
                } catch (e: Exception) {
                    message = "Discovery failed: ${e.message ?: "unknown error"}"
                } finally {
                    isDiscovering = false
                }
            }
        }, enabled = !isDiscovering) {
            Text(if (isDiscovering) "Discovering..." else "Find PC on network")
        }

        Button(onClick = {
            if (discoveredIp.isBlank()) {
                message = "Please discover server first"
            } else if (code.length != 6) {
                message = "Enter a valid 6-digit code"
            } else {
                onConnect(ConnectionParams(discoveredIp, discoveredPort, code))
            }
        }) {
            Text("Connect")
        }

        if (message.isNotBlank()) {
            Text(message)
        }

        Button(onClick = onBack) {
            Text("Back")
        }
    }
}