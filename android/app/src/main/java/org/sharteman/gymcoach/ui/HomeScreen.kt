package org.sharteman.gymcoach.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Wifi
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.local.LocalSessionEntity
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.WorkoutDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    bootstrap: BootstrapResponse?,
    openSessions: List<LocalSessionEntity>,
    pendingCount: Int,
    online: Boolean,
    syncing: Boolean,
    onStartWorkout: (WorkoutDto, String?) -> Unit,
    onSync: () -> Unit,
    onWebPanel: () -> Unit,
    onLogout: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("GymCoach") },
                actions = {
                    IconButton(onClick = onSync, enabled = online && !syncing) {
                        Icon(Icons.Outlined.Refresh, contentDescription = stringResource(R.string.sync_now))
                    }
                    IconButton(onClick = onWebPanel, enabled = online) {
                        Icon(Icons.Outlined.Language, contentDescription = stringResource(R.string.web_panel))
                    }
                    IconButton(onClick = onLogout, enabled = pendingCount == 0) {
                        Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = stringResource(R.string.logout))
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (online) Icons.Outlined.Wifi else Icons.Outlined.CloudOff,
                        contentDescription = null,
                        tint = if (online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary,
                    )
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(
                            stringResource(if (online) R.string.online else R.string.offline),
                            style = MaterialTheme.typography.labelLarge,
                        )
                        if (pendingCount > 0) {
                            Text(
                                stringResource(R.string.pending_changes, pendingCount),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            item {
                Text(stringResource(R.string.workouts), style = MaterialTheme.typography.titleLarge)
            }
            val workouts = bootstrap?.activeProgram?.workouts.orEmpty()
            if (workouts.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.no_cached_program),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 24.dp),
                    )
                }
            } else {
                items(workouts, key = { it.id }) { workout ->
                    val openSession = openSessions.firstOrNull { it.workoutId == workout.id }
                    WorkoutRow(
                        workout = workout,
                        resume = openSession != null,
                        onClick = {
                            if (openSession != null) {
                                onStartWorkout(workout, openSession.gymId)
                            } else {
                                onStartWorkout(workout, bootstrap?.profile?.activeGymId)
                            }
                        },
                    )
                }
            }
            item { Spacer(Modifier.padding(bottom = 24.dp)) }
        }
    }
}

@Composable
private fun WorkoutRow(workout: WorkoutDto, resume: Boolean, onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(workout.name, style = MaterialTheme.typography.titleMedium)
                Text(
                    pluralStringResource(
                        R.plurals.exercise_count,
                        workout.exercises.size,
                        workout.exercises.size,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(onClick = onClick) {
                Text(stringResource(if (resume) R.string.resume else R.string.start))
            }
        }
    }
}
