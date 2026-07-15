@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.sharteman.gymcoach.watch.ui.diagnostics

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus

@Composable
internal fun WatchDiagnosticsRoute(onBack: () -> Unit) {
    val dataSource = remember { DebugWatchDiagnosticsDataSource() }
    DisposableEffect(dataSource) {
        onDispose(dataSource::close)
    }
    WatchDiagnosticsScreen(onBack = onBack, dataSource = dataSource)
}

@Composable
internal fun WatchDiagnosticsScreen(
    onBack: () -> Unit,
    dataSource: WatchDiagnosticsDataSource,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snapshot by dataSource.snapshot.collectAsState()
    var exportPayload by remember { mutableStateOf<String?>(null) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var actionRunning by remember { mutableStateOf(false) }
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val payload = exportPayload
        exportPayload = null
        if (uri != null && payload != null) {
            scope.launch {
                runCatching { writeDiagnosticExport(context, uri, payload) }
                    .onSuccess { feedback = context.getString(R.string.watch_diagnostics_export_saved) }
                    .onFailure { feedback = context.getString(R.string.watch_diagnostics_export_failed) }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.watch_diagnostics_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .testTag("watch-diagnostics-screen"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { Spacer(Modifier.height(1.dp)) }
            item {
                DiagnosticsCard(stringResource(R.string.watch_diagnostics_connection)) {
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_status),
                        connectionLabel(snapshot.connectionStatus),
                    )
                    DiagnosticRow(stringResource(R.string.watch_diagnostics_model), snapshot.watchModel)
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_watch_version),
                        snapshot.watchAppVersion,
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_protocol_version),
                        snapshot.protocolVersion,
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_last_sync),
                        formatTimestamp(snapshot.lastSyncAt),
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_latency),
                        snapshot.messageLatencyMs?.let {
                            stringResource(R.string.watch_diagnostics_milliseconds, it)
                        } ?: stringResource(R.string.watch_diagnostics_not_available),
                    )
                }
            }
            item {
                DiagnosticsCard(stringResource(R.string.watch_diagnostics_sync)) {
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_unacknowledged),
                        snapshot.unacknowledgedEventCount.toString(),
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_queue_size),
                        snapshot.queueSize.toString(),
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_conflicts),
                        snapshot.conflictCount.toString(),
                    )
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_last_error),
                        snapshot.lastErrorCode ?: stringResource(R.string.watch_diagnostics_no_error),
                    )
                    Button(
                        onClick = {
                            scope.launch {
                                actionRunning = true
                                feedback = null
                                runCatching { dataSource.forceSync() }
                                    .onSuccess {
                                        feedback = context.getString(R.string.watch_diagnostics_sync_requested)
                                    }
                                    .onFailure {
                                        feedback = context.getString(R.string.watch_diagnostics_sync_failed)
                                    }
                                actionRunning = false
                            }
                        },
                        enabled = !actionRunning && !snapshot.isSyncRunning,
                        modifier = Modifier.testTag("watch-diagnostics-force-sync"),
                    ) {
                        if (actionRunning || snapshot.isSyncRunning) {
                            CircularProgressIndicator(
                                modifier = Modifier.padding(end = 8.dp).height(18.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(Icons.Default.Sync, contentDescription = null)
                        }
                        Text(
                            stringResource(R.string.watch_diagnostics_force_sync),
                            Modifier.padding(start = 6.dp),
                        )
                    }
                }
            }
            item {
                DiagnosticsCard(stringResource(R.string.watch_diagnostics_sensors)) {
                    DiagnosticRow(
                        stringResource(R.string.watch_diagnostics_current_heart_rate),
                        snapshot.currentHeartRateBpm?.let {
                            stringResource(R.string.watch_diagnostics_bpm, it.toInt())
                        } ?: stringResource(R.string.watch_diagnostics_not_available),
                    )
                    snapshot.supportedSensors.forEach { sensor ->
                        DiagnosticRow(sensor.type, sensorSupportLabel(sensor.support))
                    }
                    Text(
                        stringResource(R.string.watch_diagnostics_sensor_notice),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            item {
                DiagnosticsCard(stringResource(R.string.watch_diagnostics_export)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.BugReport, contentDescription = null)
                        Text(
                            stringResource(R.string.watch_diagnostics_export_notice),
                            modifier = Modifier.padding(start = 8.dp),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            exportPayload = dataSource.exportRedacted()
                            exportLauncher.launch("gymcoach-watch-diagnostics.json")
                        },
                        modifier = Modifier.testTag("watch-diagnostics-export"),
                    ) {
                        Icon(Icons.Default.FileDownload, contentDescription = null)
                        Text(
                            stringResource(R.string.watch_diagnostics_export_action),
                            Modifier.padding(start = 6.dp),
                        )
                    }
                }
            }
            feedback?.let { message ->
                item {
                    Text(
                        text = message,
                        modifier = Modifier.padding(horizontal = 16.dp).testTag("watch-diagnostics-feedback"),
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

@Composable
private fun DiagnosticsCard(title: String, content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun DiagnosticRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(text = value, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun connectionLabel(status: WatchConnectionStatus): String = when (status) {
    WatchConnectionStatus.DISCONNECTED -> stringResource(R.string.watch_diagnostics_disconnected)
    WatchConnectionStatus.CONNECTING -> stringResource(R.string.watch_diagnostics_connecting)
    WatchConnectionStatus.CONNECTED -> stringResource(R.string.watch_diagnostics_connected)
}

@Composable
private fun sensorSupportLabel(support: WatchSensorSupport): String = when (support) {
    WatchSensorSupport.AVAILABLE -> stringResource(R.string.watch_diagnostics_sensor_available)
    WatchSensorSupport.DEBUG_SIMULATED -> stringResource(R.string.watch_diagnostics_sensor_simulated)
    WatchSensorSupport.UNAVAILABLE -> stringResource(R.string.watch_diagnostics_sensor_unavailable)
}

@Composable
private fun formatTimestamp(timestamp: Long?): String {
    if (timestamp == null) return stringResource(R.string.watch_diagnostics_never)
    val formatter = remember(Locale.getDefault()) {
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .withZone(ZoneId.systemDefault())
    }
    return formatter.format(Instant.ofEpochMilli(timestamp))
}

private suspend fun writeDiagnosticExport(context: Context, uri: Uri, payload: String) {
    withContext(Dispatchers.IO) {
        checkNotNull(context.contentResolver.openOutputStream(uri)).use { output ->
            output.write(payload.toByteArray(Charsets.UTF_8))
        }
    }
}
