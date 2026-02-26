package com.aircontroller.app.ui

import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.aircontroller.app.R
import com.aircontroller.app.network.ControllerWebSocket
import com.aircontroller.app.ui.views.JoystickView
import java.net.URI
import java.util.Timer
import java.util.TimerTask

/**
 * Main controller screen shown in landscape mode.
 * Displays dual joysticks, ABXY buttons, D-pad, triggers, and system buttons.
 */
class ControllerActivity : AppCompatActivity(), ControllerWebSocket.WebSocketListener {

    private lateinit var tvPlayerInfo: TextView
    private lateinit var tvConnectionStatus: TextView
    private lateinit var leftJoystick: JoystickView
    private lateinit var rightJoystick: JoystickView

    // ABXY Buttons
    private lateinit var btnA: ImageButton
    private lateinit var btnB: ImageButton
    private lateinit var btnX: ImageButton
    private lateinit var btnY: ImageButton

    // D-pad
    private lateinit var btnDpadUp: ImageButton
    private lateinit var btnDpadDown: ImageButton
    private lateinit var btnDpadLeft: ImageButton
    private lateinit var btnDpadRight: ImageButton

    // Triggers & Bumpers
    private lateinit var btnLB: Button
    private lateinit var btnRB: Button
    private lateinit var btnLT: Button
    private lateinit var btnRT: Button

    // System buttons
    private lateinit var btnStart: Button
    private lateinit var btnSelect: Button

    private var webSocket: ControllerWebSocket? = null
    private var heartbeatTimer: Timer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var vibrator: Vibrator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_controller)
        hideSystemUI()

        // Get vibrator
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }

        initViews()
        setupListeners()
        connectToServer()
    }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            )
        }
    }

    private fun initViews() {
        tvPlayerInfo = findViewById(R.id.tv_player_info)
        tvConnectionStatus = findViewById(R.id.tv_connection_status)
        leftJoystick = findViewById(R.id.joystick_left)
        rightJoystick = findViewById(R.id.joystick_right)

        btnA = findViewById(R.id.btn_a)
        btnB = findViewById(R.id.btn_b)
        btnX = findViewById(R.id.btn_x)
        btnY = findViewById(R.id.btn_y)

        btnDpadUp = findViewById(R.id.btn_dpad_up)
        btnDpadDown = findViewById(R.id.btn_dpad_down)
        btnDpadLeft = findViewById(R.id.btn_dpad_left)
        btnDpadRight = findViewById(R.id.btn_dpad_right)

        btnLB = findViewById(R.id.btn_lb)
        btnRB = findViewById(R.id.btn_rb)
        btnLT = findViewById(R.id.btn_lt)
        btnRT = findViewById(R.id.btn_rt)

        btnStart = findViewById(R.id.btn_start)
        btnSelect = findViewById(R.id.btn_select)

        val playerName = intent.getStringExtra("player_name") ?: "Player"
        tvPlayerInfo.text = playerName
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupListeners() {
        // Joysticks
        leftJoystick.listener = object : JoystickView.JoystickListener {
            override fun onJoystickMoved(x: Float, y: Float, viewId: Int) {
                webSocket?.sendJoystick("left", x, y)
            }
        }

        rightJoystick.listener = object : JoystickView.JoystickListener {
            override fun onJoystickMoved(x: Float, y: Float, viewId: Int) {
                webSocket?.sendJoystick("right", x, y)
            }
        }

        // ABXY buttons
        setupButtonTouch(btnA, "a")
        setupButtonTouch(btnB, "b")
        setupButtonTouch(btnX, "x")
        setupButtonTouch(btnY, "y")

        // D-pad
        setupDpadTouch(btnDpadUp, "up")
        setupDpadTouch(btnDpadDown, "down")
        setupDpadTouch(btnDpadLeft, "left")
        setupDpadTouch(btnDpadRight, "right")

        // Bumpers
        setupButtonTouch(btnLB, "lb")
        setupButtonTouch(btnRB, "rb")

        // Triggers (using touch for analog-like behavior)
        setupTriggerTouch(btnLT, "left")
        setupTriggerTouch(btnRT, "right")

        // System buttons
        setupButtonTouch(btnStart, "start")
        setupButtonTouch(btnSelect, "select")
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupButtonTouch(view: View, buttonName: String) {
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    vibrateLight()
                    webSocket?.sendButton(buttonName, true)
                    view.isPressed = true
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    webSocket?.sendButton(buttonName, false)
                    view.isPressed = false
                    true
                }
                else -> false
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupDpadTouch(view: View, direction: String) {
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    vibrateLight()
                    webSocket?.sendDpad(direction, true)
                    view.isPressed = true
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    webSocket?.sendDpad(direction, false)
                    view.isPressed = false
                    true
                }
                else -> false
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupTriggerTouch(view: View, trigger: String) {
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    vibrateLight()
                    webSocket?.sendTrigger(trigger, 1.0f)
                    view.isPressed = true
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    webSocket?.sendTrigger(trigger, 0.0f)
                    view.isPressed = false
                    true
                }
                else -> false
            }
        }
    }

    private fun vibrateLight() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createOneShot(20, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(20)
        }
    }

    private fun connectToServer() {
        val serverUri = intent.getStringExtra("server_uri") ?: return

        tvConnectionStatus.text = "Connecting..."
        tvConnectionStatus.setTextColor(0xFFFFAA00.toInt())

        webSocket = ControllerWebSocket(URI(serverUri), this)
        webSocket?.connect()
    }

    private fun startHeartbeat() {
        heartbeatTimer?.cancel()
        heartbeatTimer = Timer().apply {
            scheduleAtFixedRate(object : TimerTask() {
                override fun run() {
                    webSocket?.sendHeartbeat()
                }
            }, 0, 5000)
        }
    }

    // --- WebSocketListener callbacks ---

    override fun onConnected(playerIndex: Int, playerName: String) {
        handler.post {
            tvPlayerInfo.text = playerName
            tvConnectionStatus.text = "● Connected"
            tvConnectionStatus.setTextColor(0xFF00FF88.toInt())
            startHeartbeat()
        }
    }

    override fun onDisconnected(reason: String) {
        handler.post {
            tvConnectionStatus.text = "● Disconnected"
            tvConnectionStatus.setTextColor(0xFFFF4444.toInt())
            heartbeatTimer?.cancel()
            Toast.makeText(this, "Disconnected: $reason", Toast.LENGTH_SHORT).show()

            // Try to reconnect after a delay
            handler.postDelayed({ connectToServer() }, 3000)
        }
    }

    override fun onError(error: String) {
        handler.post {
            tvConnectionStatus.text = "● Error"
            tvConnectionStatus.setTextColor(0xFFFF4444.toInt())
            Toast.makeText(this, "Error: $error", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onPlayerCountChanged(count: Int, max: Int) {
        // Could update UI to show connected players
    }

    override fun onServerFull(message: String) {
        handler.post {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        heartbeatTimer?.cancel()
        webSocket?.close()
    }
}
