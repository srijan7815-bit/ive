package ai.ive.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.ive.app.IveRuntime
import ai.ive.app.core.AskOption
import ai.ive.app.core.LogEntry
import ai.ive.app.core.LogKind
import ai.ive.app.core.MusicState
import ai.ive.app.core.NotchState
import ai.ive.app.core.NotchTab
import ai.ive.app.core.NotchView
import ai.ive.app.core.PendingAsk
import ai.ive.app.data.Config
import ai.ive.app.data.IveConfig

val CollapsedHeight = 34.dp
val PanelWidth = 344.dp
val PanelHeight = 468.dp
val AlertWidth = 320.dp
val AlertHeight = 296.dp
val ComposerHeight = 118.dp

@Composable
fun NotchSurface(focusSink: (Boolean) -> Unit = {}) {
    val view = NotchState.view
    val targetWidth: Dp = when (view) {
        NotchView.Collapsed -> 150.dp
        NotchView.Panel -> PanelWidth
        NotchView.Alert -> AlertWidth
        NotchView.Composer -> PanelWidth
    }
    val targetHeight: Dp = when (view) {
        NotchView.Collapsed -> CollapsedHeight
        NotchView.Panel -> PanelHeight
        NotchView.Alert -> AlertHeight
        NotchView.Composer -> ComposerHeight
    }

    val w by animateDpAsState(targetWidth, spring(dampingRatio = 0.74f, stiffness = 380f), label = "w")
    val h by animateDpAsState(targetHeight, spring(dampingRatio = 0.74f, stiffness = 380f), label = "h")
    val collapsed = view == NotchView.Collapsed
    val radius by animateDpAsState(if (collapsed) 17.dp else 26.dp, spring(stiffness = 400f), label = "r")

    val shape = RoundedCornerShape(
        topStart = if (collapsed) radius else 20.dp,
        topEnd = if (collapsed) radius else 20.dp,
        bottomStart = radius,
        bottomEnd = radius
    )

    Box(
        Modifier
            .width(w)
            .height(h)
            .pointerInput(collapsed) {
                if (collapsed) {
                    detectTapGestures(
                        onTap = {
                            NotchState.view = NotchView.Panel
                            NotchState.tab = NotchTab.Assistant
                        },
                        onLongPress = { NotchState.view = NotchView.Composer }
                    )
                }
            }
            .clip(shape)
            .background(
                Brush.verticalGradient(
                    0f to Ink.GlassTop,
                    0.55f to Color(0xF20D1014),
                    1f to Ink.GlassBottom
                )
            )
            .border(1.dp, Brush.verticalGradient(listOf(Color(0x2EFFFFFF), Color(0x0AFFFFFF))), shape)
    ) {
        GlowLayer(view)
        AnimatedContent(
            targetState = view,
            transitionSpec = {
                fadeIn(tween(if (targetState == NotchView.Collapsed) 90 else 190)) togetherWith fadeOut(tween(110))
            },
            label = "notch"
        ) { v ->
            when (v) {
                NotchView.Collapsed -> CollapsedBar()
                NotchView.Panel -> PanelBody(focusSink = focusSink)
                NotchView.Alert -> AlertBody()
                NotchView.Composer -> QuickComposer(focusSink = focusSink)
            }
        }
    }
}

@Composable
private fun GlowLayer(view: NotchView) {
    val working = NotchState.working
    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1500, easing = LinearEasing), RepeatMode.Reverse),
        label = "glow"
    )
    if (working || view != NotchView.Collapsed) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.radialGradient(
                        colors = listOf(Ink.MintGlow.copy(alpha = if (working) 0.055f * pulse + 0.03f else 0.04f), Color.Transparent),
                        center = Offset(60f, -40f),
                        radius = 520f
                    )
                )
        )
    }
}

/* ---------------------------------- collapsed ---------------------------------- */

