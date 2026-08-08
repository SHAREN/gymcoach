package org.sharteman.gymcoach.ui

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import org.sharteman.gymcoach.data.model.BootstrapResponse
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.GymDto
import org.sharteman.gymcoach.data.model.ProfileDto
import org.sharteman.gymcoach.data.model.ProgramDto
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.ReadinessDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class HomeBenchmarkActivity : ComponentActivity() {
    private val counters = HomeBenchmarkCounters()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pulseEnabled = intent.getBooleanExtra(EXTRA_PULSE, true)
        setContent {
            val snapshot = remember { benchmarkBootstrap() }
            var pulse by remember { mutableIntStateOf(0) }
            LaunchedEffect(pulseEnabled) {
                while (pulseEnabled) {
                    delay(PULSE_INTERVAL_MS)
                    pulse += 1
                }
            }
            GymCoachTheme {
                BenchmarkPulse(
                    value = { pulse },
                    onComposition = { counters.parentCompositions.incrementAndGet() },
                )
                BenchmarkScenarioCounter(
                    onComposition = { counters.screenCompositions.incrementAndGet() },
                ) {
                    HomeScreen(
                        email = "benchmark@example.com",
                        bootstrap = snapshot,
                        openSessions = emptyList(),
                        pendingCount = 2,
                        syncIssue = null,
                        online = true,
                        syncing = false,
                        onOpenSession = {},
                        onStartWorkout = { _, _ -> },
                        onSync = {},
                        onRetrySyncIssue = {},
                        onDiscardSyncIssue = {},
                        onSaveReadiness = { _, _, _ -> true },
                        onPrograms = {},
                        onExerciseCatalog = {},
                        onHistory = {},
                        onProgress = {},
                        onCoach = {},
                        onChat = {},
                        onSettings = {},
                        onWebPanel = {},
                        currentVersion = "benchmark",
                        onDownloadUpdate = {},
                        onLogout = {},
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        when {
            intent.getBooleanExtra(EXTRA_RESET, false) -> {
                counters.reset()
                Log.i(LOG_TAG, "reset")
            }
            intent.getBooleanExtra(EXTRA_DUMP, false) -> Log.i(LOG_TAG, counters.asLogLine())
        }
    }

    private companion object {
        const val EXTRA_PULSE = "pulse"
        const val EXTRA_RESET = "reset"
        const val EXTRA_DUMP = "dump"
        const val PULSE_INTERVAL_MS = 33L
        const val LOG_TAG = "GymCoachHomeBenchmark"
    }
}

@Composable
internal fun BenchmarkPulse(value: () -> Int, onComposition: () -> Unit) {
    val snapshot = value()
    SideEffect(onComposition)
    if (snapshot == Int.MIN_VALUE) error("Unreachable benchmark pulse value")
}

@Composable
internal fun BenchmarkScenarioCounter(
    onComposition: () -> Unit,
    content: @Composable () -> Unit,
) {
    SideEffect(onComposition)
    content()
}

private class HomeBenchmarkCounters {
    val parentCompositions = AtomicInteger()
    val screenCompositions = AtomicInteger()

    fun reset() {
        parentCompositions.set(0)
        screenCompositions.set(0)
    }

    fun asLogLine(): String = buildString {
        val destinationRows = homeDestinationRows(List(BENCHMARK_DESTINATION_COUNT) { it })
        append("parentCompositions=")
        append(parentCompositions.get())
        append(" screenCompositions=")
        append(screenCompositions.get())
        append(" benchmarkWorkoutItems=")
        append(BENCHMARK_WORKOUT_COUNT)
        append(" destinationRows=")
        append(destinationRows.size)
        append(" maxDestinationCardsPerRow=")
        append(destinationRows.maxOf { it.size })
    }
}

private const val BENCHMARK_WORKOUT_COUNT = 16
private const val BENCHMARK_DESTINATION_COUNT = 8

private fun benchmarkBootstrap(): BootstrapResponse {
    val workouts = List(BENCHMARK_WORKOUT_COUNT) { workoutIndex ->
        val workoutId = "benchmark-workout-$workoutIndex"
        WorkoutDto(
            id = workoutId,
            programId = "benchmark-program",
            name = "Benchmark workout ${workoutIndex + 1}",
            dayOfWeek = (workoutIndex % 7) + 1,
            order = workoutIndex,
            exercises = List(5) { exerciseIndex ->
                val exerciseId = "benchmark-exercise-$workoutIndex-$exerciseIndex"
                ProgramExerciseDto(
                    id = "benchmark-program-exercise-$workoutIndex-$exerciseIndex",
                    workoutId = workoutId,
                    exerciseId = exerciseId,
                    order = exerciseIndex,
                    targetSets = 4,
                    targetRepsMin = 8,
                    targetRepsMax = 12,
                    targetRIR = 2,
                    restSec = 120,
                    exercise = ExerciseDto(
                        id = exerciseId,
                        name = "Benchmark exercise ${exerciseIndex + 1}",
                        muscleGroup = "CHEST",
                        category = "COMPOUND",
                        equipmentType = "BARBELL",
                    ),
                )
            },
        )
    }
    return BootstrapResponse(
        schemaVersion = 9,
        calculationVersion = "home-benchmark",
        serverTime = "2026-07-28T08:00:00Z",
        profile = ProfileDto(
            id = "benchmark-user",
            email = "benchmark@example.com",
            activeGymId = "benchmark-gym-1",
        ),
        activeProgram = ProgramDto(
            id = "benchmark-program",
            name = "Benchmark program",
            phase = "ACTIVE",
            workouts = workouts,
        ),
        gyms = List(3) { index ->
            GymDto(id = "benchmark-gym-${index + 1}", name = "Benchmark gym ${index + 1}")
        },
        readiness = ReadinessDto(
            readiness = 4,
            sleepQuality = 4,
            note = "Benchmark readiness note",
            createdAt = "2026-07-28T07:00:00Z",
            ageHours = 1.0,
        ),
    )
}
