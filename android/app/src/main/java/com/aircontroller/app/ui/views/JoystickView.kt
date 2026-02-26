package com.aircontroller.app.ui.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Custom view that renders an analog joystick.
 * Reports x, y values in range [-1.0, 1.0].
 */
class JoystickView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    interface JoystickListener {
        fun onJoystickMoved(x: Float, y: Float, viewId: Int)
    }

    var listener: JoystickListener? = null

    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#2A2A2A")
        style = Paint.Style.FILL
    }

    private val baseStrokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#444444")
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }

    private val thumbPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#00C8FF")
        style = Paint.Style.FILL
    }

    private val thumbHighlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#33FFFFFF")
        style = Paint.Style.FILL
    }

    private var centerX = 0f
    private var centerY = 0f
    private var baseRadius = 0f
    private var thumbRadius = 0f
    private var thumbX = 0f
    private var thumbY = 0f
    private var isDragging = false
    private var activePointerId = -1

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        centerX = w / 2f
        centerY = h / 2f
        baseRadius = min(w, h) / 2f * 0.85f
        thumbRadius = baseRadius * 0.35f
        thumbX = centerX
        thumbY = centerY
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // Draw base circle
        canvas.drawCircle(centerX, centerY, baseRadius, basePaint)
        canvas.drawCircle(centerX, centerY, baseRadius, baseStrokePaint)

        // Draw crosshair guides
        val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#333333")
            strokeWidth = 1f
        }
        canvas.drawLine(centerX, centerY - baseRadius * 0.6f, centerX, centerY + baseRadius * 0.6f, guidePaint)
        canvas.drawLine(centerX - baseRadius * 0.6f, centerY, centerX + baseRadius * 0.6f, centerY, guidePaint)

        // Draw thumb
        if (isDragging) {
            canvas.drawCircle(thumbX, thumbY, thumbRadius * 1.1f, thumbHighlightPaint)
        }
        canvas.drawCircle(thumbX, thumbY, thumbRadius, thumbPaint)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                isDragging = true
                activePointerId = event.getPointerId(0)
                updateThumbPosition(event.x, event.y)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (isDragging) {
                    val pointerIndex = event.findPointerIndex(activePointerId)
                    if (pointerIndex >= 0) {
                        updateThumbPosition(event.getX(pointerIndex), event.getY(pointerIndex))
                    }
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                isDragging = false
                activePointerId = -1
                thumbX = centerX
                thumbY = centerY
                invalidate()
                listener?.onJoystickMoved(0f, 0f, id)
                return true
            }
            MotionEvent.ACTION_POINTER_UP -> {
                val pointerIndex = event.actionIndex
                if (event.getPointerId(pointerIndex) == activePointerId) {
                    isDragging = false
                    activePointerId = -1
                    thumbX = centerX
                    thumbY = centerY
                    invalidate()
                    listener?.onJoystickMoved(0f, 0f, id)
                }
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun updateThumbPosition(touchX: Float, touchY: Float) {
        val dx = touchX - centerX
        val dy = touchY - centerY
        val distance = sqrt(dx * dx + dy * dy)
        val maxDistance = baseRadius - thumbRadius

        if (distance <= maxDistance) {
            thumbX = touchX
            thumbY = touchY
        } else {
            val angle = atan2(dy, dx)
            thumbX = centerX + cos(angle) * maxDistance
            thumbY = centerY + sin(angle) * maxDistance
        }

        invalidate()

        // Normalize to [-1, 1]
        val normalizedX = (thumbX - centerX) / maxDistance
        val normalizedY = -(thumbY - centerY) / maxDistance  // Invert Y for gamepad convention
        listener?.onJoystickMoved(normalizedX, normalizedY, id)
    }
}
