package org.sharteman.gymcoach.ui

import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.test.espresso.Espresso.pressBack
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class SetValuePickerDialogTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun initialAndEdgeOptionsSnapToTheFixedPointer() {
        setWeightPicker(value = "50", options = listOf(0.0, 25.0, 50.0, 75.0, 100.0))

        waitForPointerValue("50")
        assertOptionCentered("set-value-option-WEIGHT-50")
        composeRule.onNodeWithTag("weight-picker-pointer-left").fetchSemanticsNode()
        composeRule.onNodeWithTag("weight-picker-pointer-right").fetchSemanticsNode()

        repeat(4) {
            composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeDown() }
        }
        waitForPointerValue("0")
        composeRule.onNodeWithTag("set-value-field-text").assertTextContains("0")
        assertOptionCentered("set-value-option-WEIGHT-0")

        repeat(8) {
            composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeUp() }
        }
        waitForPointerValue("100")
        composeRule.onNodeWithTag("set-value-field-text").assertTextContains("100")
        assertOptionCentered("set-value-option-WEIGHT-100")
    }

    @Test
    fun scrollingUpdatesPreviewWithoutConfirmingAndCancelRestoresOpeningValue() {
        val confirmations = AtomicInteger(0)
        setHostedWeightPicker(confirmations = confirmations)

        composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeUp() }
        composeRule.waitUntil(5_000) { pointerValue() != "50" }
        val preview = pointerValue()

        assertEquals(0, confirmations.get())
        composeRule.onNodeWithTag("set-value-field-text").assertTextContains(preview)
        composeRule.onNodeWithTag("set-value-cancel").performClick()
        composeRule.onNodeWithTag("set-value-picker").assertDoesNotExist()
        composeRule.onNodeWithTag("persisted-weight").assertTextContains("50")
        assertEquals(0, confirmations.get())
    }

    @Test
    fun centeredDirectTapConfirmsExactlyOnceWithoutApply() {
        val confirmations = AtomicInteger(0)
        var confirmedValue: String? = null
        setWeightPicker(
            value = "62.5",
            options = listOf(60.0, 62.5, 65.0),
            onConfirm = { selected ->
                confirmedValue = selected
                confirmations.incrementAndGet()
            },
        )

        waitForPointerValue("62.5")
        composeRule.onNodeWithTag("set-value-option-WEIGHT-62.5").performTouchInput {
            click()
            click()
        }

        assertEquals("62.5", confirmedValue)
        assertEquals(1, confirmations.get())
        composeRule.onNodeWithTag("set-value-apply").assertIsNotEnabled()
    }

    @Test
    fun manualKeypadEntryRequiresExplicitApply() {
        val confirmations = AtomicInteger(0)
        var confirmedValue: String? = null
        setWeightPicker(
            value = "50",
            options = listOf(50.0, 62.5, 75.0),
            onConfirm = { selected ->
                confirmedValue = selected
                confirmations.incrementAndGet()
            },
        )

        composeRule.onNodeWithTag("set-value-key-backspace").performClick()
        composeRule.onNodeWithTag("set-value-key-backspace").performClick()
        composeRule.onNodeWithTag("set-value-apply").assertIsNotEnabled()
        composeRule.onNodeWithTag("set-value-key-6").performClick()
        composeRule.onNodeWithTag("set-value-key-2").performClick()
        composeRule.onNodeWithTag("set-value-key-decimal").performClick()
        composeRule.onNodeWithTag("set-value-key-5").performClick()

        assertEquals(0, confirmations.get())
        composeRule.onNodeWithTag("set-value-field-text").assertTextContains("62", substring = true)
        composeRule.onNodeWithTag("set-value-apply").performClick()
        assertEquals("62.5", confirmedValue)
        assertEquals(1, confirmations.get())
    }

    @Test
    fun manualKeyPressedDuringFlingWinsOverSettledPreview() {
        val confirmations = AtomicInteger(0)
        setWeightPicker(
            value = "50",
            options = (0..10).map { index -> index * 10.0 },
            onConfirm = { confirmations.incrementAndGet() },
        )
        waitForPointerValue("50")

        val listBounds = composeRule.onNodeWithTag("weight-picker-list")
            .fetchSemanticsNode().boundsInRoot
        val keyBounds = composeRule.onNodeWithTag("set-value-key-6")
            .fetchSemanticsNode().boundsInRoot
        injectSwipeUpThenTap(listBounds, keyBounds)

        composeRule.waitUntil(5_000) { fieldText().endsWith("6") }
        composeRule.waitForIdle()
        assertTrue(fieldText().endsWith("6"))
        assertEquals(0, confirmations.get())
    }

    @Test
    fun poundOptionsKeepTheirDisplayUnitAndConfirmedValue() {
        var confirmedValue: String? = null
        composeRule.setContent {
            GymCoachTheme {
                SetValuePickerDialog(
                    kind = SetValuePickerKind.WEIGHT,
                    value = "135",
                    options = listOf(125.0, 135.0, 145.0),
                    unit = "LB",
                    loadConstraints = null,
                    onDismiss = {},
                    onConfirm = { confirmedValue = it },
                )
            }
        }

        waitForPointerValue("135")
        composeRule.onNodeWithText("135 lb").assertIsDisplayed()
        composeRule.onNodeWithTag("set-value-option-WEIGHT-135").performClick()
        assertEquals("135", confirmedValue)
    }

    @Test
    fun systemBackRestoresOpeningValue() {
        val confirmations = AtomicInteger(0)
        setHostedWeightPicker(confirmations = confirmations)

        composeRule.onNodeWithTag("weight-picker-list").performTouchInput { swipeUp() }
        composeRule.waitUntil(5_000) { pointerValue() != "50" }
        pressBack()

        composeRule.onNodeWithTag("set-value-picker").assertDoesNotExist()
        composeRule.onNodeWithTag("persisted-weight").assertTextContains("50")
        assertEquals(0, confirmations.get())
    }

    @Test
    fun valueFieldStaysCenteredWithoutPlateDiagram() {
        setWeightPicker(value = "50", options = listOf(25.0, 50.0, 75.0))

        waitForPointerValue("50")
        assertSymmetricConfirmationGeometry()
    }

    private fun setHostedWeightPicker(confirmations: AtomicInteger) {
        composeRule.setContent {
            GymCoachTheme {
                var open by remember { mutableStateOf(true) }
                var persisted by remember { mutableStateOf("50") }
                Text(persisted, modifier = Modifier.testTag("persisted-weight"))
                if (open) {
                    SetValuePickerDialog(
                        kind = SetValuePickerKind.WEIGHT,
                        value = persisted,
                        options = listOf(0.0, 25.0, 50.0, 75.0, 100.0),
                        unit = "KG",
                        loadConstraints = null,
                        onDismiss = { open = false },
                        onConfirm = { selected ->
                            persisted = selected
                            confirmations.incrementAndGet()
                            open = false
                        },
                    )
                }
            }
        }
    }

    private fun setWeightPicker(
        value: String,
        options: List<Double>,
        onConfirm: (String) -> Unit = {},
    ) {
        composeRule.setContent {
            GymCoachTheme {
                SetValuePickerDialog(
                    kind = SetValuePickerKind.WEIGHT,
                    value = value,
                    options = options,
                    unit = "KG",
                    loadConstraints = null,
                    onDismiss = {},
                    onConfirm = onConfirm,
                )
            }
        }
    }

    private fun waitForPointerValue(expected: String) {
        composeRule.waitUntil(5_000) { pointerValue() == expected }
    }

    private fun pointerValue(): String = composeRule
        .onNodeWithTag("weight-picker-pointer")
        .fetchSemanticsNode()
        .config[SemanticsProperties.StateDescription]

    private fun fieldText(): String = composeRule
        .onNodeWithTag("set-value-field-text")
        .fetchSemanticsNode()
        .config[SemanticsProperties.Text]
        .single()
        .text

    private fun injectSwipeUpThenTap(listBounds: Rect, tapBounds: Rect) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val swipeDownTime = SystemClock.uptimeMillis()
        val swipeX = listBounds.center.x
        val swipeStartY = listBounds.bottom - 12f
        val swipeEndY = listBounds.top + 12f

        injectTouch(automation, swipeDownTime, swipeDownTime, MotionEvent.ACTION_DOWN, swipeX, swipeStartY)
        repeat(4) { step ->
            val fraction = (step + 1) / 5f
            injectTouch(
                automation = automation,
                downTime = swipeDownTime,
                eventTime = swipeDownTime + (step + 1) * 10L,
                action = MotionEvent.ACTION_MOVE,
                x = swipeX,
                y = swipeStartY + (swipeEndY - swipeStartY) * fraction,
            )
        }
        val swipeUpTime = swipeDownTime + 50L
        injectTouch(automation, swipeDownTime, swipeUpTime, MotionEvent.ACTION_UP, swipeX, swipeEndY)

        val tapDownTime = swipeUpTime + 2L
        injectTouch(
            automation,
            tapDownTime,
            tapDownTime,
            MotionEvent.ACTION_DOWN,
            tapBounds.center.x,
            tapBounds.center.y,
        )
        injectTouch(
            automation,
            tapDownTime,
            tapDownTime + 18L,
            MotionEvent.ACTION_UP,
            tapBounds.center.x,
            tapBounds.center.y,
        )
    }

    private fun injectTouch(
        automation: android.app.UiAutomation,
        downTime: Long,
        eventTime: Long,
        action: Int,
        x: Float,
        y: Float,
    ) {
        val event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0).apply {
            source = InputDevice.SOURCE_TOUCHSCREEN
        }
        try {
            assertTrue(automation.injectInputEvent(event, true))
        } finally {
            event.recycle()
        }
    }

    private fun assertOptionCentered(optionTag: String) {
        val pointerCenter = composeRule.onNodeWithTag("weight-picker-pointer")
            .fetchSemanticsNode().boundsInRoot.center.y
        val optionCenter = composeRule.onNodeWithTag(optionTag)
            .fetchSemanticsNode().boundsInRoot.center.y
        assertEquals(pointerCenter, optionCenter, 2f)
    }

    private fun assertSymmetricConfirmationGeometry() {
        val leading = composeRule.onNodeWithTag("set-value-leading-reserve").fetchSemanticsNode().boundsInRoot
        val value = composeRule.onNodeWithTag("set-value-field").fetchSemanticsNode().boundsInRoot
        val trailing = composeRule.onNodeWithTag("set-value-trailing-reserve").fetchSemanticsNode().boundsInRoot

        assertEquals(leading.width, trailing.width, 1f)
        assertEquals((leading.center.x + trailing.center.x) / 2f, value.center.x, 1f)
        assertNotEquals(0f, leading.width)
    }
}
