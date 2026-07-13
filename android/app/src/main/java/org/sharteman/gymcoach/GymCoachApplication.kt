package org.sharteman.gymcoach

import android.app.Application
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.network.ApiClient
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.sync.SyncScheduler

class GymCoachApplication : Application() {
    lateinit var repository: GymCoachRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val database = GymCoachDatabase.get(this)
        val accountStore = SecureAccountStore(this)
        repository = GymCoachRepository(
            dao = database.dao(),
            accountStore = accountStore,
            api = ApiClient(),
            scheduleSyncNow = { SyncScheduler.scheduleNow(this) },
            schedulePeriodicSync = { SyncScheduler.schedulePeriodic(this) },
        )
        if (repository.isLoggedIn) {
            SyncScheduler.scheduleNow(this)
            SyncScheduler.schedulePeriodic(this)
        }
    }
}