@Composable
private fun CollapsedBar() {
    val now = rememberClock()
    val music = NotchState.music
    val working = NotchState.working
    val dot by rememberInfiniteTransition(label = "dot").animateFloat(
        initialValue = 0.45f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1100), RepeatMode.Reverse),
        label = "d"
    )
    Row(
        Modifier.fillMaxSize().padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(6.dp)
                    .background(
                        if (working) Ink.Mint.copy(alpha = 0.4f + 0.6f * dot) else Ink.Faint,
                        CircleShape
                    )
            )
            Spacer(Modifier.width(7.dp))
            Text(
                now,
                color = Ink.Text.copy(alpha = 0.92f),
                fontSize = 11.5.sp,
                fontWeight = FontWeight.Medium,
                letterSpacing = 0.4.sp,
                fontFamily = if (working) Mono else FontFamily.Default
            )
        }
        if (music.hasTrack && (music.playing || NotchState.status != "quiet")) {
            MiniEq(playing = music.playing)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(2.5.dp), verticalAlignment = Alignment.CenterVertically) {
                repeat(3) { i ->
                    Box(
                        Modifier
                            .width(2.5.dp)
                            .height((6 + i * 3).dp)
                            .background(Ink.Faint, CircleShape)
                    )
                }
            }
        }
    }
}

@Composable
private fun MiniEq(playing: Boolean) {
    val t by rememberInfiniteTransition(label = "eq").animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "eqt"
    )
    Row(horizontalArrangement = Arrangement.spacedBy(2.5.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { i ->
            val phase = (t + i * 0.27f) % 1f
            val amp = if (playing) 0.35f + kotlin.math.abs(kotlin.math.sin(phase * Math.PI * 2).toFloat()) * 0.65f else 0.3f
            Box(
                Modifier
                    .width(2.5.dp)
                    .height((12 * amp).dp.coerceAtLeast(3.dp))
                    .background(Ink.Mint.copy(alpha = 0.85f), CircleShape)
            )
        }
    }
}

@Composable
fun rememberClock(): String {
    var text by remember { mutableStateOf(clockText()) }
    LaunchedEffect(Unit) {
        while (true) {
            text = clockText()
            kotlinx.coroutines.delay(15_000)
        }
    }
    return text
}

private fun clockText(): String {
    val cal = java.util.Calendar.getInstance()
    val h = cal.get(java.util.Calendar.HOUR_OF_DAY)
    val m = cal.get(java.util.Calendar.MINUTE)
    return "%02d:%02d".format(h, m)
}

/* ------------------------------------ panel ----------------------------------- */

@Composable
private fun PanelBody(focusSink: (Boolean) -> Unit) {
    Column(Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 10.dp)) {
        PanelHeader()
        Spacer(Modifier.height(8.dp))
        TabBar()
        Spacer(Modifier.height(9.dp))
        Box(Modifier.fillMaxWidth().weight(1f)) {
            when (NotchState.tab) {
                NotchTab.Assistant -> AssistantTab(focusSink)
                NotchTab.Music -> MusicTab()
                NotchTab.Settings -> SettingsTab()
            }
        }
        Spacer(Modifier.height(6.dp))
        if (NotchState.tab == NotchTab.Assistant) ComposerBar(focusSink) else FooterBar()
    }
}

@Composable
private fun PanelHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Glyph("spark", Ink.Mint, 12.dp)
        Spacer(Modifier.width(6.dp))
        Text(
            "IVE",
            color = Ink.Text,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.6.sp
        )
        Spacer(Modifier.width(8.dp))
        Text(
            NotchState.status,
            color = Ink.Faint,
            fontSize = 10.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.weight(1f))
        if (NotchState.working) {
            val t by rememberInfiniteTransition(label = "work").animateFloat(
                0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "wt"
            )
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                repeat(3) { i ->
                    val amp = 0.3f + kotlin.math.abs(kotlin.math.sin(((t + i * 0.2f) % 1f) * Math.PI * 2).toFloat()) * 0.7f
                    Box(
                        Modifier
                            .width(2.dp)
                            .height((10 * amp).dp.coerceAtLeast(2.dp))
                            .background(Ink.Mint.copy(0.9f), CircleShape)
                    )
                }
            }
            Spacer(Modifier.width(10.dp))
        }
        IconTap("gear", if (NotchState.tab == NotchTab.Settings) Ink.Mint else Ink.Muted) {
            NotchState.tab = if (NotchState.tab == NotchTab.Settings) NotchTab.Assistant else NotchTab.Settings
        }
        Spacer(Modifier.width(8.dp))
        IconTap("close", Ink.Muted) { NotchState.view = NotchView.Collapsed }
    }
}

