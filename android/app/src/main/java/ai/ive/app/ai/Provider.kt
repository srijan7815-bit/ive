package ai.ive.app.ai

import ai.ive.app.data.IveConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ToolCall(val id: String, val name: String, val args: JSONObject)

data class ChatResult(
    val text: String,
    val toolCalls: List<ToolCall>,
    val stopReason: String?
)

class ProviderException(message: String, val status: Int = 0) : Exception(message)

/**
 * IVE — model providers.
 * Canonical history is a list of JSON objects in OpenAI shape; Anthropic is
 * adapted at the edge. Same contract as the desktop app.
 */
class Provider(private val cfg: IveConfig, private val apiKey: String) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    fun chat(system: String, messages: List<JSONObject>, tools: JSONArray): ChatResult {
        return if (cfg.provider == "anthropic") anthropic(system, messages, tools)
        else openAiCompatible(system, messages, tools)
    }

    private fun post(path: String, body: JSONObject, headers: Map<String, String>): JSONObject {
        val builder = Request.Builder().url(path).post(body.toString().toRequestBody(json))
        headers.forEach { (k, v) -> builder.header(k, v) }
        try {
            http.newCall(builder.build()).execute().use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val msg = try {
                        JSONObject(text).optJSONObject("error")?.optString("message")
                    } catch (e: Exception) { null }
                    throw ProviderException(msg ?: "HTTP ${res.code}", res.code)
                }
                return JSONObject(text)
            }
        } catch (e: ProviderException) {
            throw e
        } catch (e: IOException) {
            throw ProviderException("Could not reach the model: ${e.message}")
        } catch (e: Exception) {
            throw ProviderException("Bad response: ${e.message}")
        }
    }

    /* ------------------------------ OpenAI ------------------------------- */

    private fun openAiCompatible(system: String, messages: List<JSONObject>, tools: JSONArray): ChatResult {
        val wire = JSONArray()
        wire.put(JSONObject().put("role", "system").put("content", system))
        messages.forEach { m ->
            if (m.optString("role") == "tool") {
                wire.put(JSONObject().put("role", "tool").put("tool_call_id", m.optString("tool_call_id")).put("content", m.optString("content")))
            } else if (m.optString("role") == "assistant") {
                val o = JSONObject().put("role", "assistant").put("content", m.optString("content"))
                m.optJSONArray("tool_calls")?.let { o.put("tool_calls", it) }
                wire.put(o)
            } else {
                wire.put(JSONObject().put("role", "user").put("content", m.optString("content")))
            }
        }
        val body = JSONObject()
            .put("model", cfg.model)
            .put("messages", wire)
            .put("max_tokens", 4096)
            .put("temperature", 0.4)
        if (tools.length() > 0) {
            body.put("tools", tools)
            body.put("tool_choice", "auto")
        }

        val host = cfg.endpoint().trimEnd('/')
        val headers = mutableMapOf("Authorization" to "Bearer ${apiKey.ifBlank { "ollama" }}")
        if (cfg.baseUrl.contains("/api/openai", ignoreCase = true) || host.contains("openrouter")) {
            headers["HTTP-Referer"] = "https://github.com/srijan7815-bit/ive"
            headers["X-Title"] = "IVE"
        }
        val res = post("$host/chat/completions", body, headers)
        val choice = res.optJSONArray("choices")?.optJSONObject(0)
            ?: throw ProviderException("The model returned an empty response.")
        val msg = choice.optJSONObject("message") ?: JSONObject()
        val calls = mutableListOf<ToolCall>()
        msg.optJSONArray("tool_calls")?.let { arr ->
            for (i in 0 until arr.length()) {
                val c = arr.optJSONObject(i) ?: continue
                val fn = c.optJSONObject("function") ?: continue
                val args = try { JSONObject(fn.optString("arguments", "{}")) } catch (e: Exception) { JSONObject() }
                calls += ToolCall(c.optString("id", "call_$i"), fn.optString("name"), args)
            }
        }
        return ChatResult(msg.optString("content", ""), calls, choice.optString("finish_reason"))
    }

    /* ----------------------------- Anthropic ----------------------------- */

    private fun anthropic(system: String, messages: List<JSONObject>, tools: JSONArray): ChatResult {
        val wire = JSONArray()
        val pendingToolResults = JSONArray()
        fun flush() {
            if (pendingToolResults.length() > 0) {
                wire.put(JSONObject().put("role", "user").put("content", JSONArray().also { target ->
                    for (i in 0 until pendingToolResults.length()) target.put(pendingToolResults.get(i))
                }))
                while (pendingToolResults.length() > 0) pendingToolResults.remove(0)
            }
        }

        messages.forEach { m ->
            when (m.optString("role")) {
                "tool" -> pendingToolResults.put(
                    JSONObject()
                        .put("type", "tool_result")
                        .put("tool_use_id", m.optString("tool_call_id"))
                        .put("content", m.optString("content").take(40_000))
                )
                "assistant" -> {
                    flush()
                    val blocks = JSONArray()
                    if (m.optString("content").isNotEmpty()) {
                        blocks.put(JSONObject().put("type", "text").put("text", m.optString("content")))
                    }
                    m.optJSONArray("tool_calls")?.let { arr ->
                        for (i in 0 until arr.length()) {
                            val c = arr.optJSONObject(i) ?: continue
                            val fn = c.optJSONObject("function") ?: continue
                            val input = try { JSONObject(fn.optString("arguments", "{}")) } catch (e: Exception) { JSONObject() }
                            blocks.put(JSONObject().put("type", "tool_use").put("id", c.optString("id")).put("name", fn.optString("name")).put("input", input))
                        }
                    }
                    if (blocks.length() > 0) wire.put(JSONObject().put("role", "assistant").put("content", blocks))
                }
                else -> {
                    flush()
                    wire.put(JSONObject().put("role", "user").put("content", m.optString("content")))
                }
            }
        }
        flush()

        val body = JSONObject()
            .put("model", cfg.model)
            .put("max_tokens", 4096)
            .put("system", system)
            .put("messages", wire)
        if (tools.length() > 0) {
            val mapped = JSONArray()
            for (i in 0 until tools.length()) {
                val t = tools.optJSONObject(i) ?: continue
                val fn = t.optJSONObject("function") ?: continue
                mapped.put(
                    JSONObject()
                        .put("name", fn.optString("name"))
                        .put("description", fn.optString("description"))
                        .put("input_schema", fn.optJSONObject("parameters") ?: JSONObject().put("type", "object"))
                )
            }
            body.put("tools", mapped)
        }

        val res = post(
            cfg.endpoint().trimEnd('/') + "/v1/messages",
            body,
            mapOf("x-api-key" to apiKey, "anthropic-version" to "2023-06-01")
        )
        val blocks = res.optJSONArray("content") ?: JSONArray()
        val text = StringBuilder()
        val calls = mutableListOf<ToolCall>()
        for (i in 0 until blocks.length()) {
            val b = blocks.optJSONObject(i) ?: continue
            when (b.optString("type")) {
                "text" -> text.append(b.optString("text"))
                "tool_use" -> calls += ToolCall(b.optString("id"), b.optString("name"), b.optJSONObject("input") ?: JSONObject())
            }
        }
        return ChatResult(text.toString().trim(), calls, res.optString("stop_reason"))
    }

    companion object {
        fun test(cfg: IveConfig, apiKey: String): String {
            val p = Provider(cfg, apiKey)
            val r = p.chat("Reply with exactly: IVE-OK", listOf(JSONObject().put("role", "user").put("content", "ping")), JSONArray())
            return r.text.ifBlank { "(empty)" }
        }
    }
}
