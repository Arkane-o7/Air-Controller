package com.aircontroller.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aircontroller.controller.ControllerViewModel
import com.aircontroller.network.ConnectionParams
import com.aircontroller.network.WsClient
import com.aircontroller.network.WsState

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val initialParams = intent?.dataString?.let { ConnectionParams.fromUri(it) }

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AirControllerApp(initialParams = initialParams)
                }
            }
        }
    }
}

@Composable
private fun AirControllerApp(initialParams: ConnectionParams?) {
    val navController = rememberNavController()
    val controllerViewModel = remember { ControllerViewModel() }

    var wsClient by remember { mutableStateOf<WsClient?>(null) }
    var wsState by remember { mutableStateOf<WsState>(WsState.Disconnected) }

    fun connect(params: ConnectionParams) {
        wsClient?.disconnect()
        val client = WsClient(params) { state ->
            wsState = state
            if (state is WsState.Connected) {
                controllerViewModel.setControllerInfo(state.controllerId, state.layout)
                navController.navigate("controller") {
                    launchSingleTop = true
                }
            }
        }
        wsClient = client
        client.connect()
    }

    LaunchedEffect(initialParams) {
        if (initialParams != null) {
            connect(initialParams)
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (initialParams == null) "connect" else "connect"
    ) {
        composable("connect") {
            ConnectScreen(
                wsState = wsState,
                onScanQr = { navController.navigate("scan") },
                onEnterCode = { navController.navigate("enter") }
            )
        }

        composable("scan") {
            ScanQrScreen(
                onBack = { navController.popBackStack() },
                onParsed = { params -> connect(params) }
            )
        }

        composable("enter") {
            EnterCodeScreen(
                onBack = { navController.popBackStack() },
                onConnect = { params -> connect(params) }
            )
        }

        composable("controller") {
            ControllerScreen(
                wsClient = wsClient,
                wsState = wsState,
                viewModel = controllerViewModel,
                onDisconnect = {
                    wsClient?.disconnect()
                    wsState = WsState.Disconnected
                    navController.navigate("connect") {
                        popUpTo("connect") { inclusive = true }
                    }
                }
            )
        }
    }
}