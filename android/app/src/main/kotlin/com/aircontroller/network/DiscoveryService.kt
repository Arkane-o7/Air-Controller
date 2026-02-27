package com.aircontroller.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "DiscoveryService"
private const val SERVICE_TYPE = "_aircontroller._tcp."
private const val DISCOVERY_TIMEOUT_MS = 10_000L

/**
 * Discovers an AirController server on the local network using Android NSD (mDNS).
 * Resolves the first matching service and returns its ConnectionParams.
 */
class DiscoveryService(private val context: Context) {

    private val nsdManager: NsdManager =
        context.getSystemService(Context.NSD_SERVICE) as NsdManager

    /**
     * Discovers the server and returns ConnectionParams. Throws if not found within timeout.
     */
    suspend fun discover(): ConnectionParams = withTimeout(DISCOVERY_TIMEOUT_MS) {
        suspendCancellableCoroutine { cont ->
            var discoveryListener: NsdManager.DiscoveryListener? = null

            discoveryListener = object : NsdManager.DiscoveryListener {
                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.e(TAG, "Discovery start failed: $errorCode")
                    cont.resumeWithException(Exception("Discovery failed: $errorCode"))
                }

                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}

                override fun onDiscoveryStarted(serviceType: String) {
                    Log.d(TAG, "Discovery started")
                }

                override fun onDiscoveryStopped(serviceType: String) {}

                override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                    Log.d(TAG, "Service found: ${serviceInfo.serviceName}")
                    // Stop further discovery once we found one
                    nsdManager.stopServiceDiscovery(discoveryListener!!)

                    nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(si: NsdServiceInfo, errorCode: Int) {
                            Log.e(TAG, "Resolve failed: $errorCode")
                            cont.resumeWithException(Exception("Resolve failed: $errorCode"))
                        }

                        override fun onServiceResolved(si: NsdServiceInfo) {
                            Log.d(TAG, "Resolved: ${si.host}:${si.port}")
                            val ip = si.host?.hostAddress ?: run {
                                cont.resumeWithException(Exception("No host address"))
                                return
                            }
                            // Extract code from TXT record if present; user will confirm it manually
                            val txtCode = si.attributes["code"]
                                ?.let { String(it) } ?: ""
                            cont.resume(ConnectionParams(ip = ip, port = si.port, code = txtCode))
                        }
                    })
                }

                override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            }

            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)

            cont.invokeOnCancellation {
                try { nsdManager.stopServiceDiscovery(discoveryListener) } catch (_: Exception) {}
            }
        }
    }
}
