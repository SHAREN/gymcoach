package org.sharteman.gymcoach.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.launch
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.CoachingActivityIntensity
import org.sharteman.gymcoach.data.model.CoachingFieldState
import org.sharteman.gymcoach.data.model.CoachingHealthStatus
import org.sharteman.gymcoach.data.model.CoachingLimitationKind
import org.sharteman.gymcoach.data.model.CoachingMuscleGroup
import org.sharteman.gymcoach.data.model.CoachingOutsideActivityType
import org.sharteman.gymcoach.data.model.CoachingProfileDto
import org.sharteman.gymcoach.data.model.CoachingTrainingLevel
import org.sharteman.gymcoach.data.profile.CoachingProfileDataSource
import org.sharteman.gymcoach.data.profile.CoachingProfileRepository
import org.sharteman.gymcoach.data.profile.CoachingProfileSaveResult
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.settings.isConfirmedCredentialFailure
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun CoachingProfileScreen(
    initialProfile: CoachingProfileDto? = null,
    onBack: () -> Unit,
    onAuthenticationRequired: () -> Unit,
    appRepository: GymCoachRepository? = null,
    repository: CoachingProfileDataSource? = null,
) {
    val context = LocalContext.current
    val dataSource = repository ?: remember(context) { CoachingProfileRepository.create(context) }
    val scope = rememberCoroutineScope()
    var profile by rememberSaveable(stateSaver = coachingProfileSaver) {
        mutableStateOf(initialProfile ?: CoachingProfileDto())
    }
    var draft by rememberSaveable(stateSaver = coachingDraftSaver) {
        mutableStateOf(profile.toDraft())
    }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var hasUsableProfile by rememberSaveable { mutableStateOf(initialProfile != null) }
    var fatalError by rememberSaveable(stateSaver = settingsErrorKindSaver) {
        mutableStateOf<SettingsErrorKind?>(null)
    }
    var retryableError by rememberSaveable(stateSaver = settingsErrorKindSaver) {
        mutableStateOf<SettingsErrorKind?>(null)
    }
    var pending by rememberSaveable { mutableStateOf(false) }
    var conflicts by rememberSaveable(stateSaver = stringSetSaver) {
        mutableStateOf<Set<String>>(emptySet())
    }
    var feedback by rememberSaveable { mutableStateOf<String?>(null) }
    var invalidFields by rememberSaveable(stateSaver = stringSetSaver) {
        mutableStateOf<Set<String>>(emptySet())
    }
    var busySection by remember { mutableStateOf<CoachingProfileSection?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    fun handleFailure(error: Throwable) {
        val settings = error as? SettingsException
        if (settings?.kind?.isConfirmedCredentialFailure() == true) {
            onAuthenticationRequired()
            return
        }
        fatalError = settings?.kind ?: SettingsErrorKind.UNKNOWN
        feedback = null
    }

    suspend fun cacheCanonical(result: CoachingProfileSaveResult) {
        if (!result.pending) appRepository?.mergeCoachingProfileIntoBootstrap(result.profile)
    }

    suspend fun refresh() {
        if (refreshing) return
        val baselineDraft = profile.toDraft()
        refreshing = true
        fatalError = null
        feedback = null
        val fallbackProfile = profile.takeIf { hasUsableProfile } ?: initialProfile
        try {
            runCatching { dataSource.load(fallbackProfile) }
                .onSuccess { result ->
                    profile = result.profile
                    draft = mergeProfileDraftKeepingEdits(
                        current = draft,
                        baseline = baselineDraft,
                        saved = result.profile.toDraft(),
                    )
                    pending = result.pending
                    retryableError = result.retryableError
                    conflicts = result.conflictedFields
                    invalidFields = emptySet()
                    loaded = true
                    hasUsableProfile = true
                    if (result.authoritative) {
                        appRepository?.mergeCoachingProfileIntoBootstrap(result.profile)
                    }
                }
                .onFailure {
                    loaded = true
                    handleFailure(it)
                }
        } finally {
            refreshing = false
        }
    }

    fun save(section: CoachingProfileSection) {
        val submittedDraft = draft
        val built = submittedDraft.sectionPatch(section)
        if (!built.isValid) {
            invalidFields = built.invalidFields
            feedback = context.getString(R.string.coaching_profile_fix_fields)
            return
        }
        scope.launch {
            busySection = section
            fatalError = null
            retryableError = null
            runCatching { dataSource.save(profile, requireNotNull(built.patch)) }
                .onSuccess { result ->
                    profile = result.profile
                    draft = mergeSectionDraft(
                        current = draft,
                        submitted = submittedDraft,
                        saved = result.profile.toDraft(),
                        section = section,
                    )
                    pending = result.pending
                    conflicts = result.conflictedFields
                    invalidFields = emptySet()
                    feedback = context.getString(
                        if (result.pending) R.string.coaching_profile_saved_offline
                        else R.string.coaching_profile_saved,
                    )
                    cacheCanonical(result)
                }
                .onFailure(::handleFailure)
            busySection = null
        }
    }

    fun retryPending() {
        val wasPending = pending
        val baselineDraft = profile.toDraft()
        scope.launch {
            busySection = CoachingProfileSection.SAFETY
            fatalError = null
            runCatching { dataSource.retryPending(profile) }
                .onSuccess { result ->
                    profile = result.profile
                    draft = mergeProfileDraftKeepingEdits(
                        current = draft,
                        baseline = baselineDraft,
                        saved = result.profile.toDraft(),
                    )
                    pending = result.pending
                    conflicts = result.conflictedFields
                    retryableError = null
                    feedback = context.getString(
                        when {
                            result.pending -> R.string.coaching_profile_saved_offline
                            wasPending -> R.string.coaching_profile_saved
                            else -> R.string.coaching_profile_refreshed
                        },
                    )
                    cacheCanonical(result)
                }
                .onFailure(::handleFailure)
            busySection = null
        }
    }

    LaunchedEffect(Unit) {
        if (!loaded) refresh()
    }

    val busy = busySection != null || refreshing

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.coaching_profile_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.coaching_profile_back),
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { scope.launch { refresh() } },
                        enabled = !busy,
                        modifier = Modifier.testTag("coaching-profile-refresh"),
                    ) {
                        Icon(
                            Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.coaching_profile_refresh),
                        )
                    }
                },
            )
        },
    ) { padding ->
        when {
            !loaded -> LoadingProfile(padding)
            fatalError != null && !hasUsableProfile -> ProfileLoadError(
                padding = padding,
                onRetry = { scope.launch { refresh() } },
            )
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .testTag("coaching-profile-screen"),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    ProfileSummary(
                        profile = profile,
                        pending = pending,
                        retryableError = retryableError,
                        fatalError = fatalError,
                        conflicts = conflicts,
                        feedback = feedback,
                        onRetryPending = ::retryPending,
                        busy = busy,
                    )
                }
                item {
                    SafetySection(
                        draft = draft,
                        onChange = { draft = it },
                        invalid = invalidFields,
                        busy = busy,
                        onSave = { save(CoachingProfileSection.SAFETY) },
                    )
                }
                item {
                    LimitationsSection(
                        field = draft.limitations,
                        onChange = { draft = draft.copy(limitations = it) },
                        invalid = invalidFields,
                        busy = busy,
                        onSave = { save(CoachingProfileSection.LIMITATIONS) },
                    )
                }
                item {
                    PreferencesSection(
                        draft = draft,
                        onChange = { draft = it },
                        invalid = invalidFields,
                        busy = busy,
                        onSave = { save(CoachingProfileSection.PREFERENCES) },
                    )
                }
                item {
                    RecoverySection(
                        draft = draft,
                        onChange = { draft = it },
                        invalid = invalidFields,
                        busy = busy,
                        onSave = { save(CoachingProfileSection.RECOVERY) },
                    )
                }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
private fun LoadingProfile(padding: PaddingValues) {
    Column(
        modifier = Modifier.fillMaxSize().padding(padding),
        verticalArrangement = Arrangement.Center,
    ) {
        CircularProgressIndicator(Modifier.testTag("coaching-profile-loading"))
    }
}

@Composable
private fun ProfileLoadError(padding: PaddingValues, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Banner(stringResource(R.string.coaching_profile_load_error), error = true)
        OutlinedButton(onClick = onRetry, modifier = Modifier.testTag("coaching-profile-retry-load")) {
            Icon(Icons.Default.Refresh, contentDescription = null)
            Text(stringResource(R.string.coaching_profile_retry), Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun ProfileSummary(
    profile: CoachingProfileDto,
    pending: Boolean,
    retryableError: SettingsErrorKind?,
    fatalError: SettingsErrorKind?,
    conflicts: Set<String>,
    feedback: String?,
    onRetryPending: () -> Unit,
    busy: Boolean,
) {
    ProfileCard(
        title = stringResource(R.string.coaching_profile_title),
        description = stringResource(R.string.coaching_profile_description),
        tag = "coaching-profile-summary",
    ) {
        profile.updatedAt?.let(::formatServerTimestamp)?.let { date ->
            Text(
                stringResource(R.string.coaching_profile_last_updated, date),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (profile.updatedAt == null) {
            Text(
                stringResource(R.string.coaching_profile_empty),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        feedback?.let { Banner(it, error = false) }
        if (fatalError != null) {
            Banner(stringResource(R.string.coaching_profile_save_error), error = true)
        }
        if (pending) {
            Banner(
                stringResource(R.string.coaching_profile_pending),
                error = false,
                tag = "coaching-profile-pending",
            )
            OutlinedButton(
                onClick = onRetryPending,
                enabled = !busy,
                modifier = Modifier.testTag("coaching-profile-retry-save"),
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Text(stringResource(R.string.coaching_profile_retry), Modifier.padding(start = 6.dp))
            }
        } else if (retryableError != null) {
            Banner(
                stringResource(R.string.coaching_profile_stale_cache),
                error = false,
                tag = "coaching-profile-stale-cache",
            )
            OutlinedButton(
                onClick = onRetryPending,
                enabled = !busy,
                modifier = Modifier.testTag("coaching-profile-retry-save"),
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Text(stringResource(R.string.coaching_profile_retry), Modifier.padding(start = 6.dp))
            }
        }
        if (conflicts.isNotEmpty()) {
            Banner(stringResource(R.string.coaching_profile_conflict), error = true)
        }
    }
}

@Composable
private fun SafetySection(
    draft: CoachingProfileDraft,
    onChange: (CoachingProfileDraft) -> Unit,
    invalid: Set<String>,
    busy: Boolean,
    onSave: () -> Unit,
) {
    ProfileCard(
        title = stringResource(R.string.coaching_profile_safety_title),
        description = stringResource(R.string.coaching_profile_safety_help),
        tag = "coaching-profile-safety",
    ) {
        StateSelector(
            label = stringResource(R.string.coaching_profile_health_status),
            state = draft.healthStatus.state,
            allowNotApplicable = false,
            tag = "coaching-profile-health-state",
            onState = { state ->
                onChange(
                    draft.copy(
                        healthStatus = CoachingFieldDraft(
                            state,
                            draft.healthStatus.value.takeIf { state == CoachingFieldState.KNOWN },
                        ),
                    ),
                )
            },
        )
        if (draft.healthStatus.state == CoachingFieldState.KNOWN) {
            EnumDropdown(
                label = stringResource(R.string.coaching_profile_health_status),
                value = draft.healthStatus.value,
                options = CoachingHealthStatus.entries,
                optionLabel = { healthStatusLabel(it) },
                onSelect = { onChange(draft.copy(healthStatus = draft.healthStatus.copy(value = it))) },
                isError = "healthStatus" in invalid,
                tag = "coaching-profile-health-value",
            )
        }
        if (draft.healthStatus.value == CoachingHealthStatus.MEDICAL_CLEARANCE_REQUIRED) {
            Banner(
                stringResource(R.string.coaching_profile_clearance_block),
                error = true,
                tag = "coaching-profile-clearance-block",
            )
        }
        StateSelector(
            label = stringResource(R.string.coaching_profile_training_level),
            state = draft.trainingLevel.state,
            allowNotApplicable = false,
            onState = { state ->
                onChange(
                    draft.copy(
                        trainingLevel = CoachingFieldDraft(
                            state,
                            draft.trainingLevel.value.takeIf { state == CoachingFieldState.KNOWN },
                        ),
                    ),
                )
            },
        )
        if (draft.trainingLevel.state == CoachingFieldState.KNOWN) {
            EnumDropdown(
                label = stringResource(R.string.coaching_profile_training_level),
                value = draft.trainingLevel.value,
                options = CoachingTrainingLevel.entries,
                optionLabel = { trainingLevelLabel(it) },
                onSelect = { onChange(draft.copy(trainingLevel = draft.trainingLevel.copy(value = it))) },
                isError = "trainingLevel" in invalid,
                tag = "coaching-profile-level-value",
            )
        }
        StateSelector(
            label = stringResource(R.string.coaching_profile_weekdays),
            state = draft.availableWeekdays.state,
            allowNotApplicable = false,
            onState = { state ->
                onChange(
                    draft.copy(
                        availableWeekdays = CoachingFieldDraft(
                            state,
                            draft.availableWeekdays.value.takeIf { state == CoachingFieldState.KNOWN }
                                ?: if (state == CoachingFieldState.KNOWN) emptySet() else null,
                        ),
                    ),
                )
            },
        )
        if (draft.availableWeekdays.state == CoachingFieldState.KNOWN) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..7).forEach { day ->
                    FilterChip(
                        selected = day in draft.availableWeekdays.value.orEmpty(),
                        onClick = {
                            val days = draft.availableWeekdays.value.orEmpty().toMutableSet()
                            if (!days.add(day)) days.remove(day)
                            onChange(draft.copy(availableWeekdays = draft.availableWeekdays.copy(value = days)))
                        },
                        label = { Text(weekdayLabel(day)) },
                        modifier = Modifier.testTag("coaching-profile-weekday-$day"),
                    )
                }
            }
            if ("availableWeekdays" in invalid) ValidationText()
        }
        StateSelector(
            label = stringResource(R.string.coaching_profile_max_duration),
            state = draft.maximumSessionDurationMin.state,
            allowNotApplicable = false,
            onState = { state ->
                onChange(
                    draft.copy(
                        maximumSessionDurationMin = CoachingFieldDraft(
                            state,
                            draft.maximumSessionDurationMin.value.takeIf { state == CoachingFieldState.KNOWN }
                                ?: if (state == CoachingFieldState.KNOWN) "" else null,
                        ),
                    ),
                )
            },
        )
        if (draft.maximumSessionDurationMin.state == CoachingFieldState.KNOWN) {
            OutlinedTextField(
                value = draft.maximumSessionDurationMin.value.orEmpty(),
                onValueChange = {
                    onChange(draft.copy(maximumSessionDurationMin = draft.maximumSessionDurationMin.copy(value = it)))
                },
                label = { Text(stringResource(R.string.coaching_profile_max_duration)) },
                supportingText = { Text(stringResource(R.string.coaching_profile_max_duration_help)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                isError = "maximumSessionDurationMin" in invalid,
                modifier = Modifier.fillMaxWidth().testTag("coaching-profile-duration"),
                singleLine = true,
            )
        }
        SaveSectionButton(onSave, busy, "coaching-profile-save-safety")
    }
}

@Composable
private fun LimitationsSection(
    field: CoachingFieldDraft<CoachingLimitationsDraftValue>,
    onChange: (CoachingFieldDraft<CoachingLimitationsDraftValue>) -> Unit,
    invalid: Set<String>,
    busy: Boolean,
    onSave: () -> Unit,
) {
    ProfileCard(
        title = stringResource(R.string.coaching_profile_limitations_title),
        description = stringResource(R.string.coaching_profile_limitations_help),
        tag = "coaching-profile-limitations",
    ) {
        StateSelector(
            label = stringResource(R.string.coaching_profile_limitations_title),
            state = field.state,
            allowNotApplicable = true,
            onState = { state ->
                onChange(
                    CoachingFieldDraft(
                        state,
                        field.value.takeIf { state == CoachingFieldState.KNOWN }
                            ?: if (state == CoachingFieldState.KNOWN) {
                                CoachingLimitationsDraftValue(listOf(CoachingLimitationDraft()))
                            } else null,
                    ),
                )
            },
        )
        if (field.state == CoachingFieldState.KNOWN) {
            field.value.orEmptyEntries().entries.forEachIndexed { index, entry ->
                LimitationEditor(
                    index = index,
                    value = entry,
                    isError = invalid.any { it == "limitations" || it == "limitations.$index" },
                    onChange = { next ->
                        val current = field.value.orEmptyEntries()
                        val entries = current.entries.toMutableList().also { it[index] = next }
                        onChange(field.copy(value = current.copy(entries = entries)))
                    },
                    onRemove = {
                        val current = field.value.orEmptyEntries()
                        onChange(field.copy(value = current.copy(entries = current.entries.filterIndexed { i, _ -> i != index })))
                    },
                )
            }
            OutlinedButton(
                onClick = {
                    val current = field.value.orEmptyEntries()
                    onChange(field.copy(value = current.copy(entries = current.entries + CoachingLimitationDraft())))
                },
                enabled = field.value.orEmptyEntries().entries.size < 20,
                modifier = Modifier.testTag("coaching-profile-add-limitation"),
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text(stringResource(R.string.coaching_profile_add_limitation), Modifier.padding(start = 6.dp))
            }
            OutlinedTextField(
                value = field.value.orEmptyEntries().note,
                onValueChange = { onChange(field.copy(value = field.value.orEmptyEntries().copy(note = it))) },
                label = { Text(stringResource(R.string.coaching_profile_limitations_note)) },
                isError = "limitations" in invalid,
                modifier = Modifier.fillMaxWidth().testTag("coaching-profile-limitations-note"),
                minLines = 2,
            )
        }
        SaveSectionButton(onSave, busy, "coaching-profile-save-limitations")
    }
}

@Composable
private fun LimitationEditor(
    index: Int,
    value: CoachingLimitationDraft,
    isError: Boolean,
    onChange: (CoachingLimitationDraft) -> Unit,
    onRemove: () -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth().testTag("coaching-profile-limitation-$index")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            EnumDropdown(
                label = stringResource(R.string.coaching_profile_limitation_kind),
                value = value.kind,
                options = CoachingLimitationKind.entries,
                optionLabel = { limitationKindLabel(it) },
                onSelect = { onChange(value.copy(kind = it)) },
                tag = "coaching-profile-limitation-kind-$index",
            )
            OutlinedTextField(
                value = value.label,
                onValueChange = { onChange(value.copy(label = it)) },
                label = { Text(stringResource(R.string.coaching_profile_limitation_label)) },
                isError = isError,
                modifier = Modifier.fillMaxWidth().testTag("coaching-profile-limitation-label-$index"),
            )
            ExactStringListEditor(
                label = stringResource(R.string.coaching_profile_affected_exercises),
                values = value.affectedExerciseNames,
                onChange = { onChange(value.copy(affectedExerciseNames = it)) },
                maxItems = 30,
                invalid = isError,
                tag = "coaching-profile-limitation-exercises-$index",
            )
            OutlinedTextField(
                value = value.details,
                onValueChange = { onChange(value.copy(details = it)) },
                label = { Text(stringResource(R.string.coaching_profile_limitation_details)) },
                supportingText = { Text(stringResource(R.string.coaching_profile_limitation_details_help)) },
                isError = isError,
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
            TextButton(onClick = onRemove, modifier = Modifier.testTag("coaching-profile-remove-limitation-$index")) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = stringResource(R.string.coaching_profile_remove_limitation),
                )
                Text(stringResource(R.string.coaching_profile_remove_limitation))
            }
        }
    }
}

@Composable
private fun PreferencesSection(
    draft: CoachingProfileDraft,
    onChange: (CoachingProfileDraft) -> Unit,
    invalid: Set<String>,
    busy: Boolean,
    onSave: () -> Unit,
) {
    ProfileCard(
        title = stringResource(R.string.coaching_profile_preferences_title),
        description = stringResource(R.string.coaching_profile_preferences_help),
        tag = "coaching-profile-preferences",
    ) {
        StateSelector(
            label = stringResource(R.string.coaching_profile_priority_muscles),
            state = draft.priorityMuscles.state,
            allowNotApplicable = true,
            onState = { state ->
                onChange(
                    draft.copy(
                        priorityMuscles = CoachingFieldDraft(
                            state,
                            draft.priorityMuscles.value.takeIf { state == CoachingFieldState.KNOWN }
                                ?: if (state == CoachingFieldState.KNOWN) emptySet() else null,
                        ),
                    ),
                )
            },
        )
        if (draft.priorityMuscles.state == CoachingFieldState.KNOWN) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CoachingMuscleGroup.entries.forEach { muscle ->
                    val selected = muscle in draft.priorityMuscles.value.orEmpty()
                    FilterChip(
                        selected = selected,
                        onClick = {
                            val values = draft.priorityMuscles.value.orEmpty().toMutableSet()
                            if (!values.add(muscle)) values.remove(muscle)
                            onChange(draft.copy(priorityMuscles = draft.priorityMuscles.copy(value = values)))
                        },
                        enabled = selected || draft.priorityMuscles.value.orEmpty().size < 15,
                        label = { Text(muscleGroupDisplayName(muscle.name)) },
                    )
                }
            }
            if ("priorityMuscles" in invalid) ValidationText()
        }
        StringListField(
            label = stringResource(R.string.coaching_profile_priority_movements),
            field = draft.priorityStrengthMovements,
            onChange = { onChange(draft.copy(priorityStrengthMovements = it)) },
            invalid = "priorityStrengthMovements" in invalid,
            maxItems = 20,
            tag = "coaching-profile-priority-movements",
        )
        StringListField(
            label = stringResource(R.string.coaching_profile_liked_exercises),
            field = draft.likedExercises,
            onChange = { onChange(draft.copy(likedExercises = it)) },
            invalid = "likedExercises" in invalid,
            maxItems = 50,
            tag = "coaching-profile-liked",
        )
        StringListField(
            label = stringResource(R.string.coaching_profile_disliked_exercises),
            field = draft.dislikedExercises,
            onChange = { onChange(draft.copy(dislikedExercises = it)) },
            invalid = "dislikedExercises" in invalid,
            maxItems = 50,
            tag = "coaching-profile-disliked",
        )
        StateSelector(
            label = stringResource(R.string.coaching_profile_outside_title),
            state = draft.outsideActivities.state,
            allowNotApplicable = true,
            onState = { state ->
                onChange(
                    draft.copy(
                        outsideActivities = CoachingFieldDraft(
                            state,
                            draft.outsideActivities.value.takeIf { state == CoachingFieldState.KNOWN }
                                ?: if (state == CoachingFieldState.KNOWN) listOf(CoachingOutsideActivityDraft())
                                else null,
                        ),
                    ),
                )
            },
        )
        if (draft.outsideActivities.state == CoachingFieldState.KNOWN) {
            draft.outsideActivities.value.orEmpty().forEachIndexed { index, activity ->
                OutsideActivityEditor(
                    index = index,
                    value = activity,
                    isError = invalid.any { it == "outsideActivities" || it == "outsideActivities.$index" },
                    onChange = { next ->
                        val values = draft.outsideActivities.value.orEmpty().toMutableList().also { it[index] = next }
                        onChange(draft.copy(outsideActivities = draft.outsideActivities.copy(value = values)))
                    },
                    onRemove = {
                        val values = draft.outsideActivities.value.orEmpty().filterIndexed { i, _ -> i != index }
                        onChange(draft.copy(outsideActivities = draft.outsideActivities.copy(value = values)))
                    },
                )
            }
            OutlinedButton(
                onClick = {
                    onChange(
                        draft.copy(
                            outsideActivities = draft.outsideActivities.copy(
                                value = draft.outsideActivities.value.orEmpty() + CoachingOutsideActivityDraft(),
                            ),
                        ),
                    )
                },
                enabled = draft.outsideActivities.value.orEmpty().size < 20,
                modifier = Modifier.testTag("coaching-profile-add-activity"),
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Text(stringResource(R.string.coaching_profile_add_activity), Modifier.padding(start = 6.dp))
            }
        }
        SaveSectionButton(onSave, busy, "coaching-profile-save-preferences")
    }
}

@Composable
private fun StringListField(
    label: String,
    field: CoachingFieldDraft<List<String>>,
    onChange: (CoachingFieldDraft<List<String>>) -> Unit,
    invalid: Boolean,
    maxItems: Int,
    tag: String,
) {
    StateSelector(
        label = label,
        state = field.state,
        allowNotApplicable = true,
        onState = { state ->
            onChange(
                CoachingFieldDraft(
                    state,
                    field.value.takeIf { state == CoachingFieldState.KNOWN }
                        ?: if (state == CoachingFieldState.KNOWN) listOf("") else null,
                ),
            )
        },
    )
    if (field.state == CoachingFieldState.KNOWN) {
        ExactStringListEditor(
            label = label,
            values = field.value.orEmpty(),
            onChange = { onChange(field.copy(value = it)) },
            maxItems = maxItems,
            invalid = invalid,
            tag = tag,
        )
    }
}

@Composable
private fun ExactStringListEditor(
    label: String,
    values: List<String>,
    onChange: (List<String>) -> Unit,
    maxItems: Int,
    invalid: Boolean,
    tag: String,
) {
    values.forEachIndexed { index, value ->
        OutlinedTextField(
            value = value,
            onValueChange = { next ->
                onChange(values.toMutableList().also { it[index] = next })
            },
            label = {
                Text(stringResource(R.string.coaching_profile_exact_name_number, label, index + 1))
            },
            isError = invalid,
            modifier = Modifier.fillMaxWidth().testTag("$tag-$index"),
            minLines = 1,
            maxLines = 3,
        )
        TextButton(
            onClick = { onChange(values.filterIndexed { itemIndex, _ -> itemIndex != index }) },
            modifier = Modifier.testTag("$tag-remove-$index"),
        ) {
            Icon(
                Icons.Default.Delete,
                contentDescription = stringResource(R.string.coaching_profile_remove_exact_name),
            )
            Text(stringResource(R.string.coaching_profile_remove_exact_name))
        }
    }
    OutlinedButton(
        onClick = { onChange(values + "") },
        enabled = values.size < maxItems,
        modifier = Modifier.testTag("$tag-add"),
    ) {
        Icon(Icons.Default.Add, contentDescription = null)
        Text(stringResource(R.string.coaching_profile_add_exact_name), Modifier.padding(start = 6.dp))
    }
    if (invalid) ValidationText()
}

@Composable
private fun OutsideActivityEditor(
    index: Int,
    value: CoachingOutsideActivityDraft,
    isError: Boolean,
    onChange: (CoachingOutsideActivityDraft) -> Unit,
    onRemove: () -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth().testTag("coaching-profile-activity-$index")) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            EnumDropdown(
                label = stringResource(R.string.coaching_profile_activity_type),
                value = value.type,
                options = CoachingOutsideActivityType.entries,
                optionLabel = { activityTypeLabel(it) },
                onSelect = { onChange(value.copy(type = it)) },
                tag = "coaching-profile-activity-type-$index",
            )
            OutlinedTextField(
                value = value.name,
                onValueChange = { onChange(value.copy(name = it)) },
                label = { Text(stringResource(R.string.coaching_profile_activity_name)) },
                isError = isError,
                modifier = Modifier.fillMaxWidth().testTag("coaching-profile-activity-name-$index"),
            )
            OutlinedTextField(
                value = value.sessionsPerWeek,
                onValueChange = { onChange(value.copy(sessionsPerWeek = it)) },
                label = { Text(stringResource(R.string.coaching_profile_sessions_week)) },
                isError = isError,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            OutlinedTextField(
                value = value.minutesPerWeek,
                onValueChange = { onChange(value.copy(minutesPerWeek = it)) },
                label = { Text(stringResource(R.string.coaching_profile_minutes_week)) },
                isError = isError,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            NullableIntensityDropdown(value.intensity) { onChange(value.copy(intensity = it)) }
            OutlinedTextField(
                value = value.details,
                onValueChange = { onChange(value.copy(details = it)) },
                label = { Text(stringResource(R.string.coaching_profile_activity_details)) },
                isError = isError,
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
            )
            TextButton(onClick = onRemove, modifier = Modifier.testTag("coaching-profile-remove-activity-$index")) {
                Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.coaching_profile_remove_activity))
                Text(stringResource(R.string.coaching_profile_remove_activity))
            }
        }
    }
}

