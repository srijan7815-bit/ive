package ai.ive.app

import ai.ive.app.ai.Agent
import ai.ive.app.ai.Tools
import ai.ive.app.core.AskAnswer
import ai.ive.app.core.AskOption
import ai.ive.app.core.LogEntry
import ai.ive.app.core.LogKind
import ai.ive.app.core.NotchState
import ai.ive.app.core.NotchView
import ai.ive.app.data.Config
import ai.ive.app.sys.MediaHub
import ai.ive.app.sys.NotifHub
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/**
 * Single wiring point: tools ↔ agent ↔ notch state ↔ system services.
 * Kept deliberately boring so the service and the activity see identical state.
 */
object IveRuntime {
    private var app: Context? = null
    lateinit var agent: Agent
        private set
    private var toolsRef: Tools? = null

    fun init(context: Context) {
        if (app != null) return
        app = context.applicationContext
        NotchState.config = Config.load()

        val tools = Tools(app!!, object : Tools.Callbacks {
            override fun notifyUser(title: String, body: String) = notify(title, body)
            override suspend fun requestChoice(
                title: String,
                body: String,
                detail: String,
                options: List<AskOption>
            ): AskAnswer {
                return agent.requestChoice(title, body, detail, options)
            }
        })
        toolsRef = tools
        agent = Agent(
            configProvider = { NotchState.config },
            apiKeyProvider = { Config.apiKey() },
            tools = tools
        )
    }

    fun context(): Context = app ?: throw IllegalStateException("IveRuntime not initialised")

    fun submit(text: String) {
        if (!::agent.isInitialized) return
        NotchState.view = NotchView.Panel
        agent.ask(text)
    }

    fun stop() {
        if (::agent.isInitialized) agent.cancel()
    }

    fun resetAll() {
        if (::agent.isInitialized) agent.reset()
    }

    fun answer(opt: AskOption) {
        val id = NotchState.ask?.first
        if (id == null) {
            NotchState.view = NotchView.Collapsed
            return
        }
        NotchState.view = NotchView.Panel
        agent.respond(id, opt.id, opt.label)
    }

    fun dismissAsk() {
        val pending = NotchState.ask
        NotchState.ask = null
        NotchState.view = NotchView.Collapsed
        if (pending != null) agent.respond(pending.first, "dismiss", "Dismissed")
    }

    fun media(action: String) {
        when (action) {
            "playpause", "toggle" -> MediaHub.playPause()
            "next" -> MediaHub.next()
            "previous" -> MediaHub.previous()
            else -> MediaHub.control(action)
        }
    }

    fun seek(ms: Long) = MediaHub.seek(ms)

    fun notify(title: String, body: String) {
        val ctx = app ?: return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(ctx, IveApp.CHANNEL_ALERTS)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(System.currentTimeMillis().toInt() and 0xFFFF, n) }
    }

    fun log(text: String, kind: LogKind = LogKind.System) = NotchState.addLog(LogEntry(text, kind))

    /* ------------------------------- permissions ------------------------------ */

    fun hasOverlay(): Boolean =
        app?.let { Settings.canDrawOverlays(it) } ?: false

    fun hasNotifAccess(): Boolean = app?.let { NotifHub.isPermissionGranted(it) } ?: false

    fun batteryExempt(): Boolean {
        val ctx = app ?: return false
        val pm = ctx.getSystemService(PowerManager::class.java) ?: return false
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    fun requestOverlay() {
        val ctx = app ?: return
        if (!Settings.canDrawOverlays(ctx)) {
            runCatching {
                ctx.startActivity(
                    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }
    }

    fun requestNotifAccess() {
        val ctx = app ?: return
        runCatching {
            ctx.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    fun requestBatteryExempt() {
        val ctx = app ?: return
        runCatching {
            ctx.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    fun openSettings() {
        val ctx = app ?: return
        ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun startNotch() {
        val ctx = app ?: return
        if (!hasOverlay()) return
        val i = Intent(ctx, ai.ive.app.overlay.NotchService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stopNotch() {
        val ctx = app ?: return
        ctx.stopService(Intent(ctx, ai.ive.app.overlay.NotchService::class.java))
    }

    fun clearNotifications() {
        val ctx = app ?: return
        NotifHub.dismissAll()
    }

    fun tools(): Tools? = toolsRef
}
