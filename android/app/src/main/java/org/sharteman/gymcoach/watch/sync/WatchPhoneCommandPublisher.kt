package org.sharteman.gymcoach.watch.sync

import java.util.concurrent.atomic.AtomicReference
import org.sharteman.gymcoach.data.local.LocalSetEntity

/**
 * Repository-facing boundary for mirroring phone workout mutations to the
 * durable watch outbox. Implementations must enqueue before attempting live
 * transport delivery.
 */
interface WatchPhoneCommandPublisher {
    val enabled: Boolean
        get() = true

    suspend fun workoutStarted(sessionId: String, revision: Long, startedAtEpochMs: Long)

    suspend fun activeExerciseChanged(
        sessionId: String,
        exerciseId: String,
        revision: Long,
        changedAtEpochMs: Long,
    )

    suspend fun setCompleted(set: LocalSetEntity, revision: Long)

    suspend fun setUpdated(set: LocalSetEntity, revision: Long)

    suspend fun setDeleted(
        sessionId: String,
        setId: String,
        revision: Long,
        baseRevision: Long,
        deletedAtEpochMs: Long,
    )

    suspend fun restStarted(
        sessionId: String,
        setId: String,
        revision: Long,
        startedAtEpochMs: Long,
        endsAtEpochMs: Long,
    )

    suspend fun restUpdated(
        sessionId: String,
        revision: Long,
        endsAtEpochMs: Long,
        reason: String,
        changedAtEpochMs: Long,
    )

    suspend fun restFinished(
        sessionId: String,
        revision: Long,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    )

    suspend fun restSkipped(
        sessionId: String,
        revision: Long,
        skippedAtEpochMs: Long,
    )

    suspend fun workoutFinished(sessionId: String, revision: Long, finishedAtEpochMs: Long)

    suspend fun flush(sessionId: String) = Unit
}

object NoOpWatchPhoneCommandPublisher : WatchPhoneCommandPublisher {
    override val enabled = false
    override suspend fun workoutStarted(sessionId: String, revision: Long, startedAtEpochMs: Long) = Unit
    override suspend fun activeExerciseChanged(
        sessionId: String,
        exerciseId: String,
        revision: Long,
        changedAtEpochMs: Long,
    ) = Unit
    override suspend fun setCompleted(set: LocalSetEntity, revision: Long) = Unit
    override suspend fun setUpdated(set: LocalSetEntity, revision: Long) = Unit
    override suspend fun setDeleted(
        sessionId: String,
        setId: String,
        revision: Long,
        baseRevision: Long,
        deletedAtEpochMs: Long,
    ) = Unit
    override suspend fun restStarted(
        sessionId: String,
        setId: String,
        revision: Long,
        startedAtEpochMs: Long,
        endsAtEpochMs: Long,
    ) = Unit
    override suspend fun restUpdated(
        sessionId: String,
        revision: Long,
        endsAtEpochMs: Long,
        reason: String,
        changedAtEpochMs: Long,
    ) = Unit
    override suspend fun restFinished(
        sessionId: String,
        revision: Long,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ) = Unit
    override suspend fun restSkipped(sessionId: String, revision: Long, skippedAtEpochMs: Long) = Unit
    override suspend fun workoutFinished(sessionId: String, revision: Long, finishedAtEpochMs: Long) = Unit
}

class SwitchableWatchPhoneCommandPublisher(
    initial: WatchPhoneCommandPublisher = NoOpWatchPhoneCommandPublisher,
) : WatchPhoneCommandPublisher {
    private val delegate = AtomicReference(initial)

    fun attach(publisher: WatchPhoneCommandPublisher) {
        delegate.set(publisher)
    }

    override val enabled: Boolean
        get() = delegate.get().enabled

    override suspend fun workoutStarted(sessionId: String, revision: Long, startedAtEpochMs: Long) =
        delegate.get().workoutStarted(sessionId, revision, startedAtEpochMs)

    override suspend fun activeExerciseChanged(
        sessionId: String,
        exerciseId: String,
        revision: Long,
        changedAtEpochMs: Long,
    ) = delegate.get().activeExerciseChanged(sessionId, exerciseId, revision, changedAtEpochMs)

    override suspend fun setCompleted(set: LocalSetEntity, revision: Long) =
        delegate.get().setCompleted(set, revision)

    override suspend fun setUpdated(set: LocalSetEntity, revision: Long) =
        delegate.get().setUpdated(set, revision)

    override suspend fun setDeleted(
        sessionId: String,
        setId: String,
        revision: Long,
        baseRevision: Long,
        deletedAtEpochMs: Long,
    ) = delegate.get().setDeleted(sessionId, setId, revision, baseRevision, deletedAtEpochMs)

    override suspend fun restStarted(
        sessionId: String,
        setId: String,
        revision: Long,
        startedAtEpochMs: Long,
        endsAtEpochMs: Long,
    ) = delegate.get().restStarted(sessionId, setId, revision, startedAtEpochMs, endsAtEpochMs)

    override suspend fun restUpdated(
        sessionId: String,
        revision: Long,
        endsAtEpochMs: Long,
        reason: String,
        changedAtEpochMs: Long,
    ) = delegate.get().restUpdated(sessionId, revision, endsAtEpochMs, reason, changedAtEpochMs)

    override suspend fun restFinished(
        sessionId: String,
        revision: Long,
        startedAtEpochMs: Long,
        finishedAtEpochMs: Long,
    ) = delegate.get().restFinished(sessionId, revision, startedAtEpochMs, finishedAtEpochMs)

    override suspend fun restSkipped(sessionId: String, revision: Long, skippedAtEpochMs: Long) =
        delegate.get().restSkipped(sessionId, revision, skippedAtEpochMs)

    override suspend fun workoutFinished(sessionId: String, revision: Long, finishedAtEpochMs: Long) =
        delegate.get().workoutFinished(sessionId, revision, finishedAtEpochMs)

    override suspend fun flush(sessionId: String) = delegate.get().flush(sessionId)
}
