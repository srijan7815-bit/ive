package ai.ive.app.ai

import ai.ive.app.core.AskAnswer
import ai.ive.app.core.AskOption
import ai.ive.app.sys.MediaHub
import ai.ive.app.sys.NotifHub
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class ToolDef(
    val name: String,
    val description: String,
    val schema: JSONObject,
    val risk: String,
    val run: suspend (JSONObject) -> String
)

/** Android tool belt. Deliberately smaller than desktop: only what a phone can do safely. */
class Tools(private val context: Context, private val callbacks: Callbacks) {

    interface Callbacks {
        fun notifyUser(title: String, body: String)
        suspend fun requestChoice(title: String, body: String, detail: String, options: List<AskOption>): AskAnswer
    }

    private val allowedRoots: List<File> by lazy {
        listOfNotNull(
            context.filesDir,
            context.cacheDir,
            context.getExternalFilesDir(null),
            File("/sdcard/Download")
        )
    }

    private fun resolve(path: String): File {
        val f = if (path.startsWith("~/")) File(context.filesDir, path.removePrefix("~/")) else File(path)
        val canonical = f.canonicalFile
        val ok = allowedRoots.any { root ->
            canonical.path == root.canonicalPath || canonical.path.startsWith(root.canonicalPath + File.separator)
        }
        if (!ok) throw SecurityException("Writes are fenced to IVE's files and Downloads. $canonical is outside.")
        return canonical
    }

    val schemas: JSONArray by lazy {
        JSONArray().also { arr -> defs.forEach { arr.put(it.schema) } }
    }

