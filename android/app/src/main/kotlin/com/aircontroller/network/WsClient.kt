package com.aircontroller.network

import android.util.Log
import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

private const val TAG = "WsClient"

sealed class WsState {
    data object Connecting : WsState()
    data class Connected(val controllerId: Int, val layout: String) : WsState()
    data class Rejected(val reason: String) : WsState()
    data object Disconnected : WsState()
    data class Error(val message: String) : WsState()
}

/**
 * Manages the WebSocket connection to the AirController PC server.
 * Thread-safe — all callbacks are delivered on OkHttp's internal thread pool.
 */
class WsClient(
    private val params: ConnectionParams,
    private val onStateChange: (WsState) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .pingInterval(5, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null

    fun connect() {
        emitState(WsState.Connecting)
        val request = Request.Builder().url(params.toWebSocketUrl()).build()
        ws = client.newWebSocket(request, listener)
    }

    fun disconnect() {
        ws?.close(1000, "User disconnected")
        ws = null
    }

    // ── Input senders ─────────────────────────────────────────────────────────

    fun sendButton(button: String, pressed: Boolean) {
        send(JSONObject().apply {
            put("type", "button")
            put("button", button)
            put("state", if (pressed) "pressed" else "released")
        })
    }

    fun sendStick(stick: String, x: Float, y: Float) {
        send(JSONObject().apply {
            put("type", "stick")
            put("stick", stick)
            put("x", x.toDouble())
            put("y", y.toDouble())
        })
    }

    fun sendTrigger(trigger: String, value: Float) {
        send(JSONObject().apply {
            put("type", "trigger")
            put("trigger", trigger)
            put("value", value.toDouble())
        })
    }

    fun sendDpad(direction: String) {
        send(JSONObject().apply {
            put("type", "dpad")
            put("direction", direction)
        })
    }

    private fun send(json: JSONObject) {
        ws?.send(json.toString())
    }

    private fun emitState(state: WsState) {
        mainHandler.post { onStateChange(state) }
    }

    // ── WebSocket listener ────────────────────────────────────────────────────

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.d(TAG, "Connected — sending pair")
            webSocket.send(JSONObject().apply {
                put("type", "pair")
                put("code", params.code)
            }.toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val json = JSONObject(text)
                when (json.optString("type")) {
                    "welcome" -> {
                        val id = json.getInt("controllerId")
                        val layout = json.getString("layout")
                        Log.d(TAG, "Paired as controller $id with layout $layout")
                        emitState(WsState.Connected(id, layout))
                    }
                    "reject" -> {
                        val reason = json.optString("reason", "unknown")
                        Log.w(TAG, "Rejected: $reason")
                        emitState(WsState.Rejected(reason))
                        webSocket.close(1000, reason)
                    }
                    "layout_change" -> {
                        // Re-emit as a new Connected state with updated layout
                        val layout = json.getString("layout")
                        emitState(WsState.Connected(-1, layout))
                    }
                    "ping" -> webSocket.send("{\"type\":\"pong\"}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Message parse error", e)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            emitState(WsState.Disconnected)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "WebSocket failure", t)
            emitState(WsState.Error(t.message ?: "Connection error"))
        }
    }
}
