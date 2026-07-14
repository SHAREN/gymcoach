@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package org.sharteman.gymcoach.ui.settings

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.sharteman.gymcoach.BuildConfig
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.network.enqueueAndroidUpdate
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.data.settings.AndroidPreferenceState
import org.sharteman.gymcoach.data.settings.AndroidPreferences
import org.sharteman.gymcoach.data.settings.AndroidReleaseDto
import org.sharteman.gymcoach.data.settings.AppThemeMode
import org.sharteman.gymcoach.data.settings.SettingsDataSource
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import org.sharteman.gymcoach.data.settings.SettingsGymExerciseConfigDto
import org.sharteman.gymcoach.data.settings.SettingsGymEquipmentDto
import org.sharteman.gymcoach.data.settings.SettingsImportFormat
import org.sharteman.gymcoach.data.settings.SettingsImportPreview
import org.sharteman.gymcoach.data.settings.SettingsRepository
import org.sharteman.gymcoach.data.settings.SettingsSnapshot
import org.sharteman.gymcoach.data.settings.classifySettingsError
import org.sharteman.gymcoach.training.SetTableMetric
import org.sharteman.gymcoach.training.setTableMetricEnabled

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenWebPath: (String) -> Unit,
    appRepository: GymCoachRepository? = null,
    repository: SettingsDataSource = SettingsRepository.create(LocalContext.current),
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val account = remember(context) { SecureAccountStore(context.applicationContext) }
    val preferenceStore = remember(context) { AndroidPreferences(context.applicationContext) }
    var preferences by remember { mutableStateOf(preferenceStore.load()) }
    var primaryServerUrl by rememberSaveable { mutableStateOf(account.primaryServerUrl) }
    var fallbackServerUrl by rememberSaveable { mutableStateOf(account.fallbackServerUrl.orEmpty()) }
    var activeServerUrl by remember { mutableStateOf(account.serverUrl) }
    var snapshot by remember { mutableStateOf<SettingsSnapshot?>(null) }
    var profileDraft by remember { mutableStateOf(ProfileDraft()) }
    var gymDraft by remember { mutableStateOf(GymDraft()) }
    var selectedExerciseId by rememberSaveable { mutableStateOf<String?>(null) }
    var exerciseWeightText by rememberSaveable { mutableStateOf("") }
    var release by remember { mutableStateOf<AndroidReleaseDto?>(null) }
    var resolvedDownloadUrl by remember { mutableStateOf<String?>(null) }
    var importFormat by rememberSaveable { mutableStateOf(SettingsImportFormat.STRONG) }
    var importUnit by rememberSaveable { mutableStateOf("KG") }
    var importPreview by remember { mutableStateOf<SettingsImportPreview?>(null) }
    var pendingBackup by remember { mutableStateOf<Pair<String, String>?>(null) }
    var restoreBackup by remember { mutableStateOf<Pair<String, String>?>(null) }
    var deleteGym by remember { mutableStateOf(false) }
    var equipmentEditor by remember { mutableStateOf<GymEquipmentDraft?>(null) }
    var equipmentToDelete by remember { mutableStateOf<SettingsGymEquipmentDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    fun showFailure(throwable: Throwable, apkCheck: Boolean = false) {
        error = settingsErrorMessage(context, throwable, apkCheck)
        feedback = null
    }

    suspend fun refresh(preferredGymId: String? = gymDraft.id) {
        loading = snapshot == null
        error = null
        runCatching { repository.load() }
            .onSuccess { loaded ->
                snapshot = loaded
                profileDraft = loaded.profile.toDraft()
                val selected = loaded.gymList.gyms.firstOrNull { it.id == preferredGymId }
                    ?: loaded.gymList.gyms.firstOrNull { it.id == loaded.gymList.activeGymId }
                    ?: loaded.gymList.gyms.firstOrNull()
                gymDraft = selected?.toDraft() ?: GymDraft()
                selectedExerciseId = loaded.exercises.firstOrNull()?.id
                exerciseWeightText = selectedExerciseId?.let { exerciseId ->
                    formatWeightList(gymDraft.configs[exerciseId]?.weightOptions.orEmpty())
                }.orEmpty()
                loading = false
            }
            .onFailure {
                loading = false
                showFailure(it)
            }
    }

    fun savePreferences(next: AndroidPreferenceState) {
        preferences = next
        preferenceStore.save(next)
    }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        val backup = pendingBackup
        pendingBackup = null
        if (uri != null && backup != null) {
            scope.launch {
                runCatching { writeText(context, uri, backup.second) }
                    .onSuccess {
                        feedback = context.getString(R.string.settings_native_backup_exported)
                        error = null
                    }
                    .onFailure { showFailure(it) }
            }
        }
    }
    val restoreLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching { readBytes(context, uri).toString(Charsets.UTF_8) }
                    .onSuccess { restoreBackup = (uri.lastPathSegment ?: "backup.json") to it }
                    .onFailure { showFailure(it) }
            }
        }
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            scope.launch {
                busy = true
                val fileName = uri.lastPathSegment ?: importFormat.name.lowercase()
                runCatching {
                    val bytes = readBytes(context, uri)
                    val payload = if (importFormat == SettingsImportFormat.FIT) {
                        Base64.encodeToString(bytes, Base64.NO_WRAP)
                    } else {
                        bytes.toString(Charsets.UTF_8)
                    }
                    repository.previewImport(importFormat, fileName, payload, importUnit)
                }.onSuccess {
                    importPreview = it
                    feedback = null
                    error = null
                }.onFailure { showFailure(it) }
                busy = false
            }
        }
    }
    val equipmentImageLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val equipmentId = equipmentEditor?.id
        val gymId = gymDraft.id
        if (uri != null && equipmentId != null && gymId != null) {
            scope.launch {
                busy = true
                runCatching {
                    val selected = readEquipmentImage(context, uri)
                    repository.uploadGymEquipmentImage(
                        equipmentId = equipmentId,
                        imageBase64 = Base64.encodeToString(selected.bytes, Base64.NO_WRAP),
                        mimeType = selected.mimeType,
                    )
                }.onSuccess {
                    equipmentEditor = null
                    feedback = context.getString(R.string.settings_equipment_photo_saved)
                    error = null
                    refresh(gymId)
                }.onFailure { failure ->
                    val validation = failure as? EquipmentImageValidationException
                    if (validation != null) {
                        error = context.getString(
                            when (validation.issue) {
                                EquipmentImageIssue.TOO_LARGE -> R.string.settings_equipment_image_too_large
                                EquipmentImageIssue.UNSUPPORTED_TYPE -> R.string.settings_equipment_image_bad_type
                                EquipmentImageIssue.EMPTY -> R.string.settings_equipment_image_empty
                            },
                        )
                        feedback = null
                    } else {
                        showFailure(failure)
                    }
                }
                busy = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_native_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                    }
                },
                actions = {
                    IconButton(onClick = { scope.launch { refresh() } }, enabled = !busy) {
                        Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.settings_native_refresh))
                    }
                },
            )
        },
    ) { padding ->
        if (loading) {
            Column(
                Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) { CircularProgressIndicator() }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).testTag("settings-native-screen"),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { Spacer(Modifier.height(1.dp)) }
                item {
                    MessageBanner(error = error, feedback = feedback)
                }
                item {
                    SettingsCard(stringResource(R.string.settings_native_account)) {
                        Text(snapshot?.profile?.email.orEmpty(), fontWeight = FontWeight.Medium)
                        Text(
                            stringResource(R.string.settings_native_active_server, activeServerUrl),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = primaryServerUrl,
                            onValueChange = { primaryServerUrl = it },
                            label = { Text(stringResource(R.string.settings_native_primary_server)) },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().testTag("settings-primary-server"),
                        )
                        OutlinedTextField(
                            value = fallbackServerUrl,
                            onValueChange = { fallbackServerUrl = it },
                            label = { Text(stringResource(R.string.settings_native_fallback_server)) },
                            supportingText = {
                                Text(stringResource(R.string.settings_native_fallback_server_hint))
                            },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth().testTag("settings-fallback-server"),
                        )
                        Button(
                            onClick = {
                                scope.launch {
                                    busy = true
                                    runCatching {
                                        if (appRepository != null) {
                                            appRepository.configureServerUrls(
                                                primaryServerUrl,
                                                fallbackServerUrl,
                                            )
                                        } else {
                                            account.configureServerUrls(primaryServerUrl, fallbackServerUrl)
                                            account.serverUrl
                                        }
                                    }.onSuccess { selectedServer ->
                                        primaryServerUrl = account.primaryServerUrl
                                        fallbackServerUrl = account.fallbackServerUrl.orEmpty()
                                        activeServerUrl = selectedServer
                                        feedback = context.getString(R.string.settings_native_server_saved)
                                        error = null
                                    }.onFailure { showFailure(it) }
                                    busy = false
                                }
                            },
                            enabled = !busy && primaryServerUrl.isNotBlank(),
                            modifier = Modifier.testTag("settings-save-servers"),
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null)
                            Text(
                                stringResource(R.string.settings_native_save),
                                Modifier.padding(start = 6.dp),
                            )
                        }
                    }
                }
                item {
                    UpdateSection(
                        release = release,
                        resolvedUrl = resolvedDownloadUrl,
                        busy = busy,
                        onCheck = {
                            scope.launch {
                                busy = true
                                runCatching { repository.latestRelease() }
                                    .onSuccess {
                                        release = it
                                        val resolved = runCatching {
                                            repository.releaseDownloadUrl(it)
                                        }.getOrElse { urlError ->
                                            showFailure(urlError, apkCheck = true)
                                            null
                                        }
                                        resolvedDownloadUrl = resolved
                                        if (resolved != null) {
                                            if (it.versionCode <= BuildConfig.VERSION_CODE) {
                                                feedback = context.getString(R.string.settings_native_up_to_date)
                                            }
                                            error = null
                                        }
                                    }
                                    .onFailure { showFailure(it, apkCheck = true) }
                                busy = false
                            }
                        },
                        onDownload = {
                            val currentRelease = release
                            val url = resolvedDownloadUrl
                            if (currentRelease != null && url != null) {
                                runCatching {
                                    enqueueAndroidUpdate(context, url, currentRelease.versionName)
                                }
                                    .onSuccess {
                                        feedback = context.getString(R.string.settings_native_download_started)
                                        error = null
                                    }
                                    .onFailure {
                                        error = context.getString(R.string.settings_native_download_manager_error)
                                        feedback = null
                                    }
                            }
                        },
                    )
                }
                item {
                    ProfileSection(
                        draft = profileDraft,
                        onChange = { profileDraft = it },
                        busy = busy,
                        onSave = {
                            val input = profileDraft.toInputOrNull()
                            if (input == null) {
                                error = context.getString(R.string.settings_native_invalid_profile)
                            } else {
                                scope.launch {
                                    busy = true
                                    runCatching { repository.saveProfile(input) }
                                        .onSuccess { saved ->
                                            profileDraft = saved.toDraft()
                                            feedback = context.getString(R.string.settings_native_saved)
                                            error = null
                                        }
                                        .onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                    )
                }
                item {
                    PreferencesSection(
                        state = preferences,
                        onChange = ::savePreferences,
                    )
                }
                item {
                    GymSection(
                        snapshot = snapshot,
                        draft = gymDraft,
                        selectedExerciseId = selectedExerciseId,
                        exerciseWeightText = exerciseWeightText,
                        busy = busy,
                        onSelectGym = { gymId ->
                            val selected = snapshot?.gymList?.gyms?.firstOrNull { it.id == gymId }
                            gymDraft = selected?.toDraft() ?: GymDraft()
                            val firstExercise = snapshot?.exercises?.firstOrNull()?.id
                            selectedExerciseId = firstExercise
                            exerciseWeightText = firstExercise?.let {
                                formatWeightList(gymDraft.configs[it]?.weightOptions.orEmpty())
                            }.orEmpty()
                        },
                        onDraftChange = { gymDraft = it },
                        onSelectExercise = { id ->
                            selectedExerciseId = id
                            exerciseWeightText = formatWeightList(gymDraft.configs[id]?.weightOptions.orEmpty())
                        },
                        onExerciseAvailability = { available ->
                            val id = selectedExerciseId ?: return@GymSection
                            val previous = gymDraft.configs[id] ?: SettingsGymExerciseConfigDto(exerciseId = id)
                            gymDraft = gymDraft.copy(configs = gymDraft.configs + (id to previous.copy(isAvailable = available)))
                        },
                        onExerciseWeightsChange = { text ->
                            exerciseWeightText = text
                            val id = selectedExerciseId
                            val parsed = parseWeightList(text)
                            if (id != null && parsed != null) {
                                val previous = gymDraft.configs[id] ?: SettingsGymExerciseConfigDto(exerciseId = id)
                                gymDraft = gymDraft.copy(configs = gymDraft.configs + (id to previous.copy(weightOptions = parsed)))
                            }
                        },
                        onSave = {
                            val selectedWeights = parseWeightList(exerciseWeightText)
                            val selectedId = selectedExerciseId
                            val committedDraft = if (selectedId != null && selectedWeights != null) {
                                val previous = gymDraft.configs[selectedId]
                                    ?: SettingsGymExerciseConfigDto(exerciseId = selectedId)
                                gymDraft.copy(
                                    configs = gymDraft.configs +
                                        (selectedId to previous.copy(weightOptions = selectedWeights)),
                                )
                            } else gymDraft
                            val input = committedDraft.toInputOrNull(makeActive = committedDraft.id == null)
                            if (input == null || selectedWeights == null) {
                                error = context.getString(R.string.settings_native_invalid_gym)
                            } else {
                                scope.launch {
                                    busy = true
                                    runCatching {
                                        committedDraft.id?.let { repository.updateGym(it, input) }
                                            ?: repository.createGym(input)
                                    }.onSuccess {
                                        feedback = context.getString(R.string.settings_native_saved)
                                        refresh()
                                    }.onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                        onActivate = {
                            gymDraft.id?.let { id ->
                                scope.launch {
                                    busy = true
                                    runCatching { repository.activateGym(id) }
                                        .onSuccess { refresh() }
                                        .onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                        onDelete = { deleteGym = true },
                    )
                }
                item {
                    GymEquipmentSection(
                        snapshot = snapshot,
                        gymId = gymDraft.id,
                        editor = equipmentEditor,
                        busy = busy,
                        imageAuthorization = repository.equipmentImageAuthorization(),
                        onNew = { equipmentEditor = GymEquipmentDraft() },
                        onEdit = { equipmentEditor = it.toDraft() },
                        onEditorChange = { equipmentEditor = it },
                        onDismissEditor = { equipmentEditor = null },
                        onSave = {
                            val gymId = gymDraft.id
                            val draft = equipmentEditor
                            val input = draft?.toInputOrNull()
                            if (gymId == null || draft == null || input == null) {
                                error = context.getString(R.string.settings_equipment_invalid)
                                feedback = null
                            } else {
                                scope.launch {
                                    busy = true
                                    runCatching {
                                        repository.saveGymEquipment(gymId, draft.id, input)
                                    }.onSuccess {
                                        equipmentEditor = null
                                        feedback = context.getString(R.string.settings_equipment_saved)
                                        error = null
                                        refresh(gymId)
                                    }.onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                        onDelete = { equipmentToDelete = it },
                        onUploadImage = {
                            equipmentImageLauncher.launch(arrayOf("image/jpeg", "image/png", "image/webp"))
                        },
                        onSetImageUrl = {
                            val gymId = gymDraft.id
                            val draft = equipmentEditor
                            val imageUrl = draft?.imageUrl?.let(::validEquipmentImageUrl)
                            if (gymId == null || draft?.id == null || imageUrl == null) {
                                error = context.getString(R.string.settings_equipment_image_url_invalid)
                                feedback = null
                            } else {
                                scope.launch {
                                    busy = true
                                    runCatching { repository.setGymEquipmentImageUrl(draft.id, imageUrl) }
                                        .onSuccess {
                                            equipmentEditor = null
                                            feedback = context.getString(R.string.settings_equipment_photo_saved)
                                            error = null
                                            refresh(gymId)
                                        }
                                        .onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                        onClearImage = {
                            val gymId = gymDraft.id
                            val equipmentId = equipmentEditor?.id
                            if (gymId != null && equipmentId != null) {
                                scope.launch {
                                    busy = true
                                    runCatching { repository.clearGymEquipmentImage(equipmentId) }
                                        .onSuccess {
                                            equipmentEditor = null
                                            feedback = context.getString(R.string.settings_equipment_photo_removed)
                                            error = null
                                            refresh(gymId)
                                        }
                                        .onFailure { showFailure(it) }
                                    busy = false
                                }
                            }
                        },
                    )
                }
                item {
                    ImportSection(
                        format = importFormat,
                        unit = importUnit,
                        preview = importPreview,
                        busy = busy,
                        onFormat = {
                            importFormat = it
                            importPreview = null
                        },
                        onUnit = { importUnit = it },
                        onPick = { importLauncher.launch(arrayOf("*/*")) },
                        onConfirm = {
                            val preview = importPreview ?: return@ImportSection
                            scope.launch {
                                busy = true
                                runCatching { repository.confirmImport(preview) }
                                    .onSuccess {
                                        feedback = context.getString(
                                            R.string.settings_native_import_done,
                                            importResultSummary(it).localized(context),
                                        )
                                        importPreview = null
                                        error = null
                                        refresh()
                                    }.onFailure { showFailure(it) }
                                busy = false
                            }
                        },
                    )
                }
                item {
                    BackupSection(
                        busy = busy,
                        onExport = {
                            scope.launch {
                                busy = true
                                runCatching { repository.exportBackup() }
                                    .onSuccess {
                                        val name = "gymcoach-backup-${LocalDate.now()}.json"
                                        pendingBackup = name to it
                                        exportLauncher.launch(name)
                                    }
                                    .onFailure { showFailure(it) }
                                busy = false
                            }
                        },
                        onRestore = { restoreLauncher.launch(arrayOf("application/json", "text/json")) },
                    )
                }
                item {
                    OutlinedButton(
                        onClick = { onOpenWebPath("/settings") },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    ) { Text(stringResource(R.string.settings_native_open_web)) }
                }
                item { Spacer(Modifier.height(20.dp)) }
            }
        }
    }

    if (deleteGym) {
        AlertDialog(
            onDismissRequest = { deleteGym = false },
            title = { Text(stringResource(R.string.settings_native_delete_gym_title)) },
            text = { Text(stringResource(R.string.settings_native_delete_gym_body)) },
            confirmButton = {
                TextButton(onClick = {
                    deleteGym = false
                    gymDraft.id?.let { id ->
                        scope.launch {
                            busy = true
                            runCatching { repository.deleteGym(id) }
                                .onSuccess { refresh() }
                                .onFailure { showFailure(it) }
                            busy = false
                        }
                    }
                }) { Text(stringResource(R.string.settings_native_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { deleteGym = false }) {
                    Text(stringResource(R.string.settings_native_cancel))
                }
            },
        )
    }

    equipmentToDelete?.let { item ->
        AlertDialog(
            onDismissRequest = { equipmentToDelete = null },
            title = { Text(stringResource(R.string.settings_equipment_delete_title)) },
            text = { Text(stringResource(R.string.settings_equipment_delete_body, item.name)) },
            confirmButton = {
                TextButton(onClick = {
                    equipmentToDelete = null
                    val gymId = gymDraft.id
                    if (gymId != null) {
                        scope.launch {
                            busy = true
                            runCatching { repository.deleteGymEquipment(item.id) }
                                .onSuccess {
                                    feedback = context.getString(R.string.settings_equipment_deleted)
                                    error = null
                                    refresh(gymId)
                                }
                                .onFailure { showFailure(it) }
                            busy = false
                        }
                    }
                }) { Text(stringResource(R.string.settings_native_delete)) }
            },
            dismissButton = {
                TextButton(onClick = { equipmentToDelete = null }) {
                    Text(stringResource(R.string.settings_native_cancel))
                }
            },
        )
    }

    restoreBackup?.let { backup ->
        AlertDialog(
            onDismissRequest = { restoreBackup = null },
            title = { Text(stringResource(R.string.settings_native_backup_restore_title)) },
            text = { Text(stringResource(R.string.settings_native_backup_restore_body, backup.first)) },
            confirmButton = {
                TextButton(onClick = {
                    restoreBackup = null
                    scope.launch {
                        busy = true
                        runCatching { repository.restoreBackup(backup.second) }
                            .onSuccess {
                                feedback = context.getString(R.string.settings_native_backup_restored)
                                error = null
                                refresh()
                            }
                            .onFailure { showFailure(it) }
                        busy = false
                    }
                }) { Text(stringResource(R.string.settings_native_replace)) }
            },
            dismissButton = {
                TextButton(onClick = { restoreBackup = null }) {
                    Text(stringResource(R.string.settings_native_cancel))
                }
            },
        )
    }
}

@Composable
private fun MessageBanner(error: String?, feedback: String?) {
    val message = error ?: feedback ?: return
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (error != null) MaterialTheme.colorScheme.errorContainer
            else MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Text(message, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
private fun UpdateSection(
    release: AndroidReleaseDto?,
    resolvedUrl: String?,
    busy: Boolean,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
) {
    SettingsCard(stringResource(R.string.settings_native_update)) {
        Text(stringResource(R.string.settings_native_current_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE))
        release?.let {
            Text(
                stringResource(
                    R.string.settings_native_latest_version,
                    it.versionName,
                    it.versionCode,
                    humanFileSize(it.sizeBytes),
                ),
            )
        }
        resolvedUrl?.let {
            Text(
                stringResource(R.string.settings_native_update_url, it),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = onCheck,
                enabled = !busy,
                modifier = Modifier.testTag("settings-check-update"),
            ) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Text(stringResource(R.string.settings_native_check_update), Modifier.padding(start = 6.dp))
            }
            if (release != null && resolvedUrl != null && release.versionCode > BuildConfig.VERSION_CODE) {
                Button(onClick = onDownload, enabled = !busy, modifier = Modifier.testTag("settings-download-apk")) {
                    Icon(Icons.Default.CloudDownload, contentDescription = null)
                    Text(stringResource(R.string.settings_native_download_update), Modifier.padding(start = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun ProfileSection(
    draft: ProfileDraft,
    onChange: (ProfileDraft) -> Unit,
    busy: Boolean,
    onSave: () -> Unit,
) {
    SettingsCard(stringResource(R.string.settings_native_profile)) {
        OutlinedTextField(
            value = draft.displayName,
            onValueChange = { onChange(draft.copy(displayName = it)) },
            label = { Text(stringResource(R.string.settings_native_display_name)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = draft.bodyweight,
                onValueChange = { onChange(draft.copy(bodyweight = it)) },
                label = { Text(stringResource(R.string.settings_native_bodyweight)) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            OutlinedTextField(
                value = draft.heightCm,
                onValueChange = { onChange(draft.copy(heightCm = it)) },
                label = { Text(stringResource(R.string.settings_native_height)) },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
        }
        OutlinedTextField(
            value = draft.weeklyFrequency,
            onValueChange = { onChange(draft.copy(weeklyFrequency = it)) },
            label = { Text(stringResource(R.string.settings_native_frequency)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        ChoiceDropdown(
            label = stringResource(R.string.settings_native_sex),
            value = draft.sex,
            options = listOf(null, "MALE", "FEMALE", "OTHER"),
            optionLabel = { sexLabel(it) },
            onSelect = { onChange(draft.copy(sex = it)) },
        )
        ChoiceDropdown(
            label = stringResource(R.string.settings_native_goal),
            value = draft.goal,
            options = listOf(null, "HYPERTROPHY", "STRENGTH", "FAT_LOSS", "RECOMP", "GENERAL_FITNESS"),
            optionLabel = { goalLabel(it) },
            onSelect = { onChange(draft.copy(goal = it)) },
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("KG", "LB").forEach { unit ->
                FilterChip(
                    selected = draft.unit == unit,
                    onClick = { onChange(draft.copy(unit = unit)) },
                    label = { Text(unit) },
                )
            }
        }
        Button(onClick = onSave, enabled = !busy, modifier = Modifier.testTag("settings-save-profile")) {
            Icon(Icons.Default.Save, contentDescription = null)
            Text(stringResource(R.string.settings_native_save), Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun PreferencesSection(
    state: AndroidPreferenceState,
    onChange: (AndroidPreferenceState) -> Unit,
) {
    SettingsCard(stringResource(R.string.settings_native_device)) {
        Text(stringResource(R.string.settings_native_theme), fontWeight = FontWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AppThemeMode.entries.forEach { theme ->
                FilterChip(
                    selected = state.theme == theme,
                    onClick = { onChange(state.copy(theme = theme)) },
                    label = {
                        Text(
                            when (theme) {
                                AppThemeMode.DARK -> stringResource(R.string.settings_native_theme_dark)
                                AppThemeMode.LIGHT -> stringResource(R.string.settings_native_theme_light)
                                AppThemeMode.SYSTEM -> stringResource(R.string.settings_native_theme_system)
                            },
                        )
                    },
                )
            }
        }
        PreferenceSwitch(
            stringResource(R.string.settings_native_vibration),
            state.vibration,
        ) { onChange(state.copy(vibration = it)) }
        PreferenceSwitch(
            stringResource(R.string.settings_native_timer_sound),
            state.restTimerSound,
        ) { onChange(state.copy(restTimerSound = it)) }
        PreferenceSwitch(
            stringResource(R.string.settings_native_readiness),
            state.readinessAutoRegulation,
        ) { onChange(state.copy(readinessAutoRegulation = it)) }
        Text(stringResource(R.string.settings_native_metrics), fontWeight = FontWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SetTableMetric.entries.forEach { metric ->
                val enabled = metric in state.setTableMetrics
                FilterChip(
                    selected = enabled,
                    onClick = {
                        onChange(
                            state.copy(
                                setTableMetrics = setTableMetricEnabled(
                                    state.setTableMetrics,
                                    metric,
                                    !enabled,
                                ),
                            ),
                        )
                    },
                    label = { Text(metricLabel(metric)) },
                )
            }
        }
    }
}

@Composable
private fun GymSection(
    snapshot: SettingsSnapshot?,
    draft: GymDraft,
    selectedExerciseId: String?,
    exerciseWeightText: String,
    busy: Boolean,
    onSelectGym: (String?) -> Unit,
    onDraftChange: (GymDraft) -> Unit,
    onSelectExercise: (String) -> Unit,
    onExerciseAvailability: (Boolean) -> Unit,
    onExerciseWeightsChange: (String) -> Unit,
    onSave: () -> Unit,
    onActivate: () -> Unit,
    onDelete: () -> Unit,
) {
    val gyms = snapshot?.gymList?.gyms.orEmpty()
    val exercises = snapshot?.exercises.orEmpty()
    val activeId = snapshot?.gymList?.activeGymId
    SettingsCard(stringResource(R.string.settings_native_gym)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                FilterChip(
                    selected = draft.id == null,
                    onClick = { onSelectGym(null) },
                    label = { Text(stringResource(R.string.settings_native_new_gym)) },
                    leadingIcon = { Icon(Icons.Default.Add, contentDescription = null) },
                )
            }
            items(gyms, key = { it.id }) { gym ->
                FilterChip(
                    selected = draft.id == gym.id,
                    onClick = { onSelectGym(gym.id) },
                    label = {
                        Text(if (gym.id == activeId) "${gym.name} • ${stringResource(R.string.settings_native_active)}" else gym.name)
                    },
                )
            }
        }
        OutlinedTextField(
            value = draft.name,
            onValueChange = { onDraftChange(draft.copy(name = it)) },
            label = { Text(stringResource(R.string.settings_native_gym_name)) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        WeightField(R.string.settings_native_dumbbells, draft.dumbbellWeights) {
            onDraftChange(draft.copy(dumbbellWeights = it))
        }
        WeightField(R.string.settings_native_plates, draft.plateWeights) {
            onDraftChange(draft.copy(plateWeights = it))
        }
        WeightField(R.string.settings_native_bars, draft.barWeights) {
            onDraftChange(draft.copy(barWeights = it))
        }
        Text(
            stringResource(R.string.settings_native_weight_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider()
        Text(stringResource(R.string.settings_native_exercise_equipment), fontWeight = FontWeight.Medium)
        ExerciseDropdown(exercises, selectedExerciseId, onSelectExercise)
        selectedExerciseId?.let { exerciseId ->
            val config = draft.configs[exerciseId]
            PreferenceSwitch(
                stringResource(R.string.settings_native_available),
                config?.isAvailable ?: true,
                onExerciseAvailability,
            )
            WeightField(R.string.settings_native_machine_weights, exerciseWeightText, onExerciseWeightsChange)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onSave, enabled = !busy, modifier = Modifier.testTag("settings-save-gym")) {
                Icon(Icons.Default.Save, contentDescription = null)
                Text(stringResource(R.string.settings_native_save), Modifier.padding(start = 6.dp))
            }
            if (draft.id != null && draft.id != activeId) {
                OutlinedButton(onClick = onActivate, enabled = !busy) {
                    Text(stringResource(R.string.settings_native_activate))
                }
            }
            if (draft.id != null) {
                IconButton(onClick = onDelete, enabled = !busy) {
                    Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.settings_native_delete))
                }
            }
        }
    }
}

@Composable
private fun ImportSection(
    format: SettingsImportFormat,
    unit: String,
    preview: SettingsImportPreview?,
    busy: Boolean,
    onFormat: (SettingsImportFormat) -> Unit,
    onUnit: (String) -> Unit,
    onPick: () -> Unit,
    onConfirm: () -> Unit,
) {
    val context = LocalContext.current
    SettingsCard(stringResource(R.string.settings_native_import)) {
        Text(
            stringResource(R.string.settings_native_import_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            SettingsImportFormat.entries.forEach { value ->
                FilterChip(
                    selected = format == value,
                    onClick = { onFormat(value) },
                    label = { Text(value.name) },
                )
            }
        }
        if (format == SettingsImportFormat.STRONG) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("KG", "LB").forEach { value ->
                    FilterChip(selected = unit == value, onClick = { onUnit(value) }, label = { Text(value) })
                }
            }
        }
        OutlinedButton(onClick = onPick, enabled = !busy) {
            Icon(Icons.Default.Upload, contentDescription = null)
            Text(stringResource(R.string.settings_native_pick_file), Modifier.padding(start = 6.dp))
        }
        preview?.let {
            Text(
                stringResource(
                    R.string.settings_native_preview,
                    importResultSummary(it.response).localized(context),
                ),
            )
            Button(onClick = onConfirm, enabled = !busy, modifier = Modifier.testTag("settings-confirm-import")) {
                Text(stringResource(R.string.settings_native_import_confirm))
            }
        }
    }
}

@Composable
private fun BackupSection(busy: Boolean, onExport: () -> Unit, onRestore: () -> Unit) {
    SettingsCard(stringResource(R.string.settings_native_backup)) {
        Text(
            stringResource(R.string.settings_native_backup_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onExport, enabled = !busy) {
            Icon(Icons.Default.Download, contentDescription = null)
            Text(stringResource(R.string.settings_native_backup_export), Modifier.padding(start = 6.dp))
        }
        OutlinedButton(onClick = onRestore, enabled = !busy) {
            Icon(Icons.Default.Upload, contentDescription = null)
            Text(stringResource(R.string.settings_native_backup_restore), Modifier.padding(start = 6.dp))
        }
    }
}

@Composable
private fun PreferenceSwitch(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun WeightField(labelRes: Int, value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(stringResource(labelRes)) },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}

@Composable
private fun ChoiceDropdown(
    label: String,
    value: String?,
    options: List<String?>,
    optionLabel: @Composable (String?) -> String,
    onSelect: (String?) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(optionLabel(value), Modifier.weight(1f))
            Icon(Icons.Default.MoreVert, contentDescription = null)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        expanded = false
                        onSelect(option)
                    },
                )
            }
        }
    }
}

@Composable
private fun ExerciseDropdown(
    exercises: List<ExerciseDto>,
    selectedId: String?,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selected = exercises.firstOrNull { it.id == selectedId }
    OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
        Text(
            selected?.name ?: stringResource(R.string.settings_native_choose_exercise),
            Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Icon(Icons.Default.MoreVert, contentDescription = null)
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
        exercises.forEach { exercise ->
            DropdownMenuItem(
                text = { Text(exercise.name) },
                onClick = {
                    expanded = false
                    onSelect(exercise.id)
                },
            )
        }
    }
}

@Composable
private fun sexLabel(value: String?): String = when (value) {
    "MALE" -> stringResource(R.string.settings_native_male)
    "FEMALE" -> stringResource(R.string.settings_native_female)
    "OTHER" -> stringResource(R.string.settings_native_other)
    else -> stringResource(R.string.settings_native_not_set)
}

@Composable
private fun goalLabel(value: String?): String = when (value) {
    "HYPERTROPHY" -> stringResource(R.string.settings_native_hypertrophy)
    "STRENGTH" -> stringResource(R.string.settings_native_strength)
    "FAT_LOSS" -> stringResource(R.string.settings_native_fat_loss)
    "RECOMP" -> stringResource(R.string.settings_native_recomp)
    "GENERAL_FITNESS" -> stringResource(R.string.settings_native_general_fitness)
    else -> stringResource(R.string.settings_native_not_set)
}

private fun org.sharteman.gymcoach.data.settings.SettingsProfileDto.toDraft() = ProfileDraft(
    displayName = displayName.orEmpty(),
    bodyweight = bodyweight?.toString().orEmpty(),
    sex = sex,
    heightCm = heightCm?.toString().orEmpty(),
    goal = goal,
    weeklyFrequency = weeklyFrequency?.toString().orEmpty(),
    unit = unit,
)

@Composable
private fun metricLabel(metric: SetTableMetric): String = when (metric) {
    SetTableMetric.ONE_RM -> stringResource(R.string.set_metric_one_rm_short)
    SetTableMetric.TEN_RM -> stringResource(R.string.set_metric_ten_rm_short)
    SetTableMetric.VOLUME -> stringResource(R.string.set_metric_volume_short)
}

private fun humanFileSize(bytes: Long): String = when {
    bytes >= 1024 * 1024 -> String.format(java.util.Locale.US, "%.1f MB", bytes / 1024.0 / 1024.0)
    bytes >= 1024 -> String.format(java.util.Locale.US, "%.1f KB", bytes / 1024.0)
    else -> "$bytes B"
}

private fun ImportResultSummary.localized(context: Context): String = listOfNotNull(
    sessions?.let { context.getString(R.string.settings_native_import_sessions, it) },
    sets?.let { context.getString(R.string.settings_native_import_sets, it) },
    exercises?.let { context.getString(R.string.settings_native_import_exercises, it) },
    sport?.let { context.getString(R.string.settings_native_import_sport, it) },
).joinToString(", ").ifBlank { context.getString(R.string.settings_native_import_ok) }

private suspend fun readBytes(context: Context, uri: Uri): ByteArray = withContext(Dispatchers.IO) {
    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        ?: throw java.io.IOException("Could not read the selected file.")
}

private suspend fun writeText(context: Context, uri: Uri, text: String) = withContext(Dispatchers.IO) {
    context.contentResolver.openOutputStream(uri, "wt")?.use { output ->
        output.write(text.toByteArray(Charsets.UTF_8))
    } ?: throw java.io.IOException("Could not write the backup file.")
}

private const val MAX_EQUIPMENT_IMAGE_BYTES = 5 * 1024 * 1024

private data class SelectedEquipmentImage(val bytes: ByteArray, val mimeType: String)

private enum class EquipmentImageIssue {
    TOO_LARGE,
    UNSUPPORTED_TYPE,
    EMPTY,
}

private class EquipmentImageValidationException(val issue: EquipmentImageIssue) : Exception()

private suspend fun readEquipmentImage(context: Context, uri: Uri): SelectedEquipmentImage =
    withContext(Dispatchers.IO) {
        val output = ByteArrayOutputStream()
        context.contentResolver.openInputStream(uri)?.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                output.write(buffer, 0, count)
                if (output.size() > MAX_EQUIPMENT_IMAGE_BYTES) {
                    throw EquipmentImageValidationException(EquipmentImageIssue.TOO_LARGE)
                }
            }
        } ?: throw java.io.IOException("Could not read the selected image.")
        val bytes = output.toByteArray()
        if (bytes.isEmpty()) throw EquipmentImageValidationException(EquipmentImageIssue.EMPTY)
        val detected = detectEquipmentImageMimeType(bytes)
            ?: throw EquipmentImageValidationException(EquipmentImageIssue.UNSUPPORTED_TYPE)
        val declared = when (context.contentResolver.getType(uri)?.lowercase()) {
            "image/jpg" -> "image/jpeg"
            else -> context.contentResolver.getType(uri)?.lowercase()
        }
        if (declared != null && declared !in setOf("image/jpeg", "image/png", "image/webp")) {
            throw EquipmentImageValidationException(EquipmentImageIssue.UNSUPPORTED_TYPE)
        }
        if (declared != null && declared != detected) {
            throw EquipmentImageValidationException(EquipmentImageIssue.UNSUPPORTED_TYPE)
        }
        SelectedEquipmentImage(bytes, detected)
    }

private fun detectEquipmentImageMimeType(bytes: ByteArray): String? = when {
    bytes.size >= 3 &&
        (bytes[0].toInt() and 0xff) == 0xff &&
        (bytes[1].toInt() and 0xff) == 0xd8 &&
        (bytes[2].toInt() and 0xff) == 0xff -> "image/jpeg"
    bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(
        byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ) -> "image/png"
    bytes.size >= 12 &&
        bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
        bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP" -> "image/webp"
    else -> null
}

private fun settingsErrorMessage(context: Context, throwable: Throwable, apkCheck: Boolean): String {
    val kind = (throwable as? SettingsException)?.kind ?: classifySettingsError(throwable)
    val resource = when (kind) {
        SettingsErrorKind.AUTHENTICATION -> R.string.settings_native_error_auth
        SettingsErrorKind.FORBIDDEN -> R.string.settings_native_error_forbidden
        SettingsErrorKind.NOT_FOUND -> if (apkCheck) R.string.settings_native_error_apk_missing
        else R.string.settings_native_error_invalid
        SettingsErrorKind.INVALID_DATA -> R.string.settings_native_error_invalid
        SettingsErrorKind.RATE_LIMIT -> R.string.settings_native_error_rate_limit
        SettingsErrorKind.BAD_GATEWAY -> R.string.settings_native_error_gateway
        SettingsErrorKind.SERVER_UNAVAILABLE -> R.string.settings_native_error_server
        SettingsErrorKind.DNS -> R.string.settings_native_error_dns
        SettingsErrorKind.TIMEOUT -> R.string.settings_native_error_timeout
        SettingsErrorKind.TLS -> R.string.settings_native_error_tls
        SettingsErrorKind.OFFLINE -> R.string.settings_native_error_offline
        SettingsErrorKind.INVALID_RESPONSE -> R.string.settings_native_error_response
        SettingsErrorKind.UNKNOWN -> R.string.settings_native_error_unknown
    }
    return context.getString(resource)
}
