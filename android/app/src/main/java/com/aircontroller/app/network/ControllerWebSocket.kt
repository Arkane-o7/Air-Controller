package com.aircontroller.app.network

import android.util.Log
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONObject
import java.net.URI

/**
 * WebSocket client that connects to the AIR Controller server.
 * Sends controller input events and handles server messages.
 */
class ControllerWebSocket(
    serverUri: URI,
    private val listener: WebSocketListener
) : WebSocketClient(serverUri) {

    companion object {
        private const val TAG = "ControllerWebSocket"
    }

    interface WebSocketListener {
        fun onConnected(playerIndex: Int, playerName: String)
        fun onDisconnected(reason: String)
        fun onError(error: String)
        fun onPlayerCountChanged(count: Int, max: Int)
        fun onServerFull(message: String)
    }

    override fun onOpen(handshakedata: ServerHandshake?) {
        Log.i(TAG, "WebSocket connected")
    }

    override fun onMessage(message: String?) {
        message ?: return
        try {
            val json = JSONObject(message)
            when (json.optString("type")) {
                "server_info" -> {
                    val playerIndex = json.getInt("player_index")
                    val playerName = json.getString("player_name")
                    listener.onConnected(playerIndex, playerName)
                }
                "player_count" -> {
                    val count = json.getInt("count")
                    val max = json.getInt("max")
                    listener.onPlayerCountChanged(count, max)
                }
                "error" -> {
                    val errorMsg = json.getString("message")
                    listener.onServerFull(errorMsg)
                }
                "heartbeat" -> {
                    // Server acknowledged heartbeat
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing message: $message", e)
        }
    }

    override fun onClose(code: Int, reason: String?, remote: Boolean) {
        Log.i(TAG, "WebSocket closed: $reason (code=$code, remote=$remote)")
        listener.onDisconnected(reason ?: "Connection closed")
    }

    override fun onError(ex: Exception?) {
        Log.e(TAG, "WebSocket error", ex)
        listener.onError(ex?.message ?: "Unknown error")
    }

    // --- Input sending methods ---

    fun sendButton(button: String, pressed: Boolean) {
        sendJson(JSONObject().apply {
            put("type", "button")
            put("button", button)
            put("pressed", pressed)
        })
    }

    fun sendJoystick(stick: String, x: Float, y: Float) {
        sendJson(JSONObject().apply {
            put("type", "joystick")
            put("stick", stick)
            put("x", x)
            put("y", y)
        })
    }

    fun sendTrigger(trigger: String, value: Float) {
        sendJson(JSONObject().apply {
            put("type", "trigger")
            put("trigger", trigger)
            put("value", value)
        })
    }

    fun sendDpad(direction: String, pressed: Boolean) {
        sendJson(JSONObject().apply {
            put("type", "dpad")
            put("direction", direction)
            put("pressed", pressed)
        })
    }

    fun sendHeartbeat() {
        sendJson(JSONObject().apply {
            put("type", "heartbeat")
        })
    }

    private fun sendJson(json: JSONObject) {
        if (isOpen) {
            send(json.toString())
        }
    }
}
