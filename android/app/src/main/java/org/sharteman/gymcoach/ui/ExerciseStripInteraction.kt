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
