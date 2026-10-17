package ai.ive.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.center
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Hand-drawn glyphs — no icon pack, so the whole app stays ~3 MB and looks like IVE. */
@Composable
fun Glyph(
    name: String,
    tint: Color,
    size: Dp = 16.dp,
    stroke: Dp = 1.6.dp,
    modifier: Modifier = Modifier
) {
    Canvas(modifier.size(size)) {
        val c = this.size.center
        val r = this.size.minDimension / 2f
        val sw = stroke.toPx()
        when (name) {
            "play" -> {
                val p = Path().apply {
                    moveTo(c.x - r * 0.42f, c.y - r * 0.62f)
                    lineTo(c.x + r * 0.66f, c.y)
                    lineTo(c.x - r * 0.42f, c.y + r * 0.62f)
                    close()
                }
                drawPath(p, tint)
            }
            "pause" -> {
                val w = r * 0.26f
                drawRoundRect(tint, Offset(c.x - r * 0.52f, c.y - r * 0.58f), Size(w, r * 1.16f), CornerRadius(w / 2))
                drawRoundRect(tint, Offset(c.x + r * 0.26f, c.y - r * 0.58f), Size(w, r * 1.16f), CornerRadius(w / 2))
            }
            "next", "prev" -> {
                val dir = if (name == "next") 1f else -1f
                val p = Path().apply {
                    moveTo(c.x - dir * r * 0.5f, c.y - r * 0.55f)
                    lineTo(c.x + dir * r * 0.12f, c.y)
                    lineTo(c.x - dir * r * 0.5f, c.y + r * 0.55f)
                    close()
                }
                drawPath(p, tint)
                drawRoundRect(
                    tint,
                    Offset(if (dir > 0) c.x + r * 0.34f else c.x - r * 0.52f, c.y - r * 0.55f),
                    Size(r * 0.18f, r * 1.1f), CornerRadius(r * 0.09f)
                )
            }
            "send" -> {
                val p = Path().apply {
                    moveTo(c.x - r * 0.62f, c.y - r * 0.52f)
                    lineTo(c.x + r * 0.66f, c.y)
                    lineTo(c.x - r * 0.62f, c.y + r * 0.52f)
                    lineTo(c.x - r * 0.4f, c.y)
                    close()
                }
                drawPath(p, tint)
            }
            "close" -> {
                drawLine(tint, Offset(c.x - r * 0.45f, c.y - r * 0.45f), Offset(c.x + r * 0.45f, c.y + r * 0.45f), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x + r * 0.45f, c.y - r * 0.45f), Offset(c.x - r * 0.45f, c.y + r * 0.45f), sw, StrokeCap.Round)
            }
            "back" -> {
                drawLine(tint, Offset(c.x - r * 0.5f, c.y), Offset(c.x + r * 0.5f, c.y), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x - r * 0.5f, c.y), Offset(c.x - r * 0.08f, c.y - r * 0.42f), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x - r * 0.5f, c.y), Offset(c.x - r * 0.08f, c.y + r * 0.42f), sw, StrokeCap.Round)
            }
            "gear" -> {
                drawCircle(tint, r * 0.3f, c, style = Stroke(sw))
                for (i in 0 until 8) {
                    val a = (Math.PI / 4 * i).toFloat()
                    val inner = r * 0.52f
                    val outer = r * 0.78f
                    drawLine(
                        tint,
                        Offset(c.x + kotlin.math.cos(a) * inner, c.y + kotlin.math.sin(a) * inner),
                        Offset(c.x + kotlin.math.cos(a) * outer, c.y + kotlin.math.sin(a) * outer),
                        sw, StrokeCap.Round
                    )
                }
            }
            "spark" -> {
                val p = Path().apply {
                    moveTo(c.x, c.y - r * 0.82f)
                    quadraticBezierTo(c.x + r * 0.16f, c.y - r * 0.16f, c.x + r * 0.82f, c.y)
                    quadraticBezierTo(c.x + r * 0.16f, c.y + r * 0.16f, c.x, c.y + r * 0.82f)
                    quadraticBezierTo(c.x - r * 0.16f, c.y + r * 0.16f, c.x - r * 0.82f, c.y)
                    quadraticBezierTo(c.x - r * 0.16f, c.y - r * 0.16f, c.x, c.y - r * 0.82f)
                    close()
                }
                drawPath(p, tint)
            }
            "note" -> {
                drawRoundRect(tint, Offset(c.x - r * 0.05f, c.y - r * 0.62f), Size(r * 0.1f, r * 0.95f), CornerRadius(r * 0.05f))
                drawRoundRect(tint, Offset(c.x - r * 0.05f, c.y - r * 0.62f), Size(r * 0.55f, r * 0.1f), CornerRadius(r * 0.05f))
                drawCircle(tint, r * 0.24f, Offset(c.x - r * 0.28f, c.y + r * 0.4f))
            }
            "key" -> {
                drawCircle(tint, r * 0.26f, Offset(c.x - r * 0.3f, c.y), style = Stroke(sw))
                drawLine(tint, Offset(c.x - r * 0.06f, c.y), Offset(c.x + r * 0.72f, c.y), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x + r * 0.42f, c.y), Offset(c.x + r * 0.42f, c.y + r * 0.34f), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x + r * 0.66f, c.y), Offset(c.x + r * 0.66f, c.y + r * 0.24f), sw, StrokeCap.Round)
            }
            "check" -> {
                drawLine(tint, Offset(c.x - r * 0.5f, c.y + r * 0.02f), Offset(c.x - r * 0.12f, c.y + r * 0.42f), sw, StrokeCap.Round)
                drawLine(tint, Offset(c.x - r * 0.12f, c.y + r * 0.42f), Offset(c.x + r * 0.55f, c.y - r * 0.44f), sw, StrokeCap.Round)
            }
            "shield" -> {
                val p = Path().apply {
                    moveTo(c.x, c.y - r * 0.72f)
                    lineTo(c.x + r * 0.62f, c.y - r * 0.44f)
                    lineTo(c.x + r * 0.62f, c.y + r * 0.08f)
                    quadraticBezierTo(c.x + r * 0.56f, c.y + r * 0.62f, c.x, c.y + r * 0.78f)
                    quadraticBezierTo(c.x - r * 0.56f, c.y + r * 0.62f, c.x - r * 0.62f, c.y + r * 0.08f)
                    lineTo(c.x - r * 0.62f, c.y - r * 0.44f)
                    close()
                }
                drawPath(p, tint, style = Stroke(sw))
            }
            else -> drawCircle(tint, r * 0.16f, c)
        }
    }
}

fun DrawScope.eqBar(x: Float, w: Float, amp: Float, color: Color) {
    val h = size.height * amp
    drawRoundRect(
        color,
        Offset(x, (size.height - h) / 2f),
        Size(w, h),
        CornerRadius(w / 2f)
    )
}