@Composable
fun IconTap(name: String, tint: Color, size: Dp = 22.dp, onClick: () -> Unit) {
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) { Glyph(name, tint, size * 0.6f) }
}

@Composable
private fun TabBar() {
    Row(
        Modifier
            .fillMaxWidth()
            .height(28.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(Color(0x14FFFFFF))
            .padding(3.dp)
    ) {
        listOf(NotchTab.Assistant to "Assistant", NotchTab.Music to "Music", NotchTab.Settings to "Settings").forEach { (tab, label) ->
            val active = NotchState.tab == tab
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(7.dp))
                    .background(if (active) Color(0x1FFFFFFF) else Color.Transparent)
                    .clickable { NotchState.tab = tab },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    label,
                    color = if (active) Ink.Text else Ink.Faint,
                    fontSize = 10.5.sp,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal
                )
            }
        }
    }
}

/* ---------------------------------- assistant --------------------------------- */

@Composable
private fun AssistantTab(focusSink: (Boolean) -> Unit) {
    val list = NotchState.log
    val state = rememberLazyListState()
    LaunchedEffect(list.size) {
        if (list.isNotEmpty()) state.animateScrollToItem((list.size - 1).coerceAtLeast(0))
    }
    if (list.isEmpty()) {
        EmptyState()
        return
    }
    LazyColumn(
        state = state,
        verticalArrangement = Arrangement.spacedBy(9.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        items(list.size) { i ->
            LogRow(list[i])
        }
    }
}

@Composable
private fun LogRow(entry: LogEntry) {
    when (entry.kind) {
        LogKind.User -> {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Text(
                    entry.text,
                    color = Ink.Text,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    modifier = Modifier
                        .widthIn(max = 250.dp)
                        .clip(RoundedCornerShape(14.dp, 14.dp, 4.dp, 14.dp))
                        .background(Color(0x1FFFFFFF))
                        .padding(horizontal = 10.dp, vertical = 7.dp)
                )
            }
        }
        LogKind.Assistant -> {
            Column(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Glyph("spark", Ink.Mint, 9.dp)
                    Spacer(Modifier.width(5.dp))
                    Text("IVE", color = Ink.Mint.copy(0.75f), fontSize = 8.5.sp, letterSpacing = 1.2.sp)
                }
                Spacer(Modifier.height(3.dp))
                Text(entry.text, color = Ink.Text.copy(0.94f), fontSize = 12.5.sp, lineHeight = 18.sp)
            }
        }
        LogKind.Tool -> Text(
            entry.text,
            color = Ink.Faint,
            fontFamily = Mono,
            fontSize = 9.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        LogKind.Error -> Text(
            entry.text,
            color = Ink.Danger,
            fontSize = 11.5.sp,
            lineHeight = 16.sp
        )
        LogKind.System -> Text(
            entry.text,
            color = Ink.Faint,
            fontSize = 11.sp,
            lineHeight = 16.sp
        )
    }
}

@Composable
private fun EmptyState() {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Glyph("spark", Ink.Mint.copy(0.5f), 20.dp)
        Spacer(Modifier.height(10.dp))
        Text("Nothing running.", color = Ink.Muted, fontSize = 12.sp)
        Spacer(Modifier.height(3.dp))
        Text("Ask below — I'll stay out of the way.", color = Ink.Faint, fontSize = 10.5.sp)
    }
}