    private val defs: List<ToolDef> = listOf(
        ToolDef(
            "device_info",
            "Android version, device model, battery, and current app state.",
            schema("device_info", "Get device information.", JSONObject()),
            "read"
        ) {
            val pm = context.packageManager
            val bm = context.getSystemService(android.os.BatteryManager::class.java)
            JSONObject()
                .put("android", android.os.Build.VERSION.RELEASE)
                .put("sdk", android.os.Build.VERSION.SDK_INT)
                .put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                .put("app", context.packageName)
                .put("battery", bm?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1)
                .put("files_dir", context.filesDir.absolutePath)
                .put("notifications_access", NotifHub.connected)
                .toString(2)
        },
        ToolDef(
            "list_files",
            "List a folder inside IVE's storage or Downloads.",
            schema("list_files", "List a directory.", props("path" to "string")),
            "read"
        ) { args ->
            val dir = resolve(args.optString("path", context.filesDir.absolutePath))
            if (!dir.exists()) "No such folder: ${dir.absolutePath}"
            else dir.listFiles()?.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
                ?.joinToString("\n") { f ->
                    val kind = if (f.isDirectory) "dir " else "file"
                    "$kind ${f.length().toString().padStart(9)}  ${f.name}"
                }?.ifBlank { "(empty)" } ?: "(empty)"
        },
        ToolDef(
            "read_file",
            "Read a text file (max 40k chars) from IVE's storage or Downloads.",
            schema("read_file", "Read a text file.", props("path" to "string"), required = listOf("path")),
            "read"
        ) { args ->
            val f = resolve(args.getString("path"))
            if (!f.exists()) "File not found: ${f.absolutePath}"
            else f.readText().take(40_000) + if (f.length() > 40_000) "\n… truncated" else ""
        },
        ToolDef(
            "write_file",
            "Create or overwrite a text file inside IVE's storage or Downloads.",
            schema("write_file", "Write a text file.", props("path" to "string", "content" to "string", "append" to "boolean"), listOf("path", "content")),
            "write"
        ) { args ->
            val f = resolve(args.getString("path"))
            f.parentFile?.mkdirs()
            if (args.optBoolean("append", false)) f.appendText(args.getString("content"))
            else f.writeText(args.getString("content"))
            "Wrote ${f.length()} bytes to ${f.absolutePath}."
        },
        ToolDef(
            "delete_path",
            "Delete a file or folder inside IVE's storage or Downloads.",
            schema("delete_path", "Delete a path.", props("path" to "string"), listOf("path")),
            "write"
        ) { args ->
            val f = resolve(args.getString("path"))
            val ok = f.deleteRecursively()
            if (ok) "Deleted ${f.absolutePath}." else "Could not delete ${f.absolutePath}."
        },
        ToolDef(
            "list_apps",
            "List installed apps that have a launcher icon.",
            schema("list_apps", "List launchable apps.", JSONObject()),
            "read"
        ) {
            val pm = context.packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            pm.queryIntentActivities(intent, 0)
                .map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
                .distinctBy { it.second }
                .sortedBy { it.first.lowercase() }
                .take(120)
                .joinToString("\n") { "${it.first} — ${it.second}" }
        },
        ToolDef(
            "open_app",
            "Open an app by name or package. Example: \"Spotify\".",
            schema("open_app", "Launch an app.", props("name" to "string"), listOf("name")),
            "automation"
        ) { args ->
            val wanted = args.getString("name").lowercase()
            val pm = context.packageManager
            val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val match = pm.queryIntentActivities(intent, 0).firstOrNull {
                it.loadLabel(pm).toString().lowercase().contains(wanted) || it.activityInfo.packageName.lowercase().contains(wanted)
            } ?: return@ToolDef "No app matching \"${args.getString("name")}\"."
            val launch = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_LAUNCHER)
                setClassName(match.activityInfo.packageName, match.activityInfo.name)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(launch)
            "Opened ${match.loadLabel(pm)}."
        },
        ToolDef(
            "open_url",
            "Open a URL in the default browser.",
            schema("open_url", "Open a URL.", props("url" to "string"), listOf("url")),
            "network"
        ) { args ->
            val url = args.getString("url")
            if (!url.startsWith("http://") && !url.startsWith("https://")) return@ToolDef "Refused: only http(s)."
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            "Opened $url"
        },
        ToolDef(
            "clipboard",
            "Read or write the clipboard.",
            schema("clipboard", "Clipboard.", props("action" to "string", "text" to "string"), listOf("action")),
            "automation"
        ) { args ->
            val cm = context.getSystemService(ClipboardManager::class.java)
            if (args.optString("action") == "read") {
                cm?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()?.take(20_000)
                    ?: "(clipboard is empty)"
            } else {
                cm?.setPrimaryClip(ClipData.newPlainText("IVE", args.optString("text")))
                "Copied ${args.optString("text").length} characters."
            }
        },
        ToolDef(
            "notifications",
            "List recent notifications (requires notification access).",
            schema("notifications", "Recent notifications.", props("limit" to "number")),
            "read"
        ) { args ->
            if (!NotifHub.connected) return@ToolDef "Notification access is off. Enable it in IVE settings."
            NotifHub.recent(args.optInt("limit", 15))
        },
        ToolDef(
            "media",
            "Read or control the system music player: status, play, pause, playpause, next, previous.",
            schema("media", "Music control.", props("action" to "string"), listOf("action")),
            "read"
        ) { args ->
            when (val a = args.optString("action", "status")) {
                "status" -> MediaHub.snapshotJson()
                else -> {
                    val ok = MediaHub.control(a)
                    if (ok) "Media: $a ✓" else "No active media session."
                }
            }
        },
        ToolDef(
            "notify",
            "Show a quiet notification the user will see later.",
            schema("notify", "Notify the user.", props("title" to "string", "body" to "string"), listOf("title")),
            "read"
        ) { args ->
            callbacks.notifyUser(args.optString("title"), args.optString("body"))
            "Notification sent."
        },
        ToolDef(
            "ask_user",
            "Ask the user a question with 2–4 options. A card opens from the notch; they can answer anytime.",
            schema(
                "ask_user", "Ask the user.",
                JSONObject()
                    .put("question", JSONObject().put("type", "string"))
                    .put("detail", JSONObject().put("type", "string"))
                    .put("options", JSONObject().put("type", "array").put("items", JSONObject().put("type", "object"))),
                listOf("question", "options")
            ),
            "read"
        ) { args ->
            val opts = args.optJSONArray("options") ?: JSONArray()
            val list = (0 until opts.length()).mapNotNull { i ->
                val o = opts.optJSONObject(i) ?: return@mapNotNull null
                AskOption(o.optString("id", "opt$i"), o.optString("label", "Option $i"), o.optString("style", if (i == 0) "primary" else "ghost"))
            }.take(4)
            if (list.size < 2) return@ToolDef "ask_user needs 2–4 options."
            val answer = callbacks.requestChoice("A question for you", args.optString("question"), args.optString("detail"), list)
            "The user answered: ${answer.label} (${answer.id})."
        },
        ToolDef(
            "web_fetch",
            "Fetch a web page and return readable text.",
            schema("web_fetch", "Fetch a URL.", props("url" to "string"), listOf("url")),
            "network"
        ) { args ->
            val url = args.getString("url")
            if (!url.startsWith("http")) return@ToolDef "Refused: only http(s)."
            try {
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15_000
                    readTimeout = 20_000
                    setRequestProperty("User-Agent", "IVE/1.0 (Android)")
                }
                val body = conn.inputStream.bufferedReader().readText()
                body.replace(Regex("<script[\\s\\S]*?</script>"), " ")
                    .replace(Regex("<style[\\s\\S]*?</style>"), " ")
                    .replace(Regex("<[^>]+>"), " ")
                    .replace(Regex("\\s+"), " ")
                    .trim()
                    .take(20_000)
            } catch (e: Exception) {
                "Fetch failed: ${e.message}"
            }
        }
    )

    private fun schema(name: String, desc: String, props: JSONObject, required: List<String> = emptyList()): JSONObject {
        val fn = JSONObject()
            .put("name", name)
            .put("description", desc)
            .put("parameters", JSONObject().put("type", "object").put("properties", props).put("required", JSONArray(required)))
        return JSONObject().put("type", "function").put("function", fn)
    }

    private fun props(vararg pairs: Pair<String, String>): JSONObject =
        JSONObject().also { o -> pairs.forEach { (k, v) -> o.put(k, JSONObject().put("type", v)) } }

    fun find(name: String): ToolDef? = defs.firstOrNull { it.name == name }
}
