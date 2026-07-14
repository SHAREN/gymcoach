package org.sharteman.gymcoach.ui.localization

import java.util.Locale

fun exerciseDisplayName(
    name: String,
    language: String = Locale.getDefault().language,
): String = if (language.equals("ru", ignoreCase = true)) {
    russianExerciseNames[name.trim().lowercase(Locale.US)] ?: name
} else {
    name
}

fun muscleGroupDisplayName(
    value: String,
    language: String = Locale.getDefault().language,
): String = localizedEnum(value, language, russianMuscleGroups)

fun exerciseCategoryDisplayName(
    value: String,
    language: String = Locale.getDefault().language,
): String = localizedEnum(value, language, russianCategories)

fun equipmentTypeDisplayName(
    value: String,
    language: String = Locale.getDefault().language,
): String = localizedEnum(value, language, russianEquipmentTypes)

fun enumDisplayName(value: String): String = value.lowercase(Locale.getDefault())
    .split('_')
    .joinToString(" ") { word ->
        word.replaceFirstChar { char -> char.titlecase(Locale.getDefault()) }
    }

private fun localizedEnum(
    value: String,
    language: String,
    russianValues: Map<String, String>,
): String = if (language.equals("ru", ignoreCase = true)) {
    russianValues[value] ?: enumDisplayName(value)
} else {
    enumDisplayName(value)
}

private val russianMuscleGroups = mapOf(
    "CHEST" to "Грудь",
    "BACK_WIDTH" to "Спина (ширина)",
    "BACK_THICKNESS" to "Спина (толщина)",
    "SHOULDERS_FRONT" to "Передние дельты",
    "SHOULDERS_LATERAL" to "Средние дельты",
    "SHOULDERS_REAR" to "Задние дельты",
    "BICEPS" to "Бицепс",
    "TRICEPS" to "Трицепс",
    "FOREARMS" to "Предплечья",
    "QUADS" to "Квадрицепсы",
    "HAMSTRINGS" to "Задняя поверхность бедра",
    "GLUTES" to "Ягодицы",
    "CALVES" to "Икры",
    "ABS" to "Пресс",
    "LOWER_BACK" to "Поясница",
    "OTHER" to "Другое",
)

private val russianCategories = mapOf(
    "COMPOUND" to "Базовое",
    "ISOLATION" to "Изолирующее",
    "CARDIO" to "Кардио",
)

private val russianEquipmentTypes = mapOf(
    "DUMBBELL" to "Гантели",
    "BARBELL" to "Штанга",
    "MACHINE" to "Тренажёр",
    "CABLE" to "Блочный тренажёр",
    "BODYWEIGHT" to "Собственный вес",
    "CARDIO" to "Кардиооборудование",
    "OTHER" to "Другое / без ограничений",
)
