package ai.ive.app

import ai.ive.app.ai.Provider
import ai.ive.app.core.LogKind
import ai.ive.app.core.NotchState
import ai.ive.app.data.Config
import ai.ive.app.data.IveConfig
import ai.ive.app.data.History
import ai.ive.app.overlay.NotchService
import ai.ive.app.ui.Glyph
import ai.ive.app.ui.Ink
import ai.ive.app.ui.IveTheme
import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        History.init(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        setContent {
            IveTheme {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Ink.Void)
                ) {
                    Backdrop()
                    MainScreen()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        NotchState.config = Config.load()
        // Keep the notch alive across app visits if the user already opted in.
        val cfg = NotchState.config
        if (cfg.onboardingDone && cfg.notchEnabled && IveRuntime.hasOverlay() && !NotchService.running) {
            IveRuntime.startNotch()
        }
    }
}

@Composable
private fun Backdrop() {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Ink.Mint.copy(0.10f), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(240f, -120f),
                    radius = 900f
                )
            )
    )
}

@Composable
private fun MainScreen() {
    val scroll = rememberScrollState()
    var cfg by remember { mutableStateOf(NotchState.config) }
    fun save(next: IveConfig) {
        cfg = next
        NotchState.config = next
        Config.save(next)
    }

    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(scroll)
            .padding(horizontal = 22.dp, vertical = 18.dp)
    ) {
        Brand()
        Spacer(Modifier.height(26.dp))

        val ready = cfg.onboardingDone
        if (!ready) {
            Text(
                "A quiet assistant,\nat the top of your screen.",
                color = Ink.Text,
                fontSize = 27.sp,
                lineHeight = 33.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = (-0.7).sp
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Long-press the notch to think out loud. IVE works in the background and only taps you when it needs a decision.",
                color = Ink.Muted,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )
            Spacer(Modifier.height(22.dp))
            SetupCard(cfg, onSave = ::save)
        } else {
            ActiveCard(cfg, onSave = ::save)
        }

        Spacer(Modifier.height(18.dp))
        ModelCard(cfg, onSave = ::save)
        Spacer(Modifier.height(14.dp))
        BehaviourCard(cfg, onSave = ::save)
        Spacer(Modifier.height(14.dp))
        AboutCard()
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(Brush.linearGradient(listOf(Ink.Mint.copy(0.9f), Ink.MintDeep)))
                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(11.dp)),
            contentAlignment = Alignment.Center
        ) {
            Glyph("spark", Color(0xFF04120C), 16.dp)
        }
        Spacer(Modifier.width(11.dp))
        Column {
            Text("IVE", color = Ink.Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 4.sp)
            Text("intelligence, very quiet", color = Ink.Faint, fontSize = 9.5.sp, letterSpacing = 0.6.sp)
        }
    }
}

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Brush.verticalGradient(listOf(Color(0xFF12161B), Color(0xFF0A0C10))))
            .border(1.dp, Ink.Hairline, RoundedCornerShape(20.dp))
            .padding(16.dp)
    ) { content() }
}

@Composable
private fun SetupCard(cfg: IveConfig, onSave: (IveConfig) -> Unit) {
    val overlay = IveRuntime.hasOverlay()
    val notif = IveRuntime.hasNotifAccess()
    val battery = IveRuntime.batteryExempt()

    Card {
        Text("SETUP", color = Ink.Faint, fontSize = 9.sp, letterSpacing = 1.6.sp)
        Spacer(Modifier.height(10.dp))
        StepRow("1", "Draw over other apps", "The notch lives above everything.", overlay) { IveRuntime.requestOverlay() }
        StepRow("2", "Music & notifications", "Powers the music card and missed-notification tools.", notif) { IveRuntime.requestNotifAccess() }
        StepRow("3", "Unrestricted battery", "Stops Android from folding the notch away.", battery) { IveRuntime.requestBatteryExempt() }
        StepRow("4", "Add your model key", "Stored in the Android Keystore, never in plain text.", cfg.hasKey) {
            // The key field below is always visible; this scrolls attention to it.
        }
        Spacer(Modifier.height(14.dp))
        PrimaryButton("Turn on the notch", enabled = overlay) {
            IveRuntime.startNotch()
            onSave(cfg.copy(onboardingDone = true))
        }
        if (!overlay) {
            Spacer(Modifier.height(7.dp))
            Text("Grant draw-over-apps first.", color = Ink.Warn, fontSize = 10.5.sp)
        }
    }
}