@Composable
private fun RecoverySection(
    draft: CoachingProfileDraft,
    onChange: (CoachingProfileDraft) -> Unit,
    invalid: Set<String>,
    busy: Boolean,
    onSave: () -> Unit,
) {
    ProfileCard(
        title = stringResource(R.string.coaching_profile_recovery_title),
        description = stringResource(R.string.coaching_profile_recovery_help),
        tag = "coaching-profile-recovery",
    ) {
        StatefulTextNumber(
            label = stringResource(R.string.coaching_profile_average_sleep),
            field = draft.averageSleepHours,
            onChange = { onChange(draft.copy(averageSleepHours = it)) },
            invalid = "averageSleepHours" in invalid,
            tag = "coaching-profile-sleep",
        )
        RatingField(
            label = stringResource(R.string.coaching_profile_baseline_stress),
            field = draft.baselineStress,
            onChange = { onChange(draft.copy(baselineStress = it)) },
            invalid = "baselineStress" in invalid,
            tag = "coaching-profile-stress",
        )
        RatingField(
            label = stringResource(R.string.coaching_profile_general_recovery),
            field = draft.generalRecovery,
            onChange = { onChange(draft.copy(generalRecovery = it)) },
            invalid = "generalRecovery" in invalid,
            tag = "coaching-profile-recovery-rating",
        )
        SaveSectionButton(onSave, busy, "coaching-profile-save-recovery")
    }
}

