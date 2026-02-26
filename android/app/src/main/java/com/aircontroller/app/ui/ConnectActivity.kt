package com.aircontroller.app.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.aircontroller.app.R
import com.aircontroller.app.network.ControllerWebSocket
import org.java_websocket.client.WebSocketClient
import java.net.URI

/**
 * Connection screen where user enters the server IP/port or scans QR code.
 */
class ConnectActivity : AppCompatActivity() {

    private lateinit var etServerIp: EditText
    private lateinit var etServerPort: EditText
    private lateinit var btnConnect: Button
    private lateinit var tvStatus: TextView
    private lateinit var progressBar: ProgressBar

    private var webSocket: ControllerWebSocket? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_connect)

        etServerIp = findViewById(R.id.et_server_ip)
        etServerPort = findViewById(R.id.et_server_port)
        btnConnect = findViewById(R.id.btn_connect)
        tvStatus = findViewById(R.id.tv_status)
        progressBar = findViewById(R.id.progress_bar)

        btnConnect.setOnClickListener {
            connect()
        }
    }

    private fun connect() {
        val ip = etServerIp.text.toString().trim()
        val port = etServerPort.text.toString().trim().ifEmpty { "8765" }

        if (ip.isEmpty()) {
            etServerIp.error = "Enter server IP address"
            return
        }

        btnConnect.isEnabled = false
        progressBar.visibility = View.VISIBLE
        tvStatus.text = "Connecting to $ip:$port..."

        val uri = URI("ws://$ip:$port")
        webSocket = ControllerWebSocket(uri, object : ControllerWebSocket.WebSocketListener {
            override fun onConnected(playerIndex: Int, playerName: String) {
                runOnUiThread {
                    progressBar.visibility = View.GONE
                    tvStatus.text = "Connected as $playerName!"

                    // Pass connection info to ControllerActivity
                    val intent = Intent(this@ConnectActivity, ControllerActivity::class.java).apply {
                        putExtra("server_uri", uri.toString())
                        putExtra("player_index", playerIndex)
                        putExtra("player_name", playerName)
                    }

                    // Close this websocket - ControllerActivity will create its own
                    webSocket?.close()
                    webSocket = null

                    startActivity(intent)
                    finish()
                }
            }

            override fun onDisconnected(reason: String) {
                runOnUiThread {
                    btnConnect.isEnabled = true
                    progressBar.visibility = View.GONE
                    tvStatus.text = "Disconnected: $reason"
                }
            }

            override fun onError(error: String) {
                runOnUiThread {
                    btnConnect.isEnabled = true
                    progressBar.visibility = View.GONE
                    tvStatus.text = "Error: $error"
                    Toast.makeText(this@ConnectActivity, "Connection failed: $error", Toast.LENGTH_LONG).show()
                }
            }

            override fun onPlayerCountChanged(count: Int, max: Int) {
                // Not used on connect screen
            }

            override fun onServerFull(message: String) {
                runOnUiThread {
                    btnConnect.isEnabled = true
                    progressBar.visibility = View.GONE
                    tvStatus.text = message
                    Toast.makeText(this@ConnectActivity, message, Toast.LENGTH_LONG).show()
                }
            }
        })

        webSocket?.connect()
    }

    override fun onDestroy() {
        super.onDestroy()
        webSocket?.close()
    }
}
