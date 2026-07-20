package org.sharteman.gymcoach.data.security

import android.app.Application
import android.content.Context
import androidx.test.runner.AndroidJUnitRunner

/** Runs the cross-version storage test without starting production synchronization. */
class AuthUpgradeTestRunner : AndroidJUnitRunner() {
    override fun newApplication(
        classLoader: ClassLoader?,
        className: String?,
        context: Context?,
    ): Application = super.newApplication(classLoader, Application::class.java.name, context)
}