@Composable
private fun StatefulTextNumber(
    label: String,
    field: CoachingFieldDraft<String>,
    onChange: (CoachingFieldDraft<String>) -> Unit,
    invalid: Boolean,
    tag: String,
) {
    StateSelector(label, field.state, true) { state ->
        onChange(
            CoachingFieldDraft(
                state,
                field.value.takeIf { state == CoachingFieldState.KNOWN }
                    ?: if (state == CoachingFieldState.KNOWN) "" else null,
            ),
        )
    }
    if (field.state == CoachingFieldState.KNOWN) {
        OutlinedTextField(
            value = field.value.orEmpty(),
            onValueChange = { onChange(field.copy(value = it)) },
            label = { Text(label) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            isError = invalid,
            modifier = Modifier.fillMaxWidth().testTag(tag),
            singleLine = true,
        )
    }
}

@Composable
private fun RatingField(
    label: String,
    field: CoachingFieldDraft<Int>,
    onChange: (CoachingFieldDraft<Int>) -> Unit,
    invalid: Boolean,
    tag: String,
) {
    StateSelector(label, field.state, true) { state ->
        onChange(CoachingFieldDraft(state, field.value.takeIf { state == CoachingFieldState.KNOWN }))
    }
    if (field.state == CoachingFieldState.KNOWN) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.testTag(tag),
        ) {
            (1..5).forEach { rating ->
                FilterChip(
                    selected = field.value == rating,
                    onClick = { onChange(field.copy(value = rating)) },
                    label = { Text(rating.toString()) },
                )
            }
        }
        if (invalid) ValidationText()
    }
}

