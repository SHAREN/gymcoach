package org.sharteman.gymcoach.data.coach

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CoachOverviewDto(
    val context: CoachContextDto,
    val coachNote: String? = null,
    val provider: CoachProviderDto,
    val history: List<CoachDebriefDto> = emptyList(),
    val programDefaults: Map<String, ProgramExerciseDefaultsDto> = emptyMap(),
    val conversations: List<ConversationSummaryDto> = emptyList(),
)

@Serializable
data class CoachProviderDto(
    val configured: Boolean,
    val label: String,
    val apiKeyEnvVar: String,
)

@Serializable
data class CoachContextDto(
    val goals: List<CoachGoalDto> = emptyList(),
    val stalledExercises: List<String> = emptyList(),
    val deloadActive: Boolean = false,
    val deloadRecommended: Boolean = false,
    val deloadReasons: List<String> = emptyList(),
    val deloadState: String = "none",
    val daysSinceLastMeaningfulWorkout: Double? = null,
    val recent7DayCompletedWorkouts: Int = 0,
    val recent7DayWorkingSets: Int = 0,
    val conditioning: CoachConditioningDto,
    val readiness: CoachReadinessDto? = null,
    val weeksOfHistory: Int = 0,
    val exercisesTracked: Int = 0,
)

@Serializable
data class CoachGoalDto(
    val exerciseName: String,
    val targetWeight: Double,
    val targetReps: Int,
    val progressPct: Double,
    val achieved: Boolean,
)

@Serializable
data class CoachConditioningDto(
    val currentMinutes: Int,
    val currentKm: Double,
    val currentSessions: Int,
    val weeklyTargetMin: Int,
)

@Serializable
data class CoachReadinessDto(
    val daysAgo: Int,
    val readiness: Int,
    val sleepQuality: Int,
)

@Serializable
data class CoachDebriefDto(
    val id: String,
    val weekStart: String,
    val weekEnd: String,
    val response: String,
    val appliedAt: String? = null,
    val createdAt: String,
)

@Serializable
data class GeneratedDebriefDto(
    val id: String,
    val response: String,
    val modelUsed: String? = null,
    val createdAt: String,
)

@Serializable
data class ProgramExerciseDefaultsDto(
    val targetRepsMin: Int,
    val targetRepsMax: Int,
    val targetSets: Int,
    val targetRIR: Int,
    val restSec: Int,
)

@Serializable
data class CoachAdjustment(
    val exerciseName: String,
    val summary: String,
    val rationale: String? = null,
    val suggestedRepsMin: Int? = null,
    val suggestedRepsMax: Int? = null,
    val suggestedSets: Int? = null,
    val suggestedRIR: Int? = null,
    val suggestedRestSec: Int? = null,
    val currentLoad: Double? = null,
    val suggestedLoad: Double? = null,
    val note: String? = null,
)

@Serializable
data class ApplyAdjustmentsRequest(val adjustments: List<CoachAdjustment>)

@Serializable
data class ApplyAdjustmentsResponse(
    val ok: Boolean,
    val appliedAt: String,
    val applied: List<AppliedAdjustmentDto> = emptyList(),
    val skipped: List<SkippedAdjustmentDto> = emptyList(),
)

@Serializable
data class AppliedAdjustmentDto(
    val exerciseName: String,
    val programExerciseIds: List<String> = emptyList(),
)

@Serializable
data class SkippedAdjustmentDto(
    val exerciseName: String,
    val reason: String,
)

@Serializable
data class CoachNoteRequest(val coachNote: String?)

@Serializable
data class ConversationSummaryDto(
    val id: String,
    val title: String? = null,
    val updatedAt: String,
)

@Serializable
data class ConversationMessagesDto(val messages: List<ConversationMessageDto> = emptyList())

@Serializable
data class ConversationMessageDto(
    val id: String? = null,
    val role: String,
    val content: String,
    val createdAt: String? = null,
)

@Serializable
data class SendChatRequest(
    val conversationId: String? = null,
    val message: String,
    val sessionId: String? = null,
)

data class ChatReply(val conversationId: String, val content: String)

enum class ChatRole { USER, ASSISTANT }

data class ChatMessage(val role: ChatRole, val content: String)

data class CoachResponseContent(
    val markdown: String,
    val adjustments: List<CoachAdjustment>,
    val parseError: String? = null,
)

data class SelectableAdjustment(
    val selected: Boolean,
    val adjustment: CoachAdjustment,
)
