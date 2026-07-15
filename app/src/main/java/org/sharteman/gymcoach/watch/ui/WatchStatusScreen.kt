package org.sharteman.gymcoach.watch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.watch.domain.WatchProtocol
import org.sharteman.gymcoach.watch.domain.WatchConnectionStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchStatusScreen(onBack: () -> Unit, dataSource: WatchStatusDataSource) {
    val state by dataSource.state.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.watch_status_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.watch_status_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        stringResource(R.string.watch_status_connection_heading),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    StatusRow(
                        stringResource(R.string.watch_status_connection_label),
                        when {
                            !state.transportConfigured -> stringResource(R.string.watch_status_unavailable)
                            state.connectionStatus == WatchConnectionStatus.CONNECTED ->
                                stringResource(R.string.watch_status_connected)
                            state.connectionStatus == WatchConnectionStatus.CONNECTING ->
                                stringResource(R.string.watch_status_connecting)
                            else -> stringResource(R.string.watch_status_disconnected)
                        },
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_sync_label),
                        stringResource(R.string.watch_status_queue_count, state.queuedEvents),
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_peer_revision),
                        state.peerRevision?.toString() ?: stringResource(R.string.watch_status_not_configured),
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_last_sync),
                        state.lastSyncAtEpochMs?.toString() ?: stringResource(R.string.watch_status_not_configured),
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_conflicts),
                        state.conflictCount.toString(),
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_last_error),
                        state.lastErrorCode ?: stringResource(R.string.watch_status_no_error),
                    )
                    StatusRow(
                        stringResource(R.string.watch_status_protocol_label),
                        WatchProtocol.VERSION,
                    )
                }
            }
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                stringResource(R.string.watch_status_sync_setting),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                if (state.transportConfigured) {
                                    stringResource(R.string.watch_status_sync_setting_available)
                                } else {
                                    stringResource(R.string.watch_status_sync_setting_disabled)
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = state.syncEnabled,
                            onCheckedChange = dataSource::setSyncEnabled,
                            enabled = state.transportConfigured,
                        )
                    }
                }
            }
            Text(
                stringResource(R.string.watch_status_toolchain_notice),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value)
    }
}