@Composable
private fun ComposerBar(focusSink: (Boolean) -> Unit) {
    var text by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    Row(
        Modifier
            .fillMaxWidth()
            .height(40.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(Color(0x16FFFFFF))
            .border(1.dp, Ink.Hairline, RoundedCornerShape(13.dp))
            .padding(start = 12.dp, end = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.weight(1f)) {
            if (text.isEmpty()) {
                Text("Ask IVE…", color = Ink.Faint, fontSize = 12.sp)
            }
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                textStyle = TextStyle(color = Ink.Text, fontSize = 12.sp),
                cursorBrush = SolidColor(Ink.Mint),
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    if (text.isNotBlank()) {
                        IveRuntime.submit(text)
                        text = ""
                    }
                }),
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focus)
                    .onFocusChanged { st -> focusSink(st.isFocused) }
            )
        }
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(if (text.isBlank()) Color(0x14FFFFFF) else Ink.Mint)
                .clickable(enabled = text.isNotBlank()) {
                    IveRuntime.submit(text)
                    text = ""
                },
            contentAlignment = Alignment.Center
        ) {
            Glyph("send", if (text.isBlank()) Ink.Faint else Color(0xFF04120C), 12.dp)
        }
    }
}

@Composable
private fun FooterBar() {
    Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph("shield", Ink.Faint, 10.dp)
        Spacer(Modifier.width(6.dp))
        Text(
            if (NotchState.music.hasTrack) "Music follows your player" else "Nothing in the way",
            color = Ink.Faint,
            fontSize = 9.5.sp
        )
        Spacer(Modifier.weight(1f))
        Text("v1.0.0", color = Ink.Faint, fontSize = 9.sp)
    }
}

/* ------------------------------------ music ----------------------------------- */

@Composable
private fun MusicTab() {
    val m = NotchState.music
    Column(Modifier.fillMaxSize()) {
        if (!m.hasTrack) {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Glyph("note", Ink.Faint, 22.dp)
                Spacer(Modifier.height(10.dp))
                Text("Nothing playing", color = Ink.Muted, fontSize = 12.sp)
                Spacer(Modifier.height(3.dp))
                Text("Start music in any app.", color = Ink.Faint, fontSize = 10.5.sp)
            }
            return
        }
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(16.dp))
                .background(
                    Brush.linearGradient(
                        listOf(Color(0xFF1F3A33), Color(0xFF12202A), Color(0xFF161018))
                    )
                ),
            contentAlignment = Alignment.Center
        ) {
            Box(
                Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Brush.linearGradient(listOf(Ink.Mint.copy(0.22f), Color(0xFF0B1210))))
                    .border(1.dp, Color(0x22FFFFFF), RoundedCornerShape(22.dp)),
                contentAlignment = Alignment.Center
            ) { Glyph("note", Ink.Mint.copy(0.9f), 34.dp) }
            Text(
                m.packageName.substringAfterLast('.'),
                color = Ink.Faint,
                fontSize = 8.5.sp,
                modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)
            )
        }
        Spacer(Modifier.height(10.dp))
        Text(m.title.ifBlank { "Unknown track" }, color = Ink.Text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(m.artist.ifBlank { "—" }, color = Ink.Muted, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        val dur = (m.durationMs.coerceAtLeast(1)).toFloat()
        Slider(
            value = (m.positionMs.toFloat() / dur).coerceIn(0f, 1f),
            onValueChange = { frac -> IveRuntime.seek((frac * dur).toLong()) },
            colors = SliderDefaults.colors(
                thumbColor = Ink.Mint,
                activeTrackColor = Ink.Mint.copy(0.8f),
                inactiveTrackColor = Color(0x1FFFFFFF)
            ),
            modifier = Modifier.fillMaxWidth().height(24.dp)
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            IconTap("prev", Ink.Text, 30.dp) { IveRuntime.media("previous") }
            Spacer(Modifier.width(22.dp))
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(Ink.Mint)
                    .clickable { IveRuntime.media("playpause") },
                contentAlignment = Alignment.Center
            ) {
                Glyph(if (m.playing) "pause" else "play", Color(0xFF04120C), 16.dp)
            }
            Spacer(Modifier.width(22.dp))
            IconTap("next", Ink.Text, 30.dp) { IveRuntime.media("next") }
        }
    }
}

