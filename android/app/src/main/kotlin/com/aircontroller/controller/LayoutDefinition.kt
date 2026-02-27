package com.aircontroller.controller

enum class LayoutType {
    XBOX,
    SIMPLE,
    CUSTOM
}

data class LayoutDefinition(
    val type: LayoutType,
    val showLeftStick: Boolean,
    val showRightStick: Boolean,
    val showTriggers: Boolean,
    val showFaceButtons: Boolean,
    val showDpad: Boolean
)

object Layouts {
    val xbox = LayoutDefinition(
        type = LayoutType.XBOX,
        showLeftStick = true,
        showRightStick = true,
        showTriggers = true,
        showFaceButtons = true,
        showDpad = true
    )

    val simple = LayoutDefinition(
        type = LayoutType.SIMPLE,
        showLeftStick = true,
        showRightStick = false,
        showTriggers = false,
        showFaceButtons = true,
        showDpad = true
    )

    val custom = LayoutDefinition(
        type = LayoutType.CUSTOM,
        showLeftStick = true,
        showRightStick = true,
        showTriggers = true,
        showFaceButtons = true,
        showDpad = true
    )

    fun fromWire(layout: String): LayoutDefinition = when (layout.lowercase()) {
        "xbox" -> xbox
        "simple" -> simple
        "custom" -> custom
        else -> xbox
    }
}