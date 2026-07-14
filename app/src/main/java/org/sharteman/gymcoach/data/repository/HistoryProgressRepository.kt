package org.sharteman.gymcoach.data.repository

import android.content.Context
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import org.sharteman.gymcoach.data.model.MobileGoalRequest
import org.sharteman.gymcoach.data.model.MobileHistorySnapshot
import org.sharteman.gymcoach.data.model.MobileVolumeTargetClearRequest
import org.sharteman.gymcoach.data.model.MobileVolumeTargetRequest
import org.sharteman.gymcoach.data.network.HistoryProgressApiClient
import org.sharteman.gymcoach.data.security.AccountStore
import org.sharteman.gymcoach.data.security.SecureAccountStore

interface HistoryProgressDataSource {
    fun cachedHistory(month: String, programId: String?): MobileHistorySnapshot?
    suspend fun refreshHistory(month: String, programId: String?): MobileHistorySnapshot
    suspend fun deleteHistorySession(sessionId: String)
    suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int)
    suspend fun deleteGoal(goalId: String)
    suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int)
    suspend fun clearVolumeTarget(muscleGroup: String)
    suspend fun startDeload()
    suspend fun endDeload()
}

class HistoryProgressRepository(
    context: Context,
    private val accountStore: AccountStore = SecureAccountStore(context.applicationContext),
    private val api: HistoryProgressApiClient = HistoryProgressApiClient(),
) : HistoryProgressDataSource {
    private val cache = HistoryReadCache(context.applicationContext, api)

    override fun cachedHistory(month: String, programId: String?): MobileHistorySnapshot? {
        val account = credentials()
        return cache.read(account.userId, month, programId)
    }

    override suspend fun refreshHistory(month: String, programId: String?): MobileHistorySnapshot {
        val account = credentials()
        return api.history(account.serverUrl, account.token, month, programId).also {
            cache.write(account.userId, month, programId, it)
        }
    }

    override suspend fun deleteHistorySession(sessionId: String) {
        val account = credentials()
        api.deleteHistorySession(account.serverUrl, account.token, sessionId)
        cache.clearUser(account.userId)
    }

    override suspend fun saveGoal(exerciseId: String, targetWeightKg: Double, targetReps: Int) {
        val account = credentials()
        api.saveGoal(
            account.serverUrl,
            account.token,
            MobileGoalRequest(exerciseId, targetWeightKg, targetReps),
        )
    }

    override suspend fun deleteGoal(goalId: String) {
        val account = credentials()
        api.deleteGoal(account.serverUrl, account.token, goalId)
    }

    override suspend fun saveVolumeTarget(muscleGroup: String, mev: Int, mrv: Int) {
        val account = credentials()
        api.saveVolumeTarget(
            account.serverUrl,
            account.token,
            MobileVolumeTargetRequest(muscleGroup, mev, mrv),
        )
    }

    override suspend fun clearVolumeTarget(muscleGroup: String) {
        val account = credentials()
        api.clearVolumeTarget(
            account.serverUrl,
            account.token,
            MobileVolumeTargetClearRequest(muscleGroup),
        )
    }

    override suspend fun startDeload() {
        val account = credentials()
        api.startDeload(account.serverUrl, account.token)
    }

    override suspend fun endDeload() {
        val account = credentials()
        api.endDeload(account.serverUrl, account.token)
    }

    private fun credentials(): Credentials {
        val userId = accountStore.userId ?: throw MobileAuthenticationRequiredException()
        val token = accountStore.getAccessToken() ?: throw MobileAuthenticationRequiredException()
        return Credentials(userId, accountStore.serverUrl, token)
    }
}

private data class Credentials(val userId: String, val serverUrl: String, val token: String)

private class HistoryReadCache(context: Context, private val api: HistoryProgressApiClient) {
    private val preferences = context.getSharedPreferences("gymcoach-history-cache", Context.MODE_PRIVATE)

    fun read(userId: String, month: String, programId: String?): MobileHistorySnapshot? =
        preferences.getString(key(userId, month, programId), null)?.let { payload ->
            runCatching { api.json.decodeFromString<MobileHistorySnapshot>(payload) }.getOrNull()
        }

    fun write(userId: String, month: String, programId: String?, snapshot: MobileHistorySnapshot) {
        preferences.edit()
            .putString(key(userId, month, programId), api.json.encodeToString(snapshot))
            .apply()
    }

    fun clearUser(userId: String) {
        val prefix = "$userId|"
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(prefix) }.forEach(editor::remove)
        editor.apply()
    }

    private fun key(userId: String, month: String, programId: String?): String =
        "$userId|$month|${programId ?: "all"}"
}