@Composable
private fun ActiveCard(cfg: IveConfig, onSave: (IveConfig) -> Unit) {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(6.dp).background(if (NotchService.running) Ink.Mint else Ink.Warn, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(
                if (NotchService.running) "Notch is on" else "Notch is off",
                color = Ink.Text,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium
            )
            Spacer(Modifier.weight(1f))
            Text(
                if (NotchService.running) "Hide" else "Show",
                color = Ink.Mint,
                fontSize = 11.5.sp,
                modifier = Modifier.clickable {
                    if (NotchService.running) {
                        IveRuntime.stopNotch()
                        onSave(cfg.copy(notchEnabled = false))
                    } else if (IveRuntime.hasOverlay()) {
                        IveRuntime.startNotch()
                        onSave(cfg.copy(notchEnabled = true))
                    } else {
                        IveRuntime.requestOverlay()
                    }
                }
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "Long-press the notch to write. Everything runs in the background — you only hear from it when it matters.",
            color = Ink.Muted,
            fontSize = 11.5.sp,
            lineHeight = 17.sp
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallButton("Ask now") {
                IveRuntime.startNotch()
                NotchState.view = ai.ive.app.core.NotchView.Composer
            }
            SmallButton("Reset chat", ghost = true) { IveRuntime.resetAll() }
            SmallButton("Notifications", ghost = true) { IveRuntime.requestNotifAccess() }
        }
    }
}

@Composable
private fun StepRow(num: String, title: String, sub: String, done: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (done) Ink.Mint.copy(0.18f) else Color(0x12FFFFFF)),
            contentAlignment = Alignment.Center
        ) {
            if (done) Glyph("check", Ink.Mint, 11.dp)
            else Text(num, color = Ink.Faint, fontSize = 10.sp)
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Ink.Text.copy(0.92f), fontSize = 12.5.sp)
            Text(sub, color = Ink.Faint, fontSize = 10.sp, lineHeight = 14.sp)
        }
        if (!done) Text("Grant", color = Ink.Mint, fontSize = 10.5.sp)
    }
}

