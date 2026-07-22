package org.sharteman.gymcoach.data.profile

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.data.model.CoachingFieldDto
import org.sharteman.gymcoach.data.model.CoachingFieldInput
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingLimitationInput
import org.sharteman.gymcoach.data.model.CoachingLimitationsValueDto
import org.sharteman.gymcoach.data.model.CoachingLimitationsValueInput
import org.sharteman.gymcoach.data.model.CoachingMuscleGroup
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityDto
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityInput
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingProfilePatchInput
import org.sharteman.gymcoach.data.settings.CoachingProfileRemoteDataSource
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.settings.SettingsRepository
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.sync.SyncScheduler

data class CoachingProfileLoadResult(
    val profile: CoachingProfileDto,
    val pending: Boolean = false,
    val authoritative: Boolean = true,
    val retryableError: SettingsErrorKind? = null,
    val conflictedFields: Set<String> = emptySet(),
)

data class CoachingProfileSaveResult(
    val profile: CoachingProfileDto,
    val pending: Boolean = false,
    val conflictedFields: Set<String> = emptySet(),
)

interface CoachingProfileDataSource {
    suspend fun load(initialProfile: CoachingProfileDto? = null): CoachingProfileLoadResult
    suspend fun save(
        currentProfile: CoachingProfileDto,
        patch: CoachingProfilePatchInput,
    ): CoachingProfileSaveResult
    suspend fun retryPending(currentProfile: CoachingProfileDto): CoachingProfileSaveResult
}

@Serializable
data class PendingCoachingProfilePatch(
    val patch: CoachingProfilePatchInput,
    val baseUpdatedAt: Map<String, String?>,
)

interface CoachingProfilePendingStore {
    fun read(): PendingCoachingProfilePatch?
    fun write(value: PendingCoachingProfilePatch)
    fun clear()
}

class CoachingProfileRepository(
    private val remote: CoachingProfileRemoteDataSource,
    private val pendingStore: CoachingProfilePendingStore,
    private val scheduleSyncNow: () -> Unit = {},
) : CoachingProfileDataSource {
    override suspend fun load(initialProfile: CoachingProfileDto?): CoachingProfileLoadResult {
        val pending = pendingStore.read()
        if (pending != null) {
            try {
                val synced = syncPending()
                if (synced != null) {
                    return CoachingProfileLoadResult(
                        profile = synced.profile,
                        conflictedFields = synced.conflictedFields,
                    )
                }
            } catch (error: SettingsException) {
                if (error.kind == SettingsErrorKind.AUTHENTICATION || !error.kind.isRetryable()) {
                    throw error
                }
                if (initialProfile != null) {
                    return CoachingProfileLoadResult(
                        profile = applyPatchLocally(initialProfile, pending.patch),
                        pending = true,
                        authoritative = false,
                        retryableError = error.kind,
                    )
                }
                throw error
            }
        }

        return try {
            CoachingProfileLoadResult(remote.loadProfile().coachingProfile ?: CoachingProfileDto())
        } catch (error: SettingsException) {
            if (
                initialProfile == null || error.kind == SettingsErrorKind.AUTHENTICATION ||
                !error.kind.isRetryable()
            ) throw error
            CoachingProfileLoadResult(
                profile = initialProfile,
                authoritative = false,
                retryableError = error.kind.takeIf { it.isRetryable() },
            )
        }
    }

    override suspend fun save(
        currentProfile: CoachingProfileDto,
        patch: CoachingProfilePatchInput,
    ): CoachingProfileSaveResult {
        require(patch.fieldNames().isNotEmpty()) { "A coaching profile patch cannot be empty." }
        pendingMutex.withLock {
            val existing = pendingStore.read()
            pendingStore.write(
                PendingCoachingProfilePatch(
                    patch = existing?.patch?.merge(patch) ?: patch,
                    baseUpdatedAt = mergeBaseTimestamps(existing, currentProfile, patch),
                ),
            )
        }
        scheduleSyncNow()
        return try {
            syncPending() ?: CoachingProfileSaveResult(currentProfile)
        } catch (error: SettingsException) {
            if (error.kind == SettingsErrorKind.AUTHENTICATION || !error.kind.isRetryable()) {
                throw error
            }
            val queued = pendingStore.read()?.patch ?: patch
            CoachingProfileSaveResult(
                profile = applyPatchLocally(currentProfile, queued),
                pending = true,
            )
        }
    }

    override suspend fun retryPending(currentProfile: CoachingProfileDto): CoachingProfileSaveResult =
        try {
            syncPending() ?: CoachingProfileSaveResult(
                remote.loadProfile().coachingProfile ?: CoachingProfileDto(),
            )
        } catch (error: SettingsException) {
            if (error.kind == SettingsErrorKind.AUTHENTICATION || !error.kind.isRetryable()) {
                throw error
            }
            val queued = pendingStore.read()?.patch
            if (queued == null) throw error
            CoachingProfileSaveResult(
                profile = queued?.let { applyPatchLocally(currentProfile, it) } ?: currentProfile,
                pending = true,
            )
        }

    suspend fun syncPending(): CoachingProfileSaveResult? = pendingMutex.withLock {
        val pending = pendingStore.read() ?: return@withLock null
        try {
            val current = remote.loadProfile().coachingProfile ?: CoachingProfileDto()
            val resolution = resolvePendingPatch(current, pending)
            val saved = if (resolution.safePatch.fieldNames().isEmpty()) {
                current
            } else {
                remote.saveCoachingProfile(resolution.safePatch).coachingProfile ?: current
            }
            pendingStore.clear()
            CoachingProfileSaveResult(
                profile = saved,
                conflictedFields = resolution.conflictedFields,
            )
        } catch (error: SettingsException) {
            if (error.kind != SettingsErrorKind.AUTHENTICATION && !error.kind.isRetryable()) {
                pendingStore.clear()
            }
            throw error
        }
    }

    companion object {
        private val pendingMutex = Mutex()

        fun create(
            context: Context,
            scheduleSyncNow: () -> Unit = { SyncScheduler.scheduleNow(context.applicationContext) },
        ): CoachingProfileRepository {
            val appContext = context.applicationContext
            val account = SecureAccountStore(appContext)
            val identity = account.userId ?: account.userEmail
                ?: throw SettingsException(SettingsErrorKind.AUTHENTICATION)
            return CoachingProfileRepository(
                remote = SettingsRepository.create(appContext),
                pendingStore = FileCoachingProfilePendingStore(
                    appContext,
                    coachingProfileOwnerKey(identity, account.primaryServerUrl),
                ),
                scheduleSyncNow = scheduleSyncNow,
            )
        }
    }
}

