package org.sharteman.gymcoach.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.sharteman.gymcoach.GymCoachApplication
import org.sharteman.gymcoach.data.network.ApiException
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.repository.MobileAuthenticationRequiredException
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
            if (workoutAccepted && offlineAccepted) Result.success() else Result.failure()
        } catch (_: MobileAuthenticationRequiredException) {
            Result.failure()
        } catch (error: ApiException) {
            if (error.statusCode == 429 || error.statusCode >= 500) Result.retry() else Result.failure()
        } catch (_: IOException) {
            Result.retry()
        } catch (_: Throwable) {
            Result.failure()
        }
    }
}