@Composable
private fun ModelCard(cfg: IveConfig, onSave: (IveConfig) -> Unit) {
    var key by remember { mutableStateOf("") }
    var test by remember { mutableStateOf<TestState>(TestState.Idle) }
    val scope = rememberCoroutineScope()

    Card {
        Text("MODEL", color = Ink.Faint, fontSize = 9.sp, letterSpacing = 1.6.sp)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf("openai" to "OpenAI", "anthropic" to "Anthropic", "ollama" to "Local").forEach { (id, label) ->
                val active = cfg.provider == id
                Box(
                    Modifier
                        .weight(1f)
                        .height(34.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (active) Ink.Mint.copy(0.14f) else Color(0x11FFFFFF))
                        .border(1.dp, if (active) Ink.Mint.copy(0.4f) else Color.Transparent, RoundedCornerShape(10.dp))
                        .clickable {
                            onSave(cfg.copy(provider = id, model = Config.defaultModelFor(id), baseUrl = ""))
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Text(label, color = if (active) Ink.Mint else Ink.Muted, fontSize = 11.5.sp)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        InputRow("model", cfg.model, keyboard = KeyboardType.Text) { onSave(cfg.copy(model = it)) }
        Spacer(Modifier.height(8.dp))
        InputRow(
            "api key",
            key,
            placeholder = if (cfg.hasKey) "•••••••• saved" else "sk-…",
            password = true,
            keyboard = KeyboardType.Password
        ) { key = it }
        Spacer(Modifier.height(8.dp))
        InputRow("base url", cfg.baseUrl, placeholder = "default", keyboard = KeyboardType.Uri) {
            onSave(cfg.copy(baseUrl = it))
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            PrimaryButton(
                text = when (test) {
                    TestState.Idle -> "Test & save"
                    TestState.Running -> "Testing…"
                    is TestState.Ok -> "Connected"
                    is TestState.Fail -> "Try again"
                },
                enabled = test != TestState.Running && key.isNotBlank()
            ) {
                scope.launch {
                    test = TestState.Running
                    Config.setApiKey(key)
                    val result = withContext(Dispatchers.IO) {
                        runCatching { Provider.test(NotchState.config, key) }
                    }
                    test = result.fold(
                        onSuccess = { TestState.Ok(it.take(60)) },
                        onFailure = { TestState.Fail(it.message ?: "Failed") }
                    )
                    if (result.isSuccess) {
                        onSave(NotchState.config.copy(onboardingDone = NotchState.config.onboardingDone))
                        NotchState.addLog(
                            ai.ive.app.core.LogEntry("Model connected. I'm ready.", LogKind.System)
                        )
                    }
                    delay(2500)
                    if (test is TestState.Ok) test = TestState.Idle
                }
            }
            Spacer(Modifier.width(10.dp))
            when (val t = test) {
                is TestState.Ok -> Text(t.detail, color = Ink.Mint, fontSize = 9.5.sp, maxLines = 1)
                is TestState.Fail -> Text(t.message, color = Ink.Danger, fontSize = 9.5.sp, maxLines = 2)
                else -> Text("Uses your own key.", color = Ink.Faint, fontSize = 9.5.sp)
            }
        }
    }
}

sealed interface TestState {
    data object Idle : TestState
    data object Running : TestState
    data class Ok(val detail: String) : TestState
    data class Fail(val message: String) : TestState
}

@Composable
private fun BehaviourCard(cfg: IveConfig, onSave: (IveConfig) -> Unit) {
    Card {
        Text("BEHAVIOUR", color = Ink.Faint, fontSize = 9.sp, letterSpacing = 1.6.sp)
        Spacer(Modifier.height(6.dp))
        SwitchRow("Read files without asking", cfg.autoApproveReads) { onSave(cfg.copy(autoApproveReads = it)) }
        SwitchRow("Edit files without asking", cfg.autoApproveWrites) { onSave(cfg.copy(autoApproveWrites = it)) }
        SwitchRow("Stay silent while working", cfg.silent) { onSave(cfg.copy(silent = it)) }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(38.dp)
            .clickable { onChange(!checked) },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Ink.Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
        Box(
            Modifier
                .width(38.dp)
                .height(22.dp)
                .clip(CircleShape)
                .background(if (checked) Ink.Mint.copy(0.85f) else Color(0x1AFFFFFF))
        ) {
            Box(
                Modifier
                    .align(if (checked) Alignment.CenterEnd else Alignment.CenterStart)
                    .padding(horizontal = 2.dp)
                    .size(18.dp)
                    .background(if (checked) Color(0xFF07130E) else Ink.Faint, CircleShape)
            )
        }
    }
}

@Composable
private fun AboutCard() {
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("IVE for Android", color = Ink.Text, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f))
            Text("1.0.0", color = Ink.Faint, fontSize = 11.sp, fontFamily = ai.ive.app.ui.Mono)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Your key, your device, your files. Nothing is proxied. IVE writes only inside its own storage and Downloads.",
            color = Ink.Faint,
            fontSize = 10.5.sp,
            lineHeight = 15.sp
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SmallButton("Source", ghost = true) {
                val i = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/srijan7815-bit/ive"))
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivitySafely(i)
            }
            SmallButton("macOS & Windows", ghost = true) {
                val i = Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://github.com/srijan7815-bit/ive/releases"))
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivitySafely(i)
            }
        }
    }
}

private fun startActivitySafely(intent: Intent) {
    runCatching { ai.ive.app.IveRuntime.context().startActivity(intent) }
}

@Composable
private fun InputRow(
    label: String,
    value: String,
    placeholder: String = "",
    password: Boolean = false,
    keyboard: KeyboardType = KeyboardType.Text,
    onChange: (String) -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(38.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0x10FFFFFF))
            .padding(horizontal = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = Ink.Faint, fontSize = 10.sp, modifier = Modifier.width(58.dp))
        Box(Modifier.weight(1f)) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                Text(placeholder, color = Ink.Faint.copy(0.7f), fontSize = 11.5.sp)
            }
            BasicTextField(
                value = value,
                onValueChange = onChange,
                textStyle = TextStyle(color = Ink.Text, fontSize = 11.5.sp),
                cursorBrush = SolidColor(Ink.Mint),
                singleLine = true,
                visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier
            .height(38.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(if (enabled) Ink.Mint else Color(0x1AFFFFFF))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text,
            color = if (enabled) Color(0xFF04120C) else Ink.Faint,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun SmallButton(text: String, ghost: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier
            .height(30.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(if (ghost) Color(0x12FFFFFF) else Ink.Mint.copy(0.9f))
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text,
            color = if (ghost) Ink.Muted else Color(0xFF04120C),
            fontSize = 10.5.sp,
            fontWeight = FontWeight.Medium
        )
    }
}
