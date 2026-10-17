package ai.ive.app.ai

import ai.ive.app.core.AskAnswer
import ai.ive.app.core.AskOption
import ai.ive.app.core.LogEntry
import ai.ive.app.core.LogKind
import ai.ive.app.core.NotchState
import ai.ive.app.data.History
import ai.ive.app.data.IveConfig
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * IVE — agent loop (Android).
 * Same shape as the desktop agent: think → call tools → ask when needed →
 * file a one-line result in the notch log.
 */
class Agent(
    private val configProvider: () -> IveConfig,
    private val apiKeyProvider: () -> String,
    private val tools: Tools
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private val messages: MutableList<JSONObject> = History.load()
    private var pending: CompletableDeferred<AskAnswer>? = null

    val isBusy: Boolean get() = job?.isActive == true

    fun cancel() {
        job?.cancel()
        job = null
        pending?.cancel()
        pending = null
        NotchState.working = false
        NotchState.status = "quiet"
        NotchState.addLog(LogEntry("Stopped.", LogKind.System))
    }

    fun reset() {
        messages.clear()
        History.clear()
        NotchState.reset()
    }

    fun ask(text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        if (isBusy) {
            NotchState.addLog(LogEntry("Still working — I'll get to that next.", LogKind.System))
            return
        }
        NotchState.addLog(LogEntry(clean, LogKind.User))
        job = scope.launch { runTurn(clean) }
    }

    fun respond(id: String, optionId: String, label: String) {
        val p = pending
        if (p != null && !p.isCompleted) p.complete(AskAnswer(optionId, label))
        pending = null
        NotchState.ask = null
    }

    suspend fun requestChoice(title: String, body: String, detail: String, options: List<AskOption>): AskAnswer {
        val deferred = CompletableDeferred<AskAnswer>()
        pending = deferred
        NotchState.ask = UUID.randomUUID().toString() to ai.ive.app.core.PendingAsk(title, body, detail, options)
        NotchState.view = ai.ive.app.core.NotchView.Alert
        return deferred.await()
    }

    private suspend fun runTurn(input: String) {
        val cfg = configProvider()
        val key = apiKeyProvider()
        if (key.isBlank() && cfg.provider != "ollama") {
            NotchState.addLog(LogEntry("Add a model key in Settings to start.", LogKind.Error))
            NotchState.working = false
            return
        }
        NotchState.working = true
        NotchState.status = "thinking"
        val provider = Provider(cfg, key)
        messages.add(JSONObject().put("role", "user").put("content", input))

        try {
            var answer = ""
            for (step in 0 until 12) {
                val res = provider.chat(systemPrompt(cfg), messages, tools.schemas)
                if (res.toolCalls.isEmpty()) {
                    answer = res.text.ifBlank { "Done." }
                    messages.add(JSONObject().put("role", "assistant").put("content", answer))
                    break
                }
                val callArr = JSONArray()
                res.toolCalls.forEach { c ->
                    callArr.put(
                        JSONObject().put("id", c.id).put("type", "function")
                            .put("function", JSONObject().put("name", c.name).put("arguments", c.args.toString()))
                    )
                }
                messages.add(JSONObject().put("role", "assistant").put("content", res.text).put("tool_calls", callArr))

                for (call in res.toolCalls) {
                    NotchState.status = labelFor(call.name)
                    val result = withContext(Dispatchers.IO) { execute(call, cfg) }
                    messages.add(
                        JSONObject().put("role", "tool").put("tool_call_id", call.id)
                            .put("content", result.take(40_000))
                    )
                    NotchState.addLog(LogEntry("${call.name} · ${if (result.startsWith("Blocked") || result.contains("Refused")) "blocked" else "ok"}", LogKind.Tool))
                }
            }
            if (answer.isBlank()) answer = "I ran out of steps before finishing."
            NotchState.addLog(LogEntry(answer, LogKind.Assistant))
        } catch (e: Exception) {
            val msg = e.message ?: "Something went wrong."
            if (msg.contains("cancel", ignoreCase = true) || e is kotlinx.coroutines.CancellationException) {
                NotchState.addLog(LogEntry("Stopped.", LogKind.System))
            } else {
                NotchState.addLog(LogEntry(msg, LogKind.Error))
            }
        } finally {
            NotchState.working = false
            NotchState.status = "quiet"
            if (messages.size > 80) {
                val trimmed = messages.takeLast(60).toMutableList()
                messages.clear()
                messages.addAll(trimmed)
            }
            History.save(messages)
            delay(120)
        }
    }

    private suspend fun execute(call: ToolCall, cfg: IveConfig): String {
        val tool = tools.find(call.name) ?: return "Unknown tool: ${call.name}"
        val auto = when (tool.risk) {
            "read" -> cfg.autoApproveReads
            "write" -> cfg.autoApproveWrites
            "automation" -> false
            "network" -> true
            else -> false
        }
        if (!auto) {
            val answer = requestChoice(
                "Permission",
                "Run ${call.name.replace('_', ' ')}?",
                call.args.toString(2).take(600),
                listOf(
                    AskOption("allow", "Allow once", "primary"),
                    AskOption("deny", "Deny", "danger")
                )
            )
            val denied = answer.id == "deny" || answer.id == "timeout"
            NotchState.view = ai.ive.app.core.NotchView.Panel
            if (denied) return "The user denied this action."
        }
        return try {
            tool.run(call.args)
        } catch (e: SecurityException) {
            "Refused: ${e.message}"
        } catch (e: Exception) {
            "${call.name} failed: ${e.message}"
        }
    }

    private fun labelFor(name: String) = when (name) {
        "list_files", "read_file" -> "reading"
        "write_file", "delete_path" -> "writing"
        "open_app" -> "switching apps"
        "media" -> "music"
        "web_fetch" -> "browsing"
        "ask_user" -> "waiting on you"
        else -> name.replace('_', ' ')
    }

    private fun systemPrompt(cfg: IveConfig): String = buildString {
        appendLine("You are IVE — a quiet, capable assistant living in a small notch at the top of this Android phone.")
        appendLine("The user long-presses the notch, types a thought, and returns to what they were doing. You work in the background.")
        appendLine()
        appendLine("Device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}, Android ${android.os.Build.VERSION.RELEASE} (SDK ${android.os.Build.VERSION.SDK_INT}).")
        appendLine("Model: ${cfg.model} via ${cfg.provider}.")
        appendLine()
        appendLine("Rules:")
        appendLine("- Do the work with tools instead of explaining. Prefer the file tools over guessing.")
        appendLine("- Finish with ONE plain sentence (max ~25 words). No markdown, no lists — it is shown in a tiny notch log.")
        appendLine("- Writes are fenced to IVE's own storage and Downloads. Never claim otherwise.")
        appendLine("- Ask with ask_user only when genuinely ambiguous or destructive.")
        appendLine("- Never open apps or change settings the user did not ask for.")
        appendLine("- Be brief. The user is on a phone.")
    }

    companion object {
        fun newId() = UUID.randomUUID().toString()
    }
}
