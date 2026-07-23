package org.sharteman.gymcoach.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R

@Composable
fun SettingsDiagnosticsSection(
    eventCount: Int,
    enabled: Boolean,
    onCopy: () -> Unit,
    onExport: () -> Unit,
    onClear: () -> Unit,
) {
    SettingsCard(stringResource(R.string.settings_diagnostics_title)) {
        Text(stringResource(R.string.settings_diagnostics_description, eventCount))
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onCopy,
                    enabled = enabled,
                    modifier = Modifier.weight(1f).testTag("settings-diagnostics-copy"),
                ) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null)
                    Text(stringResource(R.string.settings_diagnostics_copy))
                }
                OutlinedButton(
                    onClick = onExport,
                    enabled = enabled,
                    modifier = Modifier.weight(1f).testTag("settings-diagnostics-export"),
                ) {
                    Icon(Icons.Default.FolderZip, contentDescription = null)
                    Text(stringResource(R.string.settings_diagnostics_export))
                }
            }
            OutlinedButton(
                onClick = onClear,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth().testTag("settings-diagnostics-clear"),
            ) {
                Icon(Icons.Default.DeleteSweep, contentDescription = null)
                Text(stringResource(R.string.settings_diagnostics_clear))
            }
        }
    }
}
