package ai.ive.app.data

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * IVE — settings.
 * The API key never touches plain SharedPreferences: it is AES/GCM encrypted
 * with a hardware-backed key from the Android Keystore.
 */
object Secure {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "ive_api_key"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: String): String {
        if (plain.isEmpty()) return ""
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
            val body = Base64.encodeToString(cipher.doFinal(plain.toByteArray()), Base64.NO_WRAP)
            "$iv:$body"
        } catch (e: Exception) {
            ""
        }
    }

    fun decrypt(stored: String): String {
        if (stored.isEmpty() || !stored.contains(':')) return ""
        return try {
            val (iv, body) = stored.split(':', limit = 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), javax.crypto.spec.GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(body, Base64.NO_WRAP)))
        } catch (e: Exception) {
            ""
        }
    }
}

data class IveConfig(
    val provider: String = "openai",
    val model: String = "gpt-4o",
    val baseUrl: String = "",
    val autoApproveReads: Boolean = true,
    val autoApproveWrites: Boolean = true,
    val askShell: Boolean = true,
    val silent: Boolean = true,
    val notchEnabled: Boolean = true,
    val onboardingDone: Boolean = false
) {
    val hasKey: Boolean get() = Config.apiKey().isNotEmpty()

    fun endpoint(): String = when (provider) {
        "anthropic" -> baseUrl.ifBlank { "https://api.anthropic.com" }
        "ollama" -> baseUrl.ifBlank { "http://10.0.2.2:11434/v1" }
        else -> baseUrl.ifBlank { "https://api.openai.com/v1" }
    }
}

object Config {
    private const val PREFS = "ive_config"
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    private fun raw() = if (::prefs.isInitialized) prefs else throw IllegalStateException("Config.init not called")

    fun load(): IveConfig = IveConfig(
        provider = raw().getString("provider", "openai") ?: "openai",
        model = raw().getString("model", "gpt-4o") ?: "gpt-4o",
        baseUrl = raw().getString("baseUrl", "") ?: "",
        autoApproveReads = raw().getBoolean("autoApproveReads", true),
        autoApproveWrites = raw().getBoolean("autoApproveWrites", true),
        askShell = raw().getBoolean("askShell", true),
        silent = raw().getBoolean("silent", true),
        notchEnabled = raw().getBoolean("notchEnabled", true),
        onboardingDone = raw().getBoolean("onboardingDone", false)
    )

    fun save(cfg: IveConfig) {
        raw().edit()
            .putString("provider", cfg.provider)
            .putString("model", cfg.model)
            .putString("baseUrl", cfg.baseUrl)
            .putBoolean("autoApproveReads", cfg.autoApproveReads)
            .putBoolean("autoApproveWrites", cfg.autoApproveWrites)
            .putBoolean("askShell", cfg.askShell)
            .putBoolean("silent", cfg.silent)
            .putBoolean("notchEnabled", cfg.notchEnabled)
            .putBoolean("onboardingDone", cfg.onboardingDone)
            .apply()
    }

    fun apiKey(): String = Secure.decrypt(raw().getString("apiKey", "") ?: "")

    fun setApiKey(key: String) {
        raw().edit().putString("apiKey", Secure.encrypt(key.trim())).apply()
    }

    fun defaultModelFor(provider: String): String = when (provider) {
        "anthropic" -> "claude-sonnet-4-5"
        "ollama" -> "llama3.1"
        else -> "gpt-4o"
    }

    fun defaultBaseFor(provider: String): String = when (provider) {
        "anthropic" -> "https://api.anthropic.com"
        "ollama" -> "http://10.0.2.2:11434/v1"
        else -> "https://api.openai.com/v1"
    }
}
