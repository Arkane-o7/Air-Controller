package com.aircontroller.network

/**
 * Connection parameters parsed from a QR deep-link URI or discovered via mDNS.
 */
data class ConnectionParams(
    val ip: String,
    val port: Int,
    val code: String
) {
    fun toWebSocketUrl(): String = "ws://$ip:$port"

    companion object {
        /**
         * Parse from the AirController deep-link URI:
         *   aircontroller://connect?ip=<IP>&port=<PORT>&code=<CODE>
         */
        fun fromUri(uriString: String): ConnectionParams? {
            return try {
                val uri = android.net.Uri.parse(uriString)
                val ip = uri.getQueryParameter("ip") ?: return null
                val port = uri.getQueryParameter("port")?.toIntOrNull() ?: return null
                val code = uri.getQueryParameter("code") ?: return null
                ConnectionParams(ip, port, code)
            } catch (e: Exception) {
                null
            }
        }
    }
}
