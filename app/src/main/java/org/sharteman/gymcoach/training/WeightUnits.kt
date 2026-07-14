package org.sharteman.gymcoach.training

import kotlin.math.round

const val KG_PER_LB = 0.45359237

fun toDisplayWeight(weightKg: Double, unit: String): Double =
    if (unit.equals("LB", ignoreCase = true)) weightKg / KG_PER_LB else weightKg

fun fromDisplayWeight(value: Double, unit: String): Double =
    if (unit.equals("LB", ignoreCase = true)) value * KG_PER_LB else value

fun roundWeight(value: Double, decimals: Int = 2): Double {
    val factor = Math.pow(10.0, decimals.toDouble())
    return round(value * factor) / factor
}
