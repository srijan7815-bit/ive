package ai.ive.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Conversation persistence — internal storage, capped, never uploaded. */
object History {
    private const val MAX = 60
    private var file: File? = null

    fun init(context: Context) {
        file = File(context.filesDir, "conversation.json")
    }

    fun load(): MutableList<JSONObject> {
        val f = file ?: return mutableListOf()
        if (!f.exists()) return mutableListOf()
        return try {
            val arr = JSONArray(f.readText())
            MutableList(arr.length()) { arr.getJSONObject(it) }
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    fun save(messages: List<JSONObject>) {
        val f = file ?: return
        try {
            val arr = JSONArray()
            messages.takeLast(MAX).forEach { arr.put(it) }
            f.writeText(arr.toString())
        } catch (e: Exception) {
            // storage full — keep working in memory
        }
    }

    fun clear() {
        file?.delete()
    }
}