@Composable
private fun StateSelector(
    label: String,
    state: CoachingFieldState,
    allowNotApplicable: Boolean,
    tag: String? = null,
    onState: (CoachingFieldState) -> Unit,
) {
    Text(label, fontWeight = FontWeight.Medium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val states = if (allowNotApplicable) CoachingFieldState.entries else {
            listOf(CoachingFieldState.UNKNOWN, CoachingFieldState.KNOWN)
        }
        states.forEach { option ->
            FilterChip(
                selected = state == option,
                onClick = { if (state != option) onState(option) },
                modifier = if (tag == null) Modifier else Modifier.testTag("$tag-${option.name}"),
                label = { Text(fieldStateLabel(option)) },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> EnumDropdown(
    label: String,
    value: T?,
    options: List<T>,
    optionLabel: @Composable (T) -> String,
    onSelect: (T) -> Unit,
    isError: Boolean = false,
    tag: String,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
        OutlinedTextField(
            value = value?.let { optionLabel(it) }.orEmpty(),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            isError = isError,
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth()
                .testTag(tag),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NullableIntensityDropdown(
    value: CoachingActivityIntensity?,
    onSelect: (CoachingActivityIntensity?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
        OutlinedTextField(
            value = value?.let { activityIntensityLabel(it) }
                ?: stringResource(R.string.coaching_profile_not_set),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.coaching_profile_intensity)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                .fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.coaching_profile_not_set)) },
                onClick = {
                    onSelect(null)
                    expanded = false
                },
            )
            CoachingActivityIntensity.entries.forEach { option ->
                DropdownMenuItem(
                    text = { Text(activityIntensityLabel(option)) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun SaveSectionButton(onSave: () -> Unit, busy: Boolean, tag: String) {
    Button(onClick = onSave, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag(tag)) {
        if (busy) CircularProgressIndicator(Modifier.height(18.dp)) else {
            Icon(Icons.Default.Save, contentDescription = null)
        }
        Text(stringResource(R.string.coaching_profile_save_section), Modifier.padding(start = 8.dp))
    }
}

@Composable
private fun ProfileCard(
    title: String,
    description: String,
    tag: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(Modifier.fillMaxWidth().testTag(tag)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            content()
        }
    }
}

@Composable
private fun Banner(message: String, error: Boolean, tag: String? = null) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (error) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.secondaryContainer,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .then(if (tag != null) Modifier.testTag(tag) else Modifier)
            .clearAndSetSemantics {
                contentDescription = message
                liveRegion = if (error) LiveRegionMode.Assertive else LiveRegionMode.Polite
            },
    ) {
        Text(message, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ValidationText() {
    Text(
        stringResource(R.string.coaching_profile_fix_fields),
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun fieldStateLabel(state: CoachingFieldState): String = when (state) {
    CoachingFieldState.UNKNOWN -> stringResource(R.string.coaching_profile_unknown)
    CoachingFieldState.KNOWN -> stringResource(R.string.coaching_profile_known)
    CoachingFieldState.NOT_APPLICABLE -> stringResource(R.string.coaching_profile_not_applicable)
}

@Composable
private fun healthStatusLabel(value: CoachingHealthStatus): String = when (value) {
    CoachingHealthStatus.NO_SIGNIFICANT_ISSUES -> stringResource(R.string.coaching_profile_health_no_issues)
    CoachingHealthStatus.TRAIN_WITH_LIMITATIONS -> stringResource(R.string.coaching_profile_health_limitations)
    CoachingHealthStatus.MEDICAL_CLEARANCE_REQUIRED -> stringResource(R.string.coaching_profile_health_clearance)
}

@Composable
private fun trainingLevelLabel(value: CoachingTrainingLevel): String = when (value) {
    CoachingTrainingLevel.BEGINNER -> stringResource(R.string.coaching_profile_beginner)
    CoachingTrainingLevel.INTERMEDIATE -> stringResource(R.string.coaching_profile_intermediate)
    CoachingTrainingLevel.ADVANCED -> stringResource(R.string.coaching_profile_advanced)
}

@Composable
private fun limitationKindLabel(value: CoachingLimitationKind): String = when (value) {
    CoachingLimitationKind.PAIN -> stringResource(R.string.coaching_profile_limitation_pain)
    CoachingLimitationKind.INJURY -> stringResource(R.string.coaching_profile_limitation_injury)
    CoachingLimitationKind.FORBIDDEN_MOVEMENT -> stringResource(R.string.coaching_profile_limitation_forbidden_movement)
    CoachingLimitationKind.DISCOURAGED_MOVEMENT -> stringResource(R.string.coaching_profile_limitation_discouraged_movement)
    CoachingLimitationKind.FORBIDDEN_EXERCISE -> stringResource(R.string.coaching_profile_limitation_forbidden_exercise)
    CoachingLimitationKind.DISCOURAGED_EXERCISE -> stringResource(R.string.coaching_profile_limitation_discouraged_exercise)
}

@Composable
private fun activityTypeLabel(value: CoachingOutsideActivityType): String = when (value) {
    CoachingOutsideActivityType.CARDIO -> stringResource(R.string.coaching_profile_activity_cardio)
    CoachingOutsideActivityType.SPORT -> stringResource(R.string.coaching_profile_activity_sport)
    CoachingOutsideActivityType.PHYSICAL_WORK -> stringResource(R.string.coaching_profile_activity_physical_work)
}

@Composable
private fun activityIntensityLabel(value: CoachingActivityIntensity): String = when (value) {
    CoachingActivityIntensity.LOW -> stringResource(R.string.coaching_profile_intensity_low)
    CoachingActivityIntensity.MODERATE -> stringResource(R.string.coaching_profile_intensity_moderate)
    CoachingActivityIntensity.HIGH -> stringResource(R.string.coaching_profile_intensity_high)
}

@Composable
private fun weekdayLabel(day: Int): String = stringResource(
    when (day) {
        1 -> R.string.coaching_profile_monday
        2 -> R.string.coaching_profile_tuesday
        3 -> R.string.coaching_profile_wednesday
        4 -> R.string.coaching_profile_thursday
        5 -> R.string.coaching_profile_friday
        6 -> R.string.coaching_profile_saturday
        else -> R.string.coaching_profile_sunday
    },
)

private fun formatServerTimestamp(value: String): String? = runCatching {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault())
        .format(OffsetDateTime.parse(value).atZoneSameInstant(java.time.ZoneId.systemDefault()))
}.getOrNull()

private fun CoachingLimitationsDraftValue?.orEmptyEntries() = this ?: CoachingLimitationsDraftValue()

internal fun mergeSectionDraft(
    current: CoachingProfileDraft,
    submitted: CoachingProfileDraft,
    saved: CoachingProfileDraft,
    section: CoachingProfileSection,
): CoachingProfileDraft = when (section) {
    CoachingProfileSection.SAFETY -> current.copy(
        healthStatus = keepCurrentEdit(current.healthStatus, submitted.healthStatus, saved.healthStatus),
        trainingLevel = keepCurrentEdit(current.trainingLevel, submitted.trainingLevel, saved.trainingLevel),
        availableWeekdays = keepCurrentEdit(
            current.availableWeekdays,
            submitted.availableWeekdays,
            saved.availableWeekdays,
        ),
        maximumSessionDurationMin = keepCurrentEdit(
            current.maximumSessionDurationMin,
            submitted.maximumSessionDurationMin,
            saved.maximumSessionDurationMin,
        ),
    )
    CoachingProfileSection.LIMITATIONS -> current.copy(
        limitations = keepCurrentEdit(current.limitations, submitted.limitations, saved.limitations),
    )
    CoachingProfileSection.PREFERENCES -> current.copy(
        priorityMuscles = keepCurrentEdit(
            current.priorityMuscles,
            submitted.priorityMuscles,
            saved.priorityMuscles,
        ),
        priorityStrengthMovements = keepCurrentEdit(
            current.priorityStrengthMovements,
            submitted.priorityStrengthMovements,
            saved.priorityStrengthMovements,
        ),
        outsideActivities = keepCurrentEdit(
            current.outsideActivities,
            submitted.outsideActivities,
            saved.outsideActivities,
        ),
        likedExercises = keepCurrentEdit(current.likedExercises, submitted.likedExercises, saved.likedExercises),
        dislikedExercises = keepCurrentEdit(
            current.dislikedExercises,
            submitted.dislikedExercises,
            saved.dislikedExercises,
        ),
    )
    CoachingProfileSection.RECOVERY -> current.copy(
        averageSleepHours = keepCurrentEdit(
            current.averageSleepHours,
            submitted.averageSleepHours,
            saved.averageSleepHours,
        ),
        baselineStress = keepCurrentEdit(current.baselineStress, submitted.baselineStress, saved.baselineStress),
        generalRecovery = keepCurrentEdit(current.generalRecovery, submitted.generalRecovery, saved.generalRecovery),
    )
}

internal fun mergeProfileDraftKeepingEdits(
    current: CoachingProfileDraft,
    baseline: CoachingProfileDraft,
    saved: CoachingProfileDraft,
): CoachingProfileDraft = CoachingProfileSection.entries.fold(current) { merged, section ->
    mergeSectionDraft(merged, baseline, saved, section)
}

private fun <T> keepCurrentEdit(current: T, submitted: T, saved: T): T =
    if (current == submitted) saved else current

private val coachingProfileStateJson = Json {
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
}

private val coachingProfileSaver = Saver<CoachingProfileDto, String>(
    save = { coachingProfileStateJson.encodeToString(it) },
    restore = { runCatching { coachingProfileStateJson.decodeFromString<CoachingProfileDto>(it) }.getOrNull() },
)

private val coachingDraftSaver = Saver<CoachingProfileDraft, String>(
    save = { coachingProfileStateJson.encodeToString(it) },
    restore = { runCatching { coachingProfileStateJson.decodeFromString<CoachingProfileDraft>(it) }.getOrNull() },
)

private val settingsErrorKindSaver = Saver<SettingsErrorKind?, String>(
    save = { it?.name.orEmpty() },
    restore = { name ->
        name.takeIf(String::isNotEmpty)?.let {
            runCatching { SettingsErrorKind.valueOf(it) }.getOrNull()
        }
    },
)

private val stringSetSaver = Saver<Set<String>, ArrayList<String>>(
    save = { ArrayList(it) },
    restore = { it.toSet() },
)
