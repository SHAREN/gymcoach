package org.sharteman.gymcoach.ui

import org.sharteman.gymcoach.data.model.MobileHistorySessionDto
import java.time.Instant
import java.time.LocalDate
import java.time.DayOfWeek
import java.time.YearMonth
import java.time.ZoneId
import java.time.temporal.WeekFields
import java.util.Locale

internal data class NativeHistoryCalendarDay(
    val date: LocalDate,
    val inMonth: Boolean,
)

internal fun buildNativeHistoryMonthGrid(
    monthKey: String,
    locale: Locale = Locale.getDefault(),
): List<NativeHistoryCalendarDay> {
    val month = YearMonth.parse(monthKey)
    val first = month.atDay(1)
    val firstWeekday = if (locale.language.equals("ru", ignoreCase = true)) {
        DayOfWeek.MONDAY
    } else {
        WeekFields.of(locale).firstDayOfWeek
    }
    val leading = (first.dayOfWeek.value - firstWeekday.value + 7) % 7
    val start = first.minusDays(leading.toLong())
    return (0 until 42).map { offset ->
        val date = start.plusDays(offset.toLong())
        NativeHistoryCalendarDay(date, YearMonth.from(date) == month)
    }
}

internal fun nativeHistoryDateKey(value: String, zoneId: ZoneId = ZoneId.systemDefault()): String =
    runCatching { Instant.parse(value).atZone(zoneId).toLocalDate().toString() }
        .getOrElse { value.take(10) }

internal fun nativeHistorySessionsByDay(
    sessions: List<MobileHistorySessionDto>,
    monthKey: String,
    zoneId: ZoneId = ZoneId.systemDefault(),
): Map<String, List<MobileHistorySessionDto>> = sessions
    .groupBy { nativeHistoryDateKey(it.startedAt, zoneId) }
    .filterKeys { it.startsWith(monthKey) }
    .mapValues { (_, values) -> values.sortedBy { it.startedAt } }

internal fun defaultNativeHistoryDay(
    monthKey: String,
    sessionsByDay: Map<String, List<MobileHistorySessionDto>>,
    today: LocalDate = LocalDate.now(),
): String = when {
    YearMonth.from(today).toString() == monthKey -> today.toString()
    sessionsByDay.isNotEmpty() -> sessionsByDay.keys.max()
    else -> "$monthKey-01"
}
