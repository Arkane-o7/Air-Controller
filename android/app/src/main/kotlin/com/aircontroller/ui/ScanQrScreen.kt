package com.aircontroller.ui

import android.Manifest
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.aircontroller.network.ConnectionParams
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.PermissionStatus
import com.google.accompanist.permissions.rememberPermissionState
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun ScanQrScreen(
    onBack: () -> Unit,
    onParsed: (ConnectionParams) -> Unit
) {
    val cameraPermission = rememberPermissionState(Manifest.permission.CAMERA)
    val haptics = LocalHapticFeedback.current
    var deepLink by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val scannerLock = remember { AtomicBoolean(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Scan QR code")

        when (cameraPermission.status) {
            is PermissionStatus.Granted -> {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(280.dp)
                        .background(Color(0xFF111111)),
                    contentAlignment = Alignment.Center
                ) {
                    QrCameraPreview(
                        onQrDetected = { raw ->
                            if (!scannerLock.compareAndSet(false, true)) return@QrCameraPreview
                            val parsed = ConnectionParams.fromUri(raw)
                            if (parsed != null) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                onParsed(parsed)
                            } else {
                                error = "QR code is not a valid AirController link"
                                scannerLock.set(false)
                            }
                        }
                    )
                }
                Text("Point camera at the QR shown in desktop app")
            }

            is PermissionStatus.Denied -> {
                Text("Camera permission is required for QR scanning")
                Button(onClick = { cameraPermission.launchPermissionRequest() }) {
                    Text("Grant camera permission")
                }
            }
        }

        Text("Manual fallback: paste deep-link")

        OutlinedTextField(
            value = deepLink,
            onValueChange = {
                deepLink = it
                error = ""
            },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("aircontroller://connect?ip=...") },
            singleLine = false
        )

        if (error.isNotBlank()) {
            Text(error)
        }

        Button(onClick = {
            val parsed = ConnectionParams.fromUri(deepLink)
            if (parsed == null) {
                error = "Invalid deep-link format"
            } else {
                onParsed(parsed)
            }
        }) {
            Text("Connect")
        }

        Button(onClick = onBack) {
            Text("Back")
        }
    }
}

@Composable
private fun QrCameraPreview(
    onQrDetected: (String) -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose {
            cameraExecutor.shutdown()
        }
    }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()

                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }

                val barcodeScanner = BarcodeScanning.getClient()
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(cameraExecutor) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage == null) {
                        imageProxy.close()
                        return@setAnalyzer
                    }

                    val input = InputImage.fromMediaImage(
                        mediaImage,
                        imageProxy.imageInfo.rotationDegrees
                    )

                    barcodeScanner.process(input)
                        .addOnSuccessListener { barcodes ->
                            barcodes.firstOrNull { it.valueType == Barcode.TYPE_TEXT }
                                ?.rawValue
                                ?.takeIf { it.startsWith("aircontroller://") }
                                ?.let { onQrDetected(it) }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                }

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis
                )
            }, androidx.core.content.ContextCompat.getMainExecutor(ctx))

            previewView
        },
        modifier = Modifier.fillMaxSize()
    )
}
