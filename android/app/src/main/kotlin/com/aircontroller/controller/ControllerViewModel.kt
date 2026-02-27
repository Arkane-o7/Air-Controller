package com.aircontroller.controller

import com.aircontroller.network.WsClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ControllerViewModel {
    private val _layout = MutableStateFlow(Layouts.xbox)
    val layout: StateFlow<LayoutDefinition> = _layout.asStateFlow()

    private val _controllerId = MutableStateFlow(-1)
    val controllerId: StateFlow<Int> = _controllerId.asStateFlow()

    fun setControllerInfo(id: Int, layoutWire: String) {
        if (id > 0) _controllerId.value = id
        _layout.value = Layouts.fromWire(layoutWire)
    }

    fun sendButton(wsClient: WsClient, button: String, pressed: Boolean) {
        wsClient.sendButton(button, pressed)
    }

    fun sendStick(wsClient: WsClient, stick: String, x: Float, y: Float) {
        wsClient.sendStick(stick, x, y)
    }

    fun sendTrigger(wsClient: WsClient, trigger: String, value: Float) {
        wsClient.sendTrigger(trigger, value)
    }

    fun sendDpad(wsClient: WsClient, direction: String) {
        wsClient.sendDpad(direction)
    }
}