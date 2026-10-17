package ai.ive.app.core

import ai.ive.app.data.IveConfig
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class NotchView { Collapsed, Panel, Composer, Alert }
enum class NotchTab { Assistant, Music, Settings }

data class AskOption(val id: String, val label: String, val style: String = "ghost")
data class AskAnswer(val id: String, val label: String)

enum class LogKind { User, Assistant, Tool, Error, System }

data class LogEntry(
    val text: String,
    val kind: LogKind,
    val ts: Long = System.currentTimeMillis()
)

data class MusicState(
    val playing: Boolean = false,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val packageName: String = "",
    val available: Boolean = false
) {
    val hasTrack: Boolean get() = title.isNotEmpty()
}

/** A single observable store shared by the overlay service and the main activity. */
object NotchState {
    var view by mutableStateOf(NotchView.Collapsed)
    var tab by mutableStateOf(NotchTab.Assistant)
    var working by mutableStateOf(false)
    var status by mutableStateOf("quiet")
    var config by mutableStateOf(IveConfig())
    var music by mutableStateOf(MusicState())
    var ask by mutableStateOf<Pair<String, PendingAsk>?>(null)
    var composerOpen by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)

    val log = mutableStateListOf<LogEntry>()

    init {
        log.add(LogEntry("I work from the notch. Long-press to write, and get back to your day.", LogKind.System))
    }

    fun addLog(entry: LogEntry, cap: Int = 200) {
        log.add(entry)
        while (log.size > cap) log.removeAt(0)
    }

    fun reset() {
        log.clear()
        log.add(LogEntry("Conversation reset.", LogKind.System))
        ask = null
        working = false
        status = "quiet"
    }
}

data class PendingAsk(
    val title: String,
    val body: String,
    val detail: String,
    val options: List<AskOption>,
    val kind: String = "question"
)
