package org.sharteman.gymcoach

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import org.sharteman.gymcoach.data.local.GymCoachDatabase
import org.sharteman.gymcoach.data.network.ApiClient
import org.sharteman.gymcoach.data.offline.OfflineRuntime
import org.sharteman.gymcoach.data.repository.GymCoachRepository
import org.sharteman.gymcoach.data.security.SecureAccountStore
import org.sharteman.gymcoach.sync.SyncScheduler
import org.sharteman.gymcoach.watch.sync.SwitchableWatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.sync.NoOpWatchPhoneCommandPublisher
import org.sharteman.gymcoach.watch.sync.WatchCompanionRuntime
import org.sharteman.gymcoach.watch.sync.WatchCompanionRuntimeFactory
import org.sharteman.gymcoach.watch.sync.WatchSyncPreferences
import org.sharteman.gymcoach.watch.ui.WatchStatusDataSource

class GymCoachApplication : Application() {
    lateinit var repository: GymCoachRepository
        private set
    lateinit var watchCompanionRuntime: WatchCompanionRuntime
        private set
    lateinit var watchSyncPreferences: WatchSyncPreferences
        private set
    lateinit var watchStatusDataSource: WatchStatusDataSource
        private set
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        val database = GymCoachDatabase.get(this)
        val accountStore = SecureAccountStore(this)
        val watchPublisher = SwitchableWatchPhoneCommandPublisher()
        OfflineRuntime.initialize(this) { SyncScheduler.scheduleNow(this) }
        repository = GymCoachRepository(
            dao = database.dao(),
            accountStore = accountStore,
            api = ApiClient(),
            scheduleSyncNow = { SyncScheduler.scheduleNow(this) },
            schedulePeriodicSync = { SyncScheduler.schedulePeriodic(this) },
            watchCommandPublisher = watchPublisher,
        )
        watchSyncPreferences = WatchSyncPreferences(this)
        watchCompanionRuntime = WatchCompanionRuntimeFactory.create(
            phoneDeviceId = accountStore.deviceId,
            dao = database.dao(),
            repository = repository,
            scope = applicationScope,
        )
        watchStatusDataSource = WatchStatusDataSource(
            dao = database.dao(),
            runtime = watchCompanionRuntime,
            preferences = watchSyncPreferences,
            scope = applicationScope,
        )
        watchPublisher.attach(
            if (watchSyncPreferences.enabled.value && watchCompanionRuntime.transportConfigured) {
                watchCompanionRuntime.phoneCommands
            } else {
                NoOpWatchPhoneCommandPublisher
            },
        )
        watchCompanionRuntime.start()
        applicationScope.launch {
            watchSyncPreferences.enabled.collectLatest { enabled ->
                val active = enabled && watchCompanionRuntime.transportConfigured
                watchPublisher.attach(
                    if (active) watchCompanionRuntime.phoneCommands else NoOpWatchPhoneCommandPublisher,
                )
                if (watchCompanionRuntime.transportConfigured) {
                    runCatching {
                        if (active) watchCompanionRuntime.connect() else watchCompanionRuntime.disconnect()
                    }
                }
            }
        }
        if (repository.isLoggedIn) {
            SyncScheduler.scheduleNow(this)
            SyncScheduler.schedulePeriodic(this)
        }
    }

    override fun onTerminate() {
        watchCompanionRuntime.close()
        watchSyncPreferences.close()
        applicationScope.cancel()
        super.onTerminate()
    }
}
