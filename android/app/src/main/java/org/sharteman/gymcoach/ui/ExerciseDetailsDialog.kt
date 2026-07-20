package org.sharteman.gymcoach.ui

import androidx.annotation.StringRes
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.SkipNext
import androidx.compose.material.icons.outlined.SkipPrevious
import androidx.compose.material.icons.outlined.SportsGymnastics
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.SubcomposeAsyncImage
import coil.compose.SubcomposeAsyncImageContent
import coil.request.ImageRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.media.ExerciseMediaAsset
import org.sharteman.gymcoach.data.media.ExerciseMediaCatalog
import org.sharteman.gymcoach.data.model.ExerciseDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySessionDto
import org.sharteman.gymcoach.data.model.ExerciseHistorySetDto
import org.sharteman.gymcoach.data.model.LastPerformanceDto
import org.sharteman.gymcoach.data.model.MobileProgressPointDto
import org.sharteman.gymcoach.data.programs.ExerciseInput
import org.sharteman.gymcoach.training.SetTableMetric
import org.sharteman.gymcoach.training.formatSetTableMetric
import org.sharteman.gymcoach.training.roundWeight
import org.sharteman.gymcoach.training.toDisplayWeight
import org.sharteman.gymcoach.ui.localization.equipmentTypeDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseCategoryDisplayName
import org.sharteman.gymcoach.ui.localization.exerciseDisplayName
import org.sharteman.gymcoach.ui.localization.muscleGroupDisplayName
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ExerciseDetailsDialog(
    exercise: ExerciseDto,
    history: List<ExerciseHistorySessionDto>,
    fallbackPerformance: LastPerformanceDto?,
    progressPoints: List<MobileProgressPointDto>,
    unit: String,
    bodyweightKg: Double? = null,
    serverUrl: String,
    onOpenProgress: ((String) -> Unit)?,
    onOpenHistory: ((String, String) -> Unit)?,
    onDismiss: () -> Unit,
    editableUserId: String? = null,
    onUpdateExercise: (suspend (ExerciseDto, ExerciseInput) -> ExerciseDto)? = null,
    onExerciseUpdated: (ExerciseDto) -> Unit = {},
    onDelete: (() -> Unit)? = null,
    @StringRes backLabelRes: Int = R.string.back_to_workout,
    showCloseAction: Boolean = true,
) {
    val context = LocalContext.current
    var editedExercise by remember(exercise.id) { mutableStateOf<ExerciseDto?>(null) }
    val currentExercise = editedExercise ?: exercise
    val media = remember(context, currentExercise.name) {
        runCatching { ExerciseMediaCatalog.load(context).resolve(currentExercise.name) }.getOrNull()
    }
    val effectiveHistory = remember(history, fallbackPerformance) {
        if (history.isNotEmpty()) history else fallbackPerformance?.let(::fallbackHistory).orEmpty()
    }
    val backLabel = stringResource(backLabelRes)
    val openTrainingSessionLabel = stringResource(R.string.open_training_session)
    val displayName = exerciseDisplayName(currentExercise.name)
    var techniqueOpen by rememberSaveable(exercise.id) { mutableStateOf(false) }
    var editorOpen by rememberSaveable(exercise.id) { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize().testTag("exercise-details-dialog"),
            color = MaterialTheme.colorScheme.background,
        ) {
            Column(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                Row(
                    modifier = Modifier.fillMaxWidth().height(58.dp).padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = backLabel,
                        )
                    }
                    Text(
                        displayName,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    onUpdateExercise?.takeIf {
                        currentExercise.userId != null && currentExercise.userId == editableUserId
                    }?.let {
                        IconButton(
                            onClick = { editorOpen = true },
                            modifier = Modifier.testTag("exercise-detail-edit"),
                        ) {
                            Icon(Icons.Outlined.Edit, contentDescription = stringResource(R.string.edit))
                        }
                    }
                    onDelete?.let { delete ->
                        IconButton(
                            onClick = delete,
                            modifier = Modifier.testTag("exercise-detail-delete"),
                        ) {
                            Icon(Icons.Outlined.Delete, contentDescription = stringResource(R.string.delete))
                        }
                    }
                    if (showCloseAction) {
                        IconButton(onClick = onDismiss) {
                            Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.cancel))
                        }
                    }
                }
                HorizontalDivider()
                LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag("exercise-details-list"),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(18.dp),
                ) {
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    displayName,
                                    style = MaterialTheme.typography.headlineSmall,
                                    fontWeight = FontWeight.Bold,
                                )
                                if (displayName != currentExercise.name) {
                                    Text(
                                        currentExercise.name,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Spacer(Modifier.height(8.dp))
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    DetailChip(muscleGroupDisplayName(currentExercise.muscleGroup))
                                    DetailChip(exerciseCategoryDisplayName(currentExercise.category))
                                    DetailChip(equipmentTypeDisplayName(currentExercise.equipmentType))
                                }
                            }
                            OutlinedButton(onClick = { techniqueOpen = true }) {
                                Icon(
                                    Icons.Outlined.SportsGymnastics,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp),
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(stringResource(R.string.technique))
                            }
                        }
                    }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                stringResource(R.string.exercise_information),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            DetailValueRow(
                                stringResource(R.string.muscle_group),
                                muscleGroupDisplayName(currentExercise.muscleGroup),
                            )
                            DetailValueRow(
                                stringResource(R.string.equipment),
                                equipmentTypeDisplayName(currentExercise.equipmentType),
                            )
                            DetailValueRow(
                                stringResource(R.string.default_rest),
                                stringResource(R.string.seconds_value, currentExercise.defaultRestSec),
                            )
                            currentExercise.notes?.takeIf { it.isNotBlank() }?.let { notes ->
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.42f),
                                ) {
                                    Text(
                                        notes,
                                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    if (currentExercise.category != "CARDIO") item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(
                                        Icons.Outlined.History,
                                        contentDescription = null,
                                        modifier = Modifier.size(19.dp),
                                    )
                                    Spacer(Modifier.width(7.dp))
                                    Text(
                                        stringResource(R.string.exercise_progress),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                }
                                onOpenProgress?.let { openProgress ->
                                    OutlinedButton(
                                        onClick = { openProgress(currentExercise.id) },
                                        modifier = Modifier.testTag("exercise-open-full-progress"),
                                    ) {
                                        Text(stringResource(R.string.open_full_chart))
                                    }
                                }
                            }
                            ExerciseMaxWeightChart(
                                history = effectiveHistory,
                                progressPoints = progressPoints,
                                unit = unit,
                                usesBodyweight = currentExercise.usesBodyweight,
                                bodyweightKg = bodyweightKg,
                            )
                        }
                    }
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(
                                stringResource(R.string.training_history),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                            if (effectiveHistory.isEmpty()) {
                                Text(
                                    stringResource(R.string.no_exercise_history),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                effectiveHistory.forEach { session ->
                                    ExerciseHistoryCard(
                                        session = session,
                                        unit = unit,
                                        isCardio = session.sets.any { set ->
                                            set.durationSec != null ||
                                                set.distanceM != null ||
                                                set.avgHr != null ||
                                                set.maxHr != null
                                        } || (session.sets.isEmpty() && currentExercise.category == "CARDIO"),
                                        openLabel = openTrainingSessionLabel,
                                        onOpen = onOpenHistory?.takeUnless { session.localOnly }?.let { openHistory ->
                                            { openHistory(session.sessionId, session.startedAt) }
                                        },
                                    )
                                    Spacer(Modifier.height(9.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (techniqueOpen) {
        ExerciseTechniqueDialog(
            exercise = currentExercise,
            media = media,
            serverUrl = serverUrl,
            onDismiss = { techniqueOpen = false },
        )
    }

    if (
        editorOpen &&
        onUpdateExercise != null &&
        currentExercise.userId != null &&
        currentExercise.userId == editableUserId
    ) {
        ExerciseEditorDialog(
            exercise = currentExercise,
            onDismiss = { editorOpen = false },
            onSave = { input -> onUpdateExercise(currentExercise, input) },
            onSaved = { updated ->
                editedExercise = updated
                onExerciseUpdated(updated)
                editorOpen = false
            },
        )
    }
}

private val exerciseEditorMuscleGroups = listOf(
    "CHEST", "BACK_WIDTH", "BACK_THICKNESS", "SHOULDERS_FRONT", "SHOULDERS_LATERAL",
    "SHOULDERS_REAR", "BICEPS", "TRICEPS", "FOREARMS", "QUADS", "HAMSTRINGS",
    "GLUTES", "CALVES", "ABS", "LOWER_BACK", "OTHER",
)
private val exerciseEditorCategories = listOf("COMPOUND", "ISOLATION", "CARDIO")
private val exerciseEditorEquipmentTypes =
    listOf("DUMBBELL", "BARBELL", "MACHINE", "CABLE", "BODYWEIGHT", "CARDIO", "OTHER")

@Composable
internal fun ExerciseEditorDialog(
    exercise: ExerciseDto?,
    onDismiss: () -> Unit,
    onSave: suspend (ExerciseInput) -> ExerciseDto,
    onSaved: (ExerciseDto) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var name by rememberSaveable(exercise?.id) { mutableStateOf(exercise?.name.orEmpty()) }
    var muscle by rememberSaveable(exercise?.id) {
        mutableStateOf(exercise?.muscleGroup ?: exerciseEditorMuscleGroups.first())
    }
    var category by rememberSaveable(exercise?.id) {
        mutableStateOf(exercise?.category ?: exerciseEditorCategories.first())
    }
    var equipment by rememberSaveable(exercise?.id) {
        mutableStateOf(exercise?.equipmentType ?: exerciseEditorEquipmentTypes.last())
    }
    var rest by rememberSaveable(exercise?.id) {
        mutableStateOf((exercise?.defaultRestSec ?: 90).toString())
    }
    var notes by rememberSaveable(exercise?.id) { mutableStateOf(exercise?.notes.orEmpty()) }
    var bodyweight by rememberSaveable(exercise?.id) {
        mutableStateOf(exercise?.usesBodyweight ?: false)
    }
    var saving by remember { mutableStateOf(false) }
    var saveFailed by rememberSaveable(exercise?.id) { mutableStateOf(false) }
    val restValue = rest.toIntOrNull()
    val nameInvalid = name.isBlank()
    val restInvalid = restValue !in 15..600
    val valid = !nameInvalid && !restInvalid

    fun save() {
        if (!valid || saving) return
        val input = ExerciseInput(
            name = name.trim(),
            muscleGroup = muscle,
            category = category,
            defaultRestSec = requireNotNull(restValue),
            notes = notes.trim().ifBlank { null },
            usesBodyweight = bodyweight,
            equipmentType = equipment,
        )
        saving = true
        saveFailed = false
        scope.launch {
            try {
                onSaved(onSave(input))
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                saveFailed = true
            } finally {
                saving = false
            }
        }
    }

    BackHandler(enabled = !saving) { onDismiss() }

    Dialog(onDismissRequest = { if (!saving) onDismiss() }) {
        Card(
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth().testTag("exercise-editor"),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Text(
                        stringResource(if (exercise == null) R.string.exercise_create else R.string.exercise_edit),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
                item {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it.take(120); saveFailed = false },
                        label = { Text(stringResource(R.string.exercise_name)) },
                        modifier = Modifier.fillMaxWidth().testTag("exercise-editor-name"),
                        enabled = !saving,
                        isError = nameInvalid,
                        supportingText = if (nameInvalid) {
                            { Text(stringResource(R.string.exercise_name_required)) }
                        } else null,
                    )
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_muscle_group),
                        muscle,
                        exerciseEditorMuscleGroups,
                        ::muscleGroupDisplayName,
                        enabled = !saving,
                        testTag = "exercise-editor-muscle",
                    ) { muscle = it; saveFailed = false }
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_category),
                        category,
                        exerciseEditorCategories,
                        ::exerciseCategoryDisplayName,
                        enabled = !saving,
                        testTag = "exercise-editor-category",
                    ) { category = it; saveFailed = false }
                }
                item {
                    EnumPicker(
                        stringResource(R.string.exercise_equipment_type),
                        equipment,
                        exerciseEditorEquipmentTypes,
                        ::equipmentTypeDisplayName,
                        enabled = !saving,
                        testTag = "exercise-editor-equipment",
                    ) { equipment = it; saveFailed = false }
                }
                item {
                    OutlinedTextField(
                        value = rest,
                        onValueChange = { rest = it.filter(Char::isDigit).take(3); saveFailed = false },
                        label = { Text(stringResource(R.string.exercise_default_rest)) },
                        modifier = Modifier.fillMaxWidth().testTag("exercise-editor-rest"),
                        enabled = !saving,
                        isError = restInvalid,
                        supportingText = if (restInvalid) {
                            { Text(stringResource(R.string.exercise_rest_range)) }
                        } else null,
                    )
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = bodyweight,
                            onCheckedChange = { bodyweight = it; saveFailed = false },
                            enabled = !saving,
                        )
                        Text(stringResource(R.string.exercise_bodyweight))
                    }
                }
                item {
                    OutlinedTextField(
                        value = notes,
                        onValueChange = { notes = it.take(2000); saveFailed = false },
                        label = { Text(stringResource(R.string.program_notes)) },
                        modifier = Modifier.fillMaxWidth().testTag("exercise-editor-notes"),
                        enabled = !saving,
                        minLines = 3,
                    )
                }
                if (saveFailed) item {
                    val message = stringResource(R.string.exercise_update_error)
                    Text(
                        message,
                        modifier = Modifier
                            .testTag("exercise-editor-error")
                            .semantics {
                                liveRegion = LiveRegionMode.Assertive
                                error(message)
                            },
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(
                            onClick = onDismiss,
                            enabled = !saving,
                            modifier = Modifier.testTag("exercise-editor-cancel"),
                        ) {
                            Text(stringResource(R.string.cancel))
                        }
                        Spacer(Modifier.width(8.dp))
                        Button(
                            enabled = valid && !saving,
                            onClick = ::save,
                            modifier = Modifier.testTag("exercise-editor-save"),
                        ) {
                            if (saving) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text(
                                stringResource(
                                    when {
                                        saving -> R.string.saving
                                        saveFailed -> R.string.retry
                                        else -> R.string.save
                                    },
                                ),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun EnumPicker(
    label: String,
    value: String,
    values: List<String>,
    displayValue: (String) -> String,
    enabled: Boolean,
    testTag: String,
    onValue: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(
            onClick = { open = true },
            modifier = Modifier.fillMaxWidth().testTag(testTag),
            enabled = enabled,
        ) {
            Text(displayValue(value))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            values.forEach { option ->
                DropdownMenuItem(
                    text = { Text(displayValue(option)) },
                    onClick = { open = false; onValue(option) },
                )
            }
        }
    }
}

@Composable
private fun DetailChip(value: String) {
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Text(
            value,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun DetailValueRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            label,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            modifier = Modifier.weight(1f),
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.End,
        )
    }
}

@Composable
private fun ExerciseMaxWeightChart(
    history: List<ExerciseHistorySessionDto>,
    progressPoints: List<MobileProgressPointDto>,
    unit: String,
    usesBodyweight: Boolean,
    bodyweightKg: Double?,
) {
    val points = buildExerciseChartPoints(
        history = history,
        progressPoints = progressPoints,
        unit = unit,
        usesBodyweight = usesBodyweight,
        bodyweightKg = bodyweightKg,
    )
    if (points.isEmpty()) {
        Text(
            stringResource(R.string.no_chart_data),
            modifier = Modifier.fillMaxWidth().padding(vertical = 22.dp),
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    val min = points.minOf { it.value }
    val max = points.maxOf { it.value }
    val lineColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.28f)
    val chartDescription = stringResource(
        R.string.chart_accessibility_summary,
        points.size,
        formatWeightValue(points.first().value),
        formatWeightValue(points.last().value),
        unit.lowercase(Locale.getDefault()),
    )
    Card(
        shape = RoundedCornerShape(9.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(
                    stringResource(R.string.max_weight_chart),
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "${formatWeightValue(points.last().value)} ${unit.lowercase(Locale.getDefault())}",
                    style = MaterialTheme.typography.labelLarge,
                    color = lineColor,
                )
            }
            Canvas(
                modifier = Modifier.fillMaxWidth().height(180.dp).padding(top = 12.dp)
                    .semantics { contentDescription = chartDescription },
            ) {
                val left = 10.dp.toPx()
                val right = size.width - 10.dp.toPx()
                val top = 8.dp.toPx()
                val bottom = size.height - 12.dp.toPx()
                repeat(4) { index ->
                    val y = top + (bottom - top) * index / 3f
                    drawLine(gridColor, Offset(left, y), Offset(right, y), strokeWidth = 1.dp.toPx())
                }
                val range = (max - min).takeIf { it > 0 } ?: 1.0
                val path = Path()
                val coordinates = points.mapIndexed { index, point ->
                    val x = if (points.size == 1) {
                        (left + right) / 2f
                    } else {
                        left + (right - left) * index / (points.lastIndex.toFloat())
                    }
                    val normalized = ((point.value - min) / range).toFloat()
                    val y = bottom - (bottom - top) * normalized
                    Offset(x, y)
                }
                coordinates.forEachIndexed { index, point ->
                    if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
                }
                if (coordinates.size > 1) {
                    drawPath(path, lineColor, style = Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
                }
                coordinates.forEach { point ->
                    drawCircle(lineColor, radius = 4.dp.toPx(), center = point)
                    drawCircle(Color.White, radius = 1.8.dp.toPx(), center = point)
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatShortDate(points.first().date), style = MaterialTheme.typography.labelSmall)
                Text(
                    stringResource(
                        R.string.chart_range_values,
                        formatWeightValue(min),
                        formatWeightValue(max),
                    ),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(formatShortDate(points.last().date), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun ExerciseHistoryCard(
    session: ExerciseHistorySessionDto,
    unit: String,
    isCardio: Boolean,
    openLabel: String,
    onOpen: (() -> Unit)?,
) {
    val context = historyLocaleContext(LocalContext.current)
    val kilometerUnit = context.getString(R.string.history_kilometer_unit)
    val meterUnit = context.getString(R.string.history_meter_unit)
    Card(
        modifier = Modifier.testTag("exercise-history-${session.sessionId}"),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.42f)),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(formatLongDate(session.startedAt), style = MaterialTheme.typography.labelLarge)
            }
            HorizontalDivider()
            if (isCardio) CardioHistoryTableRow(
                "#",
                stringResource(R.string.history_duration_short),
                stringResource(R.string.history_distance_short),
                stringResource(R.string.history_avg_hr),
                stringResource(R.string.history_max_hr),
                header = true,
            ) else HistoryTableRow(
                "#",
                unit.uppercase(Locale.getDefault()),
                "REPS",
                stringResource(R.string.set_metric_one_rm_short),
                header = true,
            )
            session.sets.sortedBy { it.setNumber }.forEachIndexed { index, set ->
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.2f))
                if (isCardio) CardioHistoryTableRow(
                    set.setNumber.toString(),
                    formatHistoryDuration(set.durationSec),
                    formatHistoryDistance(set.distanceM, kilometerUnit, meterUnit),
                    set.avgHr?.toString() ?: "-",
                    set.maxHr?.toString() ?: "-",
                    header = false,
                    rowTag = "exercise-history-cardio-${session.sessionId}-${set.setNumber}",
                ) else HistoryTableRow(
                    if (set.isDropSet) "D" else (index + 1).toString(),
                    formatWeightValue(roundWeight(toDisplayWeight(set.weight, unit), 2)),
                    set.reps.toString(),
                    formatSetTableMetric(
                        SetTableMetric.ONE_RM,
                        set.weight,
                        set.reps,
                        unit,
                    ),
                    header = false,
                )
            }
            onOpen?.let { open ->
                HorizontalDivider()
                TextButton(
                    onClick = open,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("exercise-open-history-${session.sessionId}"),
                ) {
                    Text(openLabel)
                }
            }
        }
    }
}

@Composable
private fun CardioHistoryTableRow(
    number: String,
    duration: String,
    distance: String,
    avgHr: String,
    maxHr: String,
    header: Boolean,
    rowTag: String? = null,
) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
        HistoryCell(number, 0.5f, header)
        HistoryCell(duration, 1f, header)
        HistoryCell(
            distance,
            1f,
            header,
            modifier = rowTag?.let { Modifier.testTag("$it-distance") } ?: Modifier,
        )
        HistoryCell(avgHr, 0.8f, header)
        HistoryCell(maxHr, 0.8f, header)
    }
}

@Composable
private fun HistoryTableRow(
    number: String,
    weight: String,
    reps: String,
    oneRm: String,
    header: Boolean,
) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
        HistoryCell(number, 0.6f, header)
        HistoryCell(weight, 1.25f, header)
        HistoryCell(reps, 1f, header)
        HistoryCell(oneRm, 0.9f, header)
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.HistoryCell(
    value: String,
    cellWeight: Float,
    header: Boolean,
    modifier: Modifier = Modifier,
) {
    Text(
        value,
        modifier = modifier.weight(cellWeight),
        textAlign = TextAlign.Center,
        style = if (header) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodyMedium,
        fontWeight = if (header) FontWeight.Normal else FontWeight.Medium,
        color = if (header) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun ExerciseTechniqueDialog(
    exercise: ExerciseDto,
    media: ExerciseMediaAsset?,
    serverUrl: String,
    onDismiss: () -> Unit,
) {
    var playing by rememberSaveable(exercise.id) { mutableStateOf(true) }
    var frame by rememberSaveable(exercise.id) { mutableIntStateOf(0) }
    val uriHandler = LocalUriHandler.current
    val context = LocalContext.current
    LaunchedEffect(playing, media?.datasetId) {
        while (playing && media != null) {
            delay(1_400)
            frame = if (frame == 0) 1 else 0
        }
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            exerciseDisplayName(exercise.name),
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            stringResource(R.string.technique_description),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Outlined.Close, contentDescription = stringResource(R.string.cancel))
                    }
                }
                if (media != null) {
                    Box(
                        modifier = Modifier.fillMaxWidth().aspectRatio(3f / 2f)
                            .background(Color.Black, RoundedCornerShape(8.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        SubcomposeAsyncImage(
                            model = ImageRequest.Builder(context)
                                .data(media.frameUrl(serverUrl, frame))
                                .diskCacheKey(media.frameUrl(serverUrl, frame))
                                .crossfade(true)
                                .build(),
                            contentDescription = stringResource(
                                if (frame == 0) R.string.technique_start_alt else R.string.technique_finish_alt,
                                exerciseDisplayName(exercise.name),
                            ),
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize(),
                            loading = { CircularProgressIndicator(color = Color.White) },
                            error = {
                                Text(
                                    stringResource(R.string.media_load_error),
                                    color = Color.White,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(20.dp),
                                )
                            },
                            success = { SubcomposeAsyncImageContent() },
                        )
                        Surface(
                            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
                            shape = RoundedCornerShape(999.dp),
                            color = MaterialTheme.colorScheme.primary,
                        ) {
                            Text(
                                stringResource(if (frame == 0) R.string.technique_start else R.string.technique_finish),
                                modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                        if (media.approximate) {
                            Surface(
                                modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
                                shape = RoundedCornerShape(999.dp),
                                color = MaterialTheme.colorScheme.secondaryContainer,
                            ) {
                                Text(
                                    stringResource(R.string.similar_variant),
                                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { playing = false; frame = 0 }) {
                            Icon(Icons.Outlined.SkipPrevious, contentDescription = stringResource(R.string.show_start))
                        }
                        IconButton(onClick = { playing = !playing }) {
                            Icon(
                                if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                                contentDescription = stringResource(if (playing) R.string.pause else R.string.play),
                            )
                        }
                        IconButton(onClick = { playing = false; frame = 1 }) {
                            Icon(Icons.Outlined.SkipNext, contentDescription = stringResource(R.string.show_finish))
                        }
                    }
                    Text(
                        stringResource(R.string.equipment_description, formatEnumLabel(exercise.equipmentType)),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    HorizontalDivider()
                    Text(
                        stringResource(R.string.media_disclaimer),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    TextButton(
                        onClick = { if (media.source.url.isNotBlank()) uriHandler.openUri(media.source.url) },
                        enabled = media.source.url.isNotBlank(),
                    ) {
                        Text(stringResource(R.string.media_source, media.source.name, media.source.license))
                    }
                } else {
                    Text(
                        stringResource(R.string.media_missing),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = {
                            val query = URLEncoder.encode(
                                "${exercise.name} ${exercise.equipmentType}",
                                StandardCharsets.UTF_8.toString(),
                            )
                            uriHandler.openUri(
                                "https://commons.wikimedia.org/w/index.php?search=$query&title=Special:MediaSearch&type=image",
                            )
                        },
                    ) {
                        Text(stringResource(R.string.search_commons))
                    }
                }
            }
        }
    }
}

internal fun buildExerciseChartPoints(
    history: List<ExerciseHistorySessionDto>,
    progressPoints: List<MobileProgressPointDto>,
    unit: String,
    usesBodyweight: Boolean,
    bodyweightKg: Double?,
): List<ChartPoint> {
    fun key(date: String): String = runCatching { Instant.parse(date).toEpochMilli().toString() }
        .getOrElse { date }
    val points = linkedMapOf<String, ChartPoint>()
    progressPoints.forEach { point ->
        points[key(point.sessionStartedAt)] = ChartPoint(
            date = point.sessionStartedAt,
            value = roundWeight(toDisplayWeight(point.maxWeight, unit), 2),
        )
    }
    history.forEach { session ->
        session.sets.maxOfOrNull { set ->
            if (usesBodyweight && bodyweightKg != null && bodyweightKg > 0) {
                bodyweightKg + set.weight
            } else {
                set.weight
            }
        }?.let { weight ->
            points[key(session.startedAt)] = ChartPoint(
                date = session.startedAt,
                value = roundWeight(toDisplayWeight(weight, unit), 2),
            )
        }
    }
    return points.values.sortedBy { point ->
        runCatching { Instant.parse(point.date).toEpochMilli() }.getOrDefault(Long.MIN_VALUE)
    }
}

internal data class ChartPoint(val date: String, val value: Double)

private fun fallbackHistory(performance: LastPerformanceDto): List<ExerciseHistorySessionDto> = listOf(
    ExerciseHistorySessionDto(
        sessionId = performance.sessionId,
        startedAt = performance.sessionStartedAt,
        sets = performance.sets.mapIndexed { index, set ->
            ExerciseHistorySetDto(
                setNumber = index + 1,
                weight = set.weight,
                reps = set.reps,
                rir = set.rir,
                isDropSet = set.isDropSet,
            )
        },
    ),
)

private fun formatEnumLabel(value: String): String = value
    .lowercase(Locale.getDefault())
    .split('_')
    .joinToString(" ") { word -> word.replaceFirstChar { it.titlecase(Locale.getDefault()) } }

private fun formatWeightValue(value: Double): String = if (value % 1.0 == 0.0) {
    value.toInt().toString()
} else {
    String.format(Locale.ROOT, "%.2f", value).trimEnd('0').trimEnd('.')
}

private fun formatShortDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd.MM", Locale.getDefault()))
}.getOrElse { value.take(10) }

private fun formatLongDate(value: String): String = runCatching {
    Instant.parse(value).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.getDefault()))
}.getOrElse { value.take(10) }
