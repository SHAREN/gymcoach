package org.sharteman.gymcoach.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val TARGET_PACKAGE = "org.sharteman.gymcoach"

@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    @Test
    fun startup() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE,
        maxIterations = 1,
        stableIterations = 1,
        filterPredicate = ::isGymCoachRule,
    ) {
        pressHome()
        startActivityAndWait()
    }

    @Test
    fun representativeScreens() = baselineProfileRule.collect(
        packageName = TARGET_PACKAGE,
        maxIterations = 1,
        stableIterations = 1,
        filterPredicate = ::isGymCoachRule,
    ) {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        enableBenchmarkScreen(device, "HomeBenchmarkActivity")
        enableBenchmarkScreen(device, "AppPerformanceBenchmarkActivity")
        device.executeShellCommand("am force-stop $TARGET_PACKAGE")
        launchBenchmarkScreen(device, "HomeBenchmarkActivity")
        listOf("workout", "settings", "catalog", "history", "programs").forEach { scenario ->
            launchBenchmarkScreen(device, "AppPerformanceBenchmarkActivity", scenario)
        }
    }

    private fun enableBenchmarkScreen(device: UiDevice, activityName: String) {
        device.executeShellCommand(
            "pm enable $TARGET_PACKAGE/org.sharteman.gymcoach.ui.$activityName",
        )
    }

    private fun launchBenchmarkScreen(
        device: UiDevice,
        activityName: String,
        scenario: String? = null,
    ) {
        val scenarioArgument = scenario?.let { " --es scenario $it" }.orEmpty()
        device.executeShellCommand(
            "am start -W -n $TARGET_PACKAGE/org.sharteman.gymcoach.ui.$activityName" +
                " --activity-single-top --ez pulse false$scenarioArgument",
        )
        device.wait(Until.hasObject(By.pkg(TARGET_PACKAGE)), 5_000)
        device.waitForIdle()
        repeat(3) { scrollDownAndUp(device) }
    }

    private fun scrollDownAndUp(device: UiDevice) {
        val centerX = device.displayWidth / 2
        val top = device.displayHeight / 3
        val bottom = device.displayHeight * 2 / 3
        device.swipe(centerX, bottom, centerX, top, 10)
        device.swipe(centerX, top, centerX, bottom, 10)
    }

    private fun isGymCoachRule(rule: String): Boolean =
        "Lorg/sharteman/gymcoach/" in rule

}
