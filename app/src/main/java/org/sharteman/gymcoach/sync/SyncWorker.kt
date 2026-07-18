package org.sharteman.gymcoach.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.sharteman.gymcoach.GymCoachApplication
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.profile.CoachingProfileRepository
import org.sharteman.gymcoach.data.profile.isRetryable
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException
import org.sharteman.gymcoach.data.settings.SettingsErrorKind
import org.sharteman.gymcoach.data.settings.SettingsException
import java.io.IOException

class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as GymCoachApplication).repository
        return try {
            val workoutAccepted = repository.syncPending()
            val offlineAccepted = OfflineRuntime.syncPending()
            val profileResult = CoachingProfileRepository.create(applicationContext, scheduleSyncNow = {})
                .syncPending()
            profileResult?.let { repository.mergeCoachingProfileIntoBootstrap(it.profile) }
            if (workoutAccepted && offlineAccepted) Result.success() else Result.failure()
        } catch (_: MobileAuthenticationRequiredException) {
            Result.failure()
        } catch (error: SettingsException) {
            when {
                error.kind == SettingsErrorKind.AUTHENTICATION -> Result.failure()
                error.kind.isRetryable() -> Result.retry()
                else -> Result.failure()
            }
        } catch (error: ApiException) {
            if (error.statusCode == 429 || error.statusCode >= 500) Result.retry() else Result.failure()
        } catch (_: IOException) {
            Result.retry()
        } catch (_: Throwable) {
            Result.failure()
        }
    }
}
