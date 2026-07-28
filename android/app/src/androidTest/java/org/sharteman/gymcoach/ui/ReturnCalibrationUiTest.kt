package org.sharteman.gymcoach.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.sharteman.gymcoach.R
import org.sharteman.gymcoach.data.model.LongTermStrengthSummaryDto
import org.sharteman.gymcoach.data.model.ReturnRecommendationDto
import org.sharteman.gymcoach.data.model.StrengthEvidenceSummaryDto
import org.sharteman.gymcoach.ui.theme.GymCoachTheme

class ReturnCalibrationUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun familiarMovementUsesEquipmentCalibrationCopyAndSeparateConfidence() {
        composeRule.setContent {
            GymCoachTheme(darkTheme = true) {
                ReturnCalibrationEvidence(
                    ReturnRecommendationDto(
                        mode = "normal",
                        exerciseGapDays = 14,
                        returnGapDays = 14,
                        muscleGapDays = 14,
                        targetSets = 2,
                        targetRIR = 3,
                        suggestedWeight = 35.0,
                        weightCeiling = 40.0,
                        calibrationRequired = true,
                        calibrationKind = "equipment",
                        nonComparableHistorySessionCount = 25,
                        strengthSummary = LongTermStrengthSummaryDto(
                            movement = StrengthEvidenceSummaryDto(
                                sessionCount = 25,
                                workingSetCount = 117,
                                lastReliableLoad = 40.0,
                                confidence = "high",
                            ),
                            equipment = StrengthEvidenceSummaryDto(
                                sessionCount = 0,
                                workingSetCount = 0,
                                confidence = "low",
                            ),
                            anchorScope = "exact-exercise-unlinked",
                        ),
                    ),
                )
            }
        }

        composeRule.onNodeWithTag("return-calibration-evidence").assertIsDisplayed()
        composeRule.onNodeWithText(
            composeRule.activity.getString(R.string.equipment_calibration_title),
        ).assertIsDisplayed()
        composeRule.onNodeWithText(
            composeRule.activity.getString(R.string.movement_confidence_high),
        ).assertIsDisplayed()
        composeRule.onNodeWithText(
            composeRule.activity.getString(R.string.equipment_confidence_low),
        ).assertIsDisplayed()
        composeRule.onNodeWithText(
            composeRule.activity.getString(R.string.equipment_calibration_progress, 0),
        ).assertIsDisplayed()
    }
}
