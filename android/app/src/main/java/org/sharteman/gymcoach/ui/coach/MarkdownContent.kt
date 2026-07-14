package org.sharteman.gymcoach.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

sealed interface MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock
    data class Paragraph(val text: String) : MarkdownBlock
    data class Bullet(val text: String, val ordered: Boolean, val number: Int? = null) : MarkdownBlock
    data class Quote(val text: String) : MarkdownBlock
    data class Code(val text: String) : MarkdownBlock
}

fun parseMarkdownBlocks(markdown: String): List<MarkdownBlock> {
    val result = mutableListOf<MarkdownBlock>()
    val paragraph = mutableListOf<String>()
    val code = mutableListOf<String>()
    var inCode = false

    fun flushParagraph() {
        if (paragraph.isNotEmpty()) {
            result += MarkdownBlock.Paragraph(paragraph.joinToString(" ").trim())
            paragraph.clear()
        }
    }

    fun flushCode() {
        result += MarkdownBlock.Code(code.joinToString("\n"))
        code.clear()
    }

    for (rawLine in markdown.lines()) {
        val line = rawLine.trimEnd()
        if (line.trimStart().startsWith("```")) {
            if (inCode) flushCode() else flushParagraph()
            inCode = !inCode
            continue
        }
        if (inCode) {
            code += rawLine
            continue
        }
        if (line.isBlank()) {
            flushParagraph()
            continue
        }
        val heading = Regex("^(#{1,6})\\s+(.+)$").matchEntire(line.trimStart())
        val unordered = Regex("^[-*+]\\s+(.+)$").matchEntire(line.trimStart())
        val ordered = Regex("^(\\d+)[.)]\\s+(.+)$").matchEntire(line.trimStart())
        when {
            heading != null -> {
                flushParagraph()
                result += MarkdownBlock.Heading(heading.groupValues[1].length, cleanInline(heading.groupValues[2]))
            }
            unordered != null -> {
                flushParagraph()
                result += MarkdownBlock.Bullet(cleanInline(unordered.groupValues[1]), ordered = false)
            }
            ordered != null -> {
                flushParagraph()
                result += MarkdownBlock.Bullet(
                    text = cleanInline(ordered.groupValues[2]),
                    ordered = true,
                    number = ordered.groupValues[1].toIntOrNull(),
                )
            }
            line.trimStart().startsWith(">") -> {
                flushParagraph()
                result += MarkdownBlock.Quote(cleanInline(line.trimStart().removePrefix(">").trim()))
            }
            else -> paragraph += cleanInline(line.trim())
        }
    }
    if (inCode) flushCode() else flushParagraph()
    return result
}

private fun cleanInline(text: String): String = text
    .replace(Regex("\\[([^]]+)]\\([^)]+\\)"), "$1")
    .replace("**", "")
    .replace("__", "")
    .replace("`", "")
    .replace(Regex("(?<!\\*)\\*(?!\\*)"), "")
    .replace(Regex("(?<!_)_(?!_)"), "")

@Composable
fun MarkdownContent(markdown: String, modifier: Modifier = Modifier) {
    val blocks = remember(markdown) { parseMarkdownBlocks(markdown) }
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> Text(
                    text = block.text,
                    style = when (block.level) {
                        1 -> MaterialTheme.typography.headlineSmall
                        2 -> MaterialTheme.typography.titleLarge
                        else -> MaterialTheme.typography.titleMedium
                    },
                    fontWeight = FontWeight.SemiBold,
                )
                is MarkdownBlock.Paragraph -> Text(
                    text = block.text,
                    style = MaterialTheme.typography.bodyMedium,
                )
                is MarkdownBlock.Bullet -> Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(if (block.ordered) "${block.number ?: 1}." else "•")
                    Text(block.text, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                }
                is MarkdownBlock.Quote -> Text(
                    text = block.text,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                )
                is MarkdownBlock.Code -> Text(
                    text = block.text,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