/* ----------------------------------- settings --------------------------------- */

@Composable
private fun SettingsTab() {
    val cfg = NotchState.config
    Column(Modifier.fillMaxSize().padding(top = 2.dp)) {
        Section("MODEL")
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
            listOf("openai" to "OpenAI", "anthropic" to "Anthropic", "ollama" to "Local").forEach { (id, label) ->
                val active = cfg.provider == id
                Box(
                    Modifier
                        .weight(1f)
                        .height(28.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (active) Ink.Mint.copy(0.16f) else Color(0x12FFFFFF))
                        .border(1.dp, if (active) Ink.Mint.copy(0.45f) else Color.Transparent, RoundedCornerShape(8.dp))
                        .clickable {
                            val next = cfg.copy(provider = id, model = Config.defaultModelFor(id), baseUrl = "")
                            NotchState.config = next
                            Config.save(next)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (active) Ink.Mint else Ink.Muted, fontSize = 10.5.sp)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Field("Model", cfg.model) { v ->
            val next = cfg.copy(model = v)
            NotchState.config = next
            Config.save(next)
        }
        Spacer(Modifier.height(8.dp))
        Section("PERMISSIONS")
        PermissionRow("Show over other apps", IveRuntime.hasOverlay())
        PermissionRow("Music & notifications", IveRuntime.hasNotifAccess())
        PermissionRow("Battery unrestricted", IveRuntime.batteryExempt())
        Spacer(Modifier.height(8.dp))
        Section("AUTONOMY")
        ToggleRow("Edit files without asking", cfg.autoApproveWrites) { on ->
            val next = cfg.copy(autoApproveWrites = on)
            NotchState.config = next
            Config.save(next)
        }
        ToggleRow("Read files without asking", cfg.autoApproveReads) { on ->
            val next = cfg.copy(autoApproveReads = on)
            NotchState.config = next
            Config.save(next)
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Open full settings", color = Ink.Mint.copy(0.85f), fontSize = 10.5.sp,
                modifier = Modifier.clickable { IveRuntime.openSettings() })
            Spacer(Modifier.weight(1f))
            Text("Clear log", color = Ink.Faint, fontSize = 10.5.sp,
                modifier = Modifier.clickable { NotchState.log.clear() })
        }
    }
}

@Composable
private fun Section(label: String) {
    Text(label, color = Ink.Faint, fontSize = 8.5.sp, letterSpacing = 1.4.sp, modifier = Modifier.padding(bottom = 5.dp))
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit) {
    var text by remember(value) { mutableStateOf(value) }
    Row(
        Modifier
            .fillMaxWidth()
            .height(32.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(Color(0x12FFFFFF))
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Ink.Faint, fontSize = 10.sp, modifier = Modifier.width(58.dp))
        BasicTextField(
            value = text,
            onValueChange = { text = it; onChange(it) },
            textStyle = TextStyle(color = Ink.Text, fontSize = 11.5.sp),
            cursorBrush = SolidColor(Ink.Mint),
            singleLine = true,
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun PermissionRow(label: String, granted: Boolean) {
    Row(Modifier.fillMaxWidth().height(26.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(5.dp)
                .background(if (granted) Ink.Mint else Ink.Faint, CircleShape)
        )
        Spacer(Modifier.width(8.dp))
        Text(label, color = if (granted) Ink.Muted else Ink.Text.copy(0.85f), fontSize = 11.sp)
        Spacer(Modifier.weight(1f))
        if (granted) Glyph("check", Ink.Mint, 10.dp)
        else Text("Grant", color = Ink.Mint, fontSize = 10.sp, modifier = Modifier.clickable { IveRuntime.openSettings() })
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = Ink.Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Color(0xFF04120C),
                checkedTrackColor = Ink.Mint,
                uncheckedThumbColor = Ink.Faint,
                uncheckedTrackColor = Color(0x22FFFFFF)
            ),
        )
    }
}

/* ------------------------------------- alert ---------------------------------- */

@Composable
private fun AlertBody() {
    val pair = NotchState.ask ?: return
    val ask: PendingAsk = pair.second
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(5.dp).background(Ink.Mint, CircleShape)
            )
            Spacer(Modifier.width(7.dp))
            Text("IVE", color = Ink.Mint.copy(0.8f), fontSize = 9.sp, letterSpacing = 1.4.sp)
            Spacer(Modifier.weight(1f))
            IconTap("close", Ink.Faint) { IveRuntime.dismissAsk() }
        }
        Spacer(Modifier.height(10.dp))
        Text(ask.title, color = Ink.Text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp)
        Spacer(Modifier.height(5.dp))
        Text(ask.body, color = Ink.Muted, fontSize = 11.5.sp, lineHeight = 16.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        if (ask.detail.isNotBlank()) {
            Spacer(Modifier.height(7.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(46.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Color(0x0DFFFFFF))
                    .padding(7.dp)
            ) {
                Text(ask.detail, color = Ink.Faint, fontFamily = Mono, fontSize = 8.5.sp, lineHeight = 11.sp, maxLines = 4, overflow = TextOverflow.Ellipsis)
            }
        }
        Spacer(Modifier.weight(1f))
        val opts = ask.options.take(4)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            opts.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                    row.forEach { opt ->
                        ButtonPill(opt, Modifier.weight(1f))
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun ButtonPill(opt: AskOption, modifier: Modifier = Modifier) {
    val primary = opt.style == "primary"
    val danger = opt.style == "danger"
    Box(
        modifier
            .height(30.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(
                when {
                    primary -> Ink.Mint
                    danger -> Color(0x22FF8A80)
                    else -> Color(0x14FFFFFF)
                }
            )
            .clickable { IveRuntime.answer(opt) },
        contentAlignment = Alignment.Center
    ) {
        Text(
            opt.label,
            color = when {
                primary -> Color(0xFF04120C)
                danger -> Ink.Danger
                else -> Ink.Text.copy(0.9f)
            },
            fontSize = 10.5.sp,
            fontWeight = if (primary) FontWeight.SemiBold else FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

/* ----------------------------------- composer --------------------------------- */

@Composable
private fun QuickComposer(focusSink: (Boolean) -> Unit) {
    var text by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(220)
        runCatching { focus.requestFocus() }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Glyph("spark", Ink.Mint, 11.dp)
            Spacer(Modifier.width(6.dp))
            Text("IVE  ·  think out loud", color = Ink.Faint, fontSize = 9.sp, letterSpacing = 0.8.sp)
            Spacer(Modifier.weight(1f))
            IconTap("close", Ink.Faint) { NotchState.view = NotchView.Panel }
        }
        Spacer(Modifier.height(8.dp))
        BasicTextField(
            value = text,
            onValueChange = { text = it },
            textStyle = TextStyle(color = Ink.Text, fontSize = 15.sp, lineHeight = 21.sp),
            cursorBrush = SolidColor(Ink.Mint),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = {
                if (text.isNotBlank()) {
                    IveRuntime.submit(text)
                    text = ""
                    NotchState.view = NotchView.Panel
                }
            }),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .focusRequester(focus)
                .onFocusChanged { focusSink(it.isFocused) }
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("silent  ·  background", color = Ink.Faint, fontSize = 9.sp)
            Spacer(Modifier.weight(1f))
            Text(
                "send ↵",
                color = Ink.Mint,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clickable {
                    if (text.isNotBlank()) {
                        IveRuntime.submit(text)
                        text = ""
                        NotchState.view = NotchView.Panel
                    }
                }
            )
        }
    }
}
