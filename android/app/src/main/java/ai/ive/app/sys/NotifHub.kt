package ai.ive.app.sys

import ai.ive.app.IveApp
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Notification access powers two things: the music card (media sessions) and
 * the "what did I miss" tool. We keep only a small ring buffer in memory —
 * nothing is stored or sent anywhere on its own.
 */
object NotifHub {
    data class Entry(val pkg: String, val title: String, val body: String, val at: Long)

    @Volatile
    var connected: Boolean = false

    @Volatile
    private var service: IveNotificationListener? = null

    private val recent = mutableListOf<Entry>()

    fun bind(listener: IveNotificationListener?) {
        service = listener
        connected = listener != null
        if (listener != null) {
            MediaHub.attach(listener.applicationContext)
            MediaHub.startPolling()
        }
    }

    fun record(pkg: String, title: String, body: String, at: Long) {
        if (title.isBlank() && body.isBlank()) return
        synchronized(recent) {
            recent.add(0, Entry(pkg, title, body, at))
            while (recent.size > 40) recent.removeAt(recent.size - 1)
        }
    }

    fun recent(limit: Int): String = synchronized(recent) {
        if (recent.isEmpty()) return "No notifications yet."
        recent.take(limit).joinToString("\n") { e ->
            val ago = ((System.currentTimeMillis() - e.at) / 60_000).coerceAtLeast(0)
            "${e.title.ifBlank { e.pkg }} — ${e.body.take(140)} (${ago}m ago)"
        }
    }

    fun count(): Int = synchronized(recent) { recent.size }

    fun dismissAll() {
        service?.cancelAllNotifications()
    }

    fun isPermissionGranted(context: Context): Boolean {
        val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
        val expected = ComponentName(context, IveNotificationListener::class.java)
        return flat.split(':').any {
            val cn = ComponentName.unflattenFromString(it)
            cn != null && cn.packageName == expected.packageName && cn.className == expected.className
        }
    }

    fun channelId(): String = IveApp.CHANNEL_ALERTS
}

class IveNotificationListener : NotificationListenerService() {

    override fun onListenerConnected() {
        NotifHub.bind(this)
        MediaHub.attach(applicationContext)
    }

    override fun onListenerDisconnected() {
        NotifHub.bind(null)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn?.notification ?: return
        if (sbn.packageName == packageName) return
        val title = n.extras.getCharSequence("android.title")?.toString().orEmpty()
        val text = n.extras.getCharSequence("android.text")?.toString().orEmpty()
        NotifHub.record(sbn.packageName, title, text, sbn.postTime)
    }
}
