package ai.ive.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object Ink {
    val Void = Color(0xFF050609)
    val GlassTop = Color(0xF2161A20)
    val GlassBottom = Color(0xF20A0C10)
    val Hairline = Color(0x1FFFFFFF)
    val HairlineStrong = Color(0x33FFFFFF)

    val Mint = Color(0xFF9EF2CF)
    val MintDeep = Color(0xFF4ED8A4)
    val MintGlow = Color(0x339EF2CF)

    val Text = Color(0xFFF3F5F8)
    val Muted = Color(0xFF9BA4AF)
    val Faint = Color(0xFF646D79)
    val Danger = Color(0xFFFF8A80)
    val Warn = Color(0xFFFFD48A)
}

val IveTypography = Typography(
    displaySmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, letterSpacing = (-0.6).sp),
    titleMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, letterSpacing = (-0.2).sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp),
    bodySmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Normal, fontSize = 11.5.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 10.sp, letterSpacing = 0.6.sp),
    labelMedium = TextStyle(fontFamily = FontFamily.Default, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.3.sp)
)

val Mono = FontFamily.Monospace

private val IveScheme = darkColorScheme(
    primary = Ink.Mint,
    onPrimary = Color(0xFF04120C),
    secondary = Ink.MintDeep,
    background = Ink.Void,
    onBackground = Ink.Text,
    surface = Color(0xFF0E1116),
    onSurface = Ink.Text,
    surfaceVariant = Color(0xFF161A20),
    onSurfaceVariant = Ink.Muted,
    error = Ink.Danger
)

@Composable
fun IveTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()
    MaterialTheme(colorScheme = IveScheme, typography = IveTypography, content = content)
}
