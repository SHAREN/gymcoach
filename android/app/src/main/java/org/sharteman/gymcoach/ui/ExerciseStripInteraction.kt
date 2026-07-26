package org.sharteman.gymcoach.ui

internal enum class ExerciseStripAction {
    SELECT,
    OPEN,
    NONE,
}

internal fun exerciseStripAction(selected: Boolean, selectionEnabled: Boolean): ExerciseStripAction = when {
    selected -> ExerciseStripAction.OPEN
    selectionEnabled -> ExerciseStripAction.SELECT
    else -> ExerciseStripAction.NONE
}

internal const val ACTIVE_EXERCISE_THUMBNAIL_ALPHA = 1f
internal const val INACTIVE_EXERCISE_THUMBNAIL_ALPHA = 0.58f

internal fun exerciseThumbnailAlpha(selected: Boolean): Float =
    if (selected) ACTIVE_EXERCISE_THUMBNAIL_ALPHA else INACTIVE_EXERCISE_THUMBNAIL_ALPHA

internal fun exerciseStripItemCount(exerciseCount: Int): Int {
    require(exerciseCount >= 0)
    return exerciseCount + 1
}

internal fun isExerciseStripAddIndex(index: Int, exerciseCount: Int): Boolean =
    index == exerciseCount && index >= 0
