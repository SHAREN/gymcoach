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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.time.Instant
import java.time.YearMonth
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.HistoricalSetAddRequest
import org.sharteman.gymcoach.data.model.HistoricalSetUpdateRequest
import org.sharteman.gymcoach.data.model.MobileHistoryExerciseDto
import org.sharteman.gymcoach.data.model.MobileHistoryProgramDto
import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import org.sharteman.gymcoach.data.model.MobileHistorySetDto
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.ProgramExerciseDto
import org.sharteman.gymcoach.data.model.WorkoutDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.data.programs.ManagedProgramDto
import org.sharteman.gymcoach.data.programs.ProgramCountsDto
import org.sharteman.gymcoach.data.programs.ProgramExerciseInput
import org.sharteman.gymcoach.data.programs.ProgramInput
import org.sharteman.gymcoach.data.programs.ProgramsCatalogDataSource
import org.sharteman.gymcoach.data.programs.WorkoutInput
import org.sharteman.gymcoach.data.repository.HistoryProgressDataSource
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto
import org.sharteman.gymcoach.data.settings.SettingsBarbellSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsDataSource
import org.sharteman.gymcoach.data.settings.SettingsDumbbellsSystemProfileInput
import org.sharteman.gymcoach.data.settings.SettingsGymDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentInput
import org.sharteman.gymcoach.data.settings.SettingsGymInput
import org.sharteman.gymcoach.data.settings.SettingsGymInventoryDto
import org.sharteman.gymcoach.data.settings.SettingsGymListDto
import org.sharteman.gymcoach.data.settings.SettingsGymUpdateInput
import org.sharteman.gymcoach.data.settings.SettingsImportFormat
import org.sharteman.gymcoach.data.settings.SettingsImportPreview
import org.sharteman.gymcoach.data.settings.SettingsProfileDto
import org.sharteman.gymcoach.data.settings.SettingsProfileInput
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.ui.programs.ExerciseCatalogScreen
import org.sharteman.gymcoach.ui.programs.ProgramsScreen
import org.sharteman.gymcoach.ui.settings.SettingsScreen
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class AppPerformanceBenchmarkActivity : ComponentActivity() {
    private val compositions = AtomicInteger()
    private val screenCompositions = AtomicInteger()
    private val selectedScenario = mutableStateOf(SCENARIO_WORKOUT)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        selectedScenario.value = intent.benchmarkScenario()
        setContent {
            var pulse by remember { mutableIntStateOf(0) }
            LaunchedEffect(Unit) {
                while (true) {
                    delay(PULSE_INTERVAL_MS)
                    pulse += 1
                }
            }
            GymCoachTheme {
                BenchmarkPulse(
                    value = { pulse },
                    onComposition = { compositions.incrementAndGet() },
                )
                BenchmarkScenarioCounter(
                    onComposition = { screenCompositions.incrementAndGet() },
                ) {
                    BenchmarkScenario(selectedScenario.value)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        selectedScenario.value = intent.benchmarkScenario()
        when {
            intent.getBooleanExtra(EXTRA_RESET, false) -> {
                compositions.set(0)
                screenCompositions.set(0)
                Log.i(LOG_TAG, "reset scenario=${selectedScenario.value}")
            }
            intent.getBooleanExtra(EXTRA_DUMP, false) -> Log.i(
                LOG_TAG,
                "scenario=${selectedScenario.value} parentCompositions=${compositions.get()} " +
                    "screenCompositions=${screenCompositions.get()}",
            )
        }
    }

    private fun Intent.benchmarkScenario(): String =
        getStringExtra(EXTRA_SCENARIO)?.takeIf { it in SCENARIOS } ?: SCENARIO_WORKOUT

    private companion object {
        const val EXTRA_SCENARIO = "scenario"
        const val EXTRA_RESET = "reset"
        const val EXTRA_DUMP = "dump"
        const val PULSE_INTERVAL_MS = 33L
        const val LOG_TAG = "GymCoachAppBenchmark"
        const val SCENARIO_WORKOUT = "workout"
        val SCENARIOS = setOf("workout", "settings", "catalog", "history", "programs")
    }
}

@Composable
private fun BenchmarkScenario(scenario: String) {
    when (scenario) {
        "workout" -> WorkoutScreenPreview()
        "settings" -> SettingsScreen(
            onBack = {},
            onOpenWebPath = {},
            onAuthenticationRequired = {},
            repository = remember { BenchmarkSettingsSource() },
        )
        "catalog" -> ExerciseCatalogScreen(
            dataSource = remember { BenchmarkCatalogSource() },
            serverUrl = "https://benchmark.invalid",
            onBack = {},
            canFetchProgress = false,
        )
        "history" -> HistoryScreen(
            onBack = {},
            initialMonthKey = YearMonth.now().toString(),
            dataSource = remember { BenchmarkHistorySource(benchmarkHistorySnapshot()) },
        )
        "programs" -> ProgramsScreen(
            dataSource = remember { BenchmarkCatalogSource() },
            onBack = {},
        )
    }
}

private class BenchmarkCatalogSource : ProgramsCatalogDataSource {
    private val exercises = List(240) { index ->
        ExerciseDto(
            id = "benchmark-exercise-$index",
            userId = "benchmark-user",
            name = "Benchmark exercise ${index + 1}",
            muscleGroup = listOf("CHEST", "BACK_WIDTH", "QUADS", "SHOULDERS")[index % 4],
            category = if (index % 6 == 0) "ISOLATION" else "COMPOUND",
            equipmentType = listOf("BARBELL", "DUMBBELL", "CABLE", "MACHINE")[index % 4],
            defaultRestSec = 60 + index % 4 * 30,
            trainingDates = List(index % 12) { day -> "2026-07-${(day + 1).toString().padStart(2, '0')}T08:00:00Z" },
        )
    }
    private val programs = List(36) { index ->
        ManagedProgramDto(
            id = "benchmark-program-$index",
            name = "Benchmark program ${index + 1}",
            description = "Representative program with several training days",
            phase = if (index % 2 == 0) "Base" else "Progression",
            isActive = index == 0,
            counts = ProgramCountsDto(workouts = 4 + index % 3, sessions = 12 + index),
        )
    }

    override suspend fun listPrograms() = programs
    override suspend fun getProgram(id: String) = programs.first { it.id == id }
    override suspend fun listExercises() = exercises
    override suspend fun getExercise(id: String) = exercises.first { it.id == id }
    override suspend fun createProgram(input: ProgramInput): ManagedProgramDto = error("unused")
    override suspend fun updateProgram(id: String, input: ProgramInput): ManagedProgramDto = error("unused")
    override suspend fun deleteProgram(id: String) = Unit
    override suspend fun setProgramActive(id: String, active: Boolean) = getProgram(id).copy(isActive = active)
    override suspend fun createWorkout(programId: String, input: WorkoutInput): WorkoutDto = error("unused")
    override suspend fun updateWorkout(id: String, input: WorkoutInput): WorkoutDto = error("unused")
    override suspend fun deleteWorkout(id: String) = Unit
    override suspend fun createProgramExercise(
        workoutId: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = error("unused")
    override suspend fun updateProgramExercise(
        id: String,
        input: ProgramExerciseInput,
    ): ProgramExerciseDto = error("unused")
    override suspend fun deleteProgramExercise(id: String) = Unit
    override suspend fun createExercise(input: ExerciseInput): ExerciseDto = error("unused")
    override suspend fun updateExercise(id: String, input: ExerciseInput) = getExercise(id)
    override suspend fun deleteExercise(id: String) = Unit
}

private class BenchmarkHistorySource(
    private val snapshot: MobileHistorySnapshot,
) : HistoryProgressDataSource {
    override suspend fun cachedHistory(month: String, programId: String?) = snapshot
    override suspend fun refreshHistory(month: String, programId: String?) = snapshot
    override suspend fun deleteHistorySession(sessionId: String) = Unit
    override suspend fun updateHistoricalSet(setId: String, request: HistoricalSetUpdateRequest) = Unit
    override suspend fun addHistoricalSet(sessionId: String, request: HistoricalSetAddRequest) = Unit
    override suspend fun deleteHistoricalSet(setId: String) = Unit
    override suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int) = Unit
    override suspend fun deleteGoal(goalId: String) = Unit
    override suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int) = Unit
    override suspend fun clearVolumeTarget(muscleGroup: String) = Unit
    override suspend fun startDeload() = Unit
    override suspend fun endDeload() = Unit
}

private fun benchmarkHistorySnapshot(): MobileHistorySnapshot {
    val now = Instant.now()
    val sessionDate = now.toString()
    return MobileHistorySnapshot(
        schemaVersion = 2,
        generatedAt = sessionDate,
        month = YearMonth.now().toString(),
        programs = listOf(MobileHistoryProgramDto("benchmark-program", "Benchmark program")),
        hasAnyHistory = true,
        sessions = List(32) { sessionIndex ->
            val exercises = List(5) { exerciseIndex ->
                val exerciseId = "history-exercise-$exerciseIndex"
                MobileHistoryExerciseDto(
                    id = exerciseId,
                    name = "History exercise ${exerciseIndex + 1}",
                    muscleGroup = listOf("CHEST", "BACK_WIDTH", "QUADS", "SHOULDERS", "BICEPS")[exerciseIndex],
                    category = "COMPOUND",
                    equipmentType = "BARBELL",
                    volume = 2_400.0 + sessionIndex * 10,
                    estimated1RM = 100.0 + sessionIndex,
                    sets = List(4) { setIndex ->
                        MobileHistorySetDto(
                            id = "history-set-$sessionIndex-$exerciseIndex-$setIndex",
                            setNumber = setIndex + 1,
                            weight = 80.0 + exerciseIndex * 2.5,
                            effectiveWeight = 80.0 + exerciseIndex * 2.5,
                            reps = 8 + setIndex,
                            rir = 2,
                            completedAt = sessionDate,
                            equipmentNameSnapshot = "Benchmark equipment",
                        )
                    },
                )
            }
            MobileHistorySessionDto(
                id = "history-session-$sessionIndex",
                programId = "benchmark-program",
                programName = "Benchmark program",
                workoutName = "Benchmark workout ${sessionIndex + 1}",
                startedAt = sessionDate,
                finishedAt = sessionDate,
                durationMin = 60,
                sessionRpe = 7,
                workingSets = 20,
                volume = exercises.sumOf { it.volume },
                exercises = exercises,
            )
        },
    )
}

private class BenchmarkSettingsSource : SettingsDataSource {
    private val snapshot = benchmarkSettingsSnapshot()

    override suspend fun load() = snapshot
    override suspend fun saveProfile(input: SettingsProfileInput) = snapshot.profile
    override suspend fun createGym(input: SettingsGymInput) = SettingsGymDto("benchmark-gym-new", input.name)
    override suspend fun updateGym(id: String, input: SettingsGymUpdateInput) = SettingsGymDto(id, input.name)
    override suspend fun activateGym(id: String) = Unit
    override suspend fun deleteGym(id: String) = Unit
    override suspend fun loadGymInventory(gymId: String) = snapshot.gymInventories.getValue(gymId)
    override suspend fun saveGymEquipment(
        gymId: String,
        equipmentId: String?,
        input: SettingsGymEquipmentInput,
    ) = Unit
    override suspend fun saveDumbbellsSystemProfile(
        gymId: String,
        input: SettingsDumbbellsSystemProfileInput,
    ) = Unit
    override suspend fun saveBarbellSystemProfile(
        gymId: String,
        input: SettingsBarbellSystemProfileInput,
    ) = Unit
    override suspend fun deleteGymEquipment(equipmentId: String) = Unit
    override suspend fun setGymEquipmentImageUrl(equipmentId: String, imageUrl: String) = Unit
    override suspend fun uploadGymEquipmentImage(
        equipmentId: String,
        imageBase64: String,
        mimeType: String,
    ) = Unit
    override suspend fun clearGymEquipmentImage(equipmentId: String) = Unit
    override suspend fun latestRelease() = AndroidReleaseDto(
        versionCode = 999,
        versionName = "99.0.0",
        sha256 = "a".repeat(64),
        sizeBytes = 20_000_000,
        publishedAt = "2026-08-08T00:00:00Z",
        apkFile = "benchmark.apk",
        downloadUrl = "/api/android/download",
    )
    override fun releaseDownloadUrl(release: AndroidReleaseDto) = "https://benchmark.invalid/android.apk"
    override suspend fun exportBackup() = "{}"
    override suspend fun restoreBackup(payload: String) = Unit
    override suspend fun previewImport(
        format: SettingsImportFormat,
        fileName: String,
        payload: String,
        unit: String,
    ) = SettingsImportPreview(format, fileName, payload, unit, JsonObject(emptyMap()))
    override suspend fun confirmImport(preview: SettingsImportPreview) = JsonObject(emptyMap())
}

private fun benchmarkSettingsSnapshot(): SettingsSnapshot {
    val exercises = List(160) { index ->
        ExerciseDto(
            id = "settings-exercise-$index",
            name = "Settings exercise ${index + 1}",
            muscleGroup = listOf("CHEST", "BACK_WIDTH", "QUADS", "SHOULDERS")[index % 4],
            category = if (index % 5 == 0) "ISOLATION" else "COMPOUND",
            equipmentType = listOf("BARBELL", "DUMBBELL", "CABLE", "MACHINE")[index % 4],
        )
    }
    val equipment = List(48) { index ->
        SettingsGymEquipmentDto(
            id = "settings-equipment-$index",
            gymId = "benchmark-gym",
            name = "Benchmark equipment ${index + 1}",
            equipmentType = listOf("BARBELL", "DUMBBELL", "CABLE", "MACHINE")[index % 4],
            loadType = if (index % 2 == 0) "SELECTORIZED" else "PLATE_LOADED",
            weightOptions = List(20) { option -> 5.0 + option * 2.5 },
            exerciseLinks = exercises.drop(index % 20).take(8),
        )
    }
    val inventory = SettingsGymInventoryDto(
        id = "benchmark-gym",
        name = "Benchmark gym",
        equipment = equipment,
        exerciseCoverage = exercises,
    )
    return SettingsSnapshot(
        profile = SettingsProfileDto(
            email = "benchmark@example.com",
            displayName = "Benchmark user",
            bodyweight = 82.5,
            sex = "MALE",
            heightCm = 181,
            goal = "STRENGTH",
            weeklyFrequency = 4,
        ),
        gymList = SettingsGymListDto(
            activeGymId = "benchmark-gym",
            gyms = listOf(SettingsGymDto("benchmark-gym", "Benchmark gym")),
        ),
        exercises = exercises,
        gymInventories = mapOf("benchmark-gym" to inventory),
    )
}