internal fun coachingProfileOwnerKey(identity: String, primaryServerUrl: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest("${primaryServerUrl.trimEnd('/')}\n$identity".toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

private class FileCoachingProfilePendingStore(
    context: Context,
    ownerHash: String,
) : CoachingProfilePendingStore {
    private val file = AtomicFile(
        File(context.noBackupFilesDir, "coaching-profile-pending-$ownerHash.json"),
    )
    private val json = Json {
        encodeDefaults = false
        explicitNulls = true
        ignoreUnknownKeys = true
    }

    override fun read(): PendingCoachingProfilePatch? {
        if (!file.baseFile.exists()) return null
        return try {
            json.decodeFromString(file.readFully().toString(Charsets.UTF_8))
        } catch (error: Throwable) {
            throw IllegalStateException("Stored coaching profile update could not be read.", error)
        }
    }

    override fun write(value: PendingCoachingProfilePatch) {
        val output = file.startWrite()
        try {
            output.write(json.encodeToString(value).toByteArray(Charsets.UTF_8))
            file.finishWrite(output)
        } catch (error: Throwable) {
            file.failWrite(output)
            throw IllegalStateException("Coaching profile update could not be stored.", error)
        }
    }

    override fun clear() {
        file.delete()
    }
}

private data class PendingResolution(
    val safePatch: CoachingProfilePatchInput,
    val conflictedFields: Set<String>,
)

private fun resolvePendingPatch(
    current: CoachingProfileDto,
    pending: PendingCoachingProfilePatch,
): PendingResolution {
    val conflicts = linkedSetOf<String>()

    fun <T, I> resolve(
        name: String,
        input: CoachingFieldInput<I>?,
        field: CoachingFieldDto<T>,
        matches: (CoachingFieldDto<T>, CoachingFieldInput<I>) -> Boolean,
    ): CoachingFieldInput<I>? {
        if (input == null || matches(field, input)) return null
        if (field.updatedAt == pending.baseUpdatedAt[name]) return input
        conflicts += name
        return null
    }

    return PendingResolution(
        safePatch = CoachingProfilePatchInput(
            healthStatus = resolve("healthStatus", pending.patch.healthStatus, current.healthStatus) { field, input ->
                field.matchesEnum(input)
            },
            trainingLevel = resolve("trainingLevel", pending.patch.trainingLevel, current.trainingLevel) { field, input ->
                field.matchesEnum(input)
            },
            availableWeekdays = resolve(
                "availableWeekdays",
                pending.patch.availableWeekdays,
                current.availableWeekdays,
            ) { field, input -> field.matches(input) { it.sorted() } },
            limitations = resolve("limitations", pending.patch.limitations, current.limitations) { field, input ->
                field.matches(input) { value -> value.toDto() }
            },
            maximumSessionDurationMin = resolve(
                "maximumSessionDurationMin",
                pending.patch.maximumSessionDurationMin,
                current.maximumSessionDurationMin,
            ) { field, input -> field.matches(input) },
            priorityMuscles = resolve(
                "priorityMuscles",
                pending.patch.priorityMuscles,
                current.priorityMuscles,
            ) { field, input -> field.matches(input) { values -> values.map(CoachingMuscleGroup::name) } },
            priorityStrengthMovements = resolve(
                "priorityStrengthMovements",
                pending.patch.priorityStrengthMovements,
                current.priorityStrengthMovements,
            ) { field, input -> field.matches(input) },
            outsideActivities = resolve(
                "outsideActivities",
                pending.patch.outsideActivities,
                current.outsideActivities,
            ) { field, input -> field.matches(input) { values -> values.map { it.toDto() } } },
            likedExercises = resolve("likedExercises", pending.patch.likedExercises, current.likedExercises) { field, input ->
                field.matches(input)
            },
            dislikedExercises = resolve(
                "dislikedExercises",
                pending.patch.dislikedExercises,
                current.dislikedExercises,
            ) { field, input -> field.matches(input) },
            averageSleepHours = resolve(
                "averageSleepHours",
                pending.patch.averageSleepHours,
                current.averageSleepHours,
            ) { field, input -> field.matches(input) },
            baselineStress = resolve("baselineStress", pending.patch.baselineStress, current.baselineStress) { field, input ->
                field.matches(input)
            },
            generalRecovery = resolve(
                "generalRecovery",
                pending.patch.generalRecovery,
                current.generalRecovery,
            ) { field, input -> field.matches(input) },
        ),
        conflictedFields = conflicts,
    )
}

private fun <T> CoachingFieldDto<T>.matches(input: CoachingFieldInput<T>): Boolean =
    state == input.state.name && (input.state != CoachingFieldState.KNOWN || value == input.value)

private fun <T, I> CoachingFieldDto<T>.matches(
    input: CoachingFieldInput<I>,
    convert: (I) -> T,
): Boolean = state == input.state.name &&
    (input.state != CoachingFieldState.KNOWN || input.value?.let(convert) == value)

private fun <E : Enum<E>> CoachingFieldDto<String>.matchesEnum(input: CoachingFieldInput<E>): Boolean =
    state == input.state.name &&
        (input.state != CoachingFieldState.KNOWN || input.value?.name == value)

private fun CoachingLimitationsValueInput.toDto() = CoachingLimitationsValueDto(
    entries = entries.map { entry ->
        org.sharteman.gymcoach.data.model.CoachingLimitationDto(
            kind = entry.kind.name,
            label = entry.label,
            affectedExerciseNames = entry.affectedExerciseNames,
            details = entry.details,
        )
    },
    note = note,
)

private fun CoachingOutsideActivityInput.toDto() = CoachingOutsideActivityDto(
    type = type.name,
    name = name,
    sessionsPerWeek = sessionsPerWeek,
    minutesPerWeek = minutesPerWeek,
    intensity = intensity?.name,
    details = details,
)

private fun mergeBaseTimestamps(
    existing: PendingCoachingProfilePatch?,
    current: CoachingProfileDto,
    next: CoachingProfilePatchInput,
): Map<String, String?> {
    val result = existing?.baseUpdatedAt.orEmpty().toMutableMap()
    next.fieldNames().forEach { name ->
        if (name !in result) result[name] = current.fieldUpdatedAt(name)
    }
    return result
}

private fun CoachingProfilePatchInput.merge(next: CoachingProfilePatchInput) = CoachingProfilePatchInput(
    healthStatus = next.healthStatus ?: healthStatus,
    trainingLevel = next.trainingLevel ?: trainingLevel,
    availableWeekdays = next.availableWeekdays ?: availableWeekdays,
    limitations = next.limitations ?: limitations,
    maximumSessionDurationMin = next.maximumSessionDurationMin ?: maximumSessionDurationMin,
    priorityMuscles = next.priorityMuscles ?: priorityMuscles,
    priorityStrengthMovements = next.priorityStrengthMovements ?: priorityStrengthMovements,
    outsideActivities = next.outsideActivities ?: outsideActivities,
    likedExercises = next.likedExercises ?: likedExercises,
    dislikedExercises = next.dislikedExercises ?: dislikedExercises,
    averageSleepHours = next.averageSleepHours ?: averageSleepHours,
    baselineStress = next.baselineStress ?: baselineStress,
    generalRecovery = next.generalRecovery ?: generalRecovery,
)

fun CoachingProfilePatchInput.fieldNames(): Set<String> = buildSet {
    if (healthStatus != null) add("healthStatus")
    if (trainingLevel != null) add("trainingLevel")
    if (availableWeekdays != null) add("availableWeekdays")
    if (limitations != null) add("limitations")
    if (maximumSessionDurationMin != null) add("maximumSessionDurationMin")
    if (priorityMuscles != null) add("priorityMuscles")
    if (priorityStrengthMovements != null) add("priorityStrengthMovements")
    if (outsideActivities != null) add("outsideActivities")
    if (likedExercises != null) add("likedExercises")
    if (dislikedExercises != null) add("dislikedExercises")
    if (averageSleepHours != null) add("averageSleepHours")
    if (baselineStress != null) add("baselineStress")
    if (generalRecovery != null) add("generalRecovery")
}

private fun CoachingProfileDto.fieldUpdatedAt(name: String): String? = when (name) {
    "healthStatus" -> healthStatus.updatedAt
    "trainingLevel" -> trainingLevel.updatedAt
    "availableWeekdays" -> availableWeekdays.updatedAt
    "limitations" -> limitations.updatedAt
    "maximumSessionDurationMin" -> maximumSessionDurationMin.updatedAt
    "priorityMuscles" -> priorityMuscles.updatedAt
    "priorityStrengthMovements" -> priorityStrengthMovements.updatedAt
    "outsideActivities" -> outsideActivities.updatedAt
    "likedExercises" -> likedExercises.updatedAt
    "dislikedExercises" -> dislikedExercises.updatedAt
    "averageSleepHours" -> averageSleepHours.updatedAt
    "baselineStress" -> baselineStress.updatedAt
    "generalRecovery" -> generalRecovery.updatedAt
    else -> null
}

fun applyPatchLocally(
    current: CoachingProfileDto,
    patch: CoachingProfilePatchInput,
): CoachingProfileDto = current.copy(
    healthStatus = patch.healthStatus?.toDto(current.healthStatus) { it.name } ?: current.healthStatus,
    trainingLevel = patch.trainingLevel?.toDto(current.trainingLevel) { it.name } ?: current.trainingLevel,
    availableWeekdays = patch.availableWeekdays?.toDto(current.availableWeekdays) { it.sorted() }
        ?: current.availableWeekdays,
    limitations = patch.limitations?.toDto(current.limitations) { it.toDto() } ?: current.limitations,
    maximumSessionDurationMin = patch.maximumSessionDurationMin?.toDto(current.maximumSessionDurationMin)
        ?: current.maximumSessionDurationMin,
    priorityMuscles = patch.priorityMuscles?.toDto(current.priorityMuscles) { values ->
        values.map(CoachingMuscleGroup::name)
    } ?: current.priorityMuscles,
    priorityStrengthMovements = patch.priorityStrengthMovements?.toDto(current.priorityStrengthMovements)
        ?: current.priorityStrengthMovements,
    outsideActivities = patch.outsideActivities?.toDto(current.outsideActivities) { values ->
        values.map { it.toDto() }
    } ?: current.outsideActivities,
    likedExercises = patch.likedExercises?.toDto(current.likedExercises) ?: current.likedExercises,
    dislikedExercises = patch.dislikedExercises?.toDto(current.dislikedExercises) ?: current.dislikedExercises,
    averageSleepHours = patch.averageSleepHours?.toDto(current.averageSleepHours) ?: current.averageSleepHours,
    baselineStress = patch.baselineStress?.toDto(current.baselineStress) ?: current.baselineStress,
    generalRecovery = patch.generalRecovery?.toDto(current.generalRecovery) ?: current.generalRecovery,
)

private fun <T> CoachingFieldInput<T>.toDto(previous: CoachingFieldDto<T>) = CoachingFieldDto(
    state = state.name,
    value = value.takeIf { state == CoachingFieldState.KNOWN },
    updatedAt = previous.updatedAt,
)

private fun <T, I> CoachingFieldInput<I>.toDto(
    previous: CoachingFieldDto<T>,
    convert: (I) -> T,
) = CoachingFieldDto(
    state = state.name,
    value = value?.takeIf { state == CoachingFieldState.KNOWN }?.let(convert),
    updatedAt = previous.updatedAt,
)

fun SettingsErrorKind.isRetryable(): Boolean = this in setOf(
    SettingsErrorKind.SESSION_ROUTE_REJECTED,
    SettingsErrorKind.ENDPOINT_MISMATCH,
    SettingsErrorKind.SESSION_VALIDATION_UNAVAILABLE,
    SettingsErrorKind.RATE_LIMIT,
    SettingsErrorKind.BAD_GATEWAY,
    SettingsErrorKind.SERVER_UNAVAILABLE,
    SettingsErrorKind.DNS,
    SettingsErrorKind.TIMEOUT,
    SettingsErrorKind.TLS,
    SettingsErrorKind.OFFLINE,
    SettingsErrorKind.INVALID_RESPONSE,
    SettingsErrorKind.UNKNOWN,
)
