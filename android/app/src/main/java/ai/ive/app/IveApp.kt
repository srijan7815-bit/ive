package ai.ive.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import ai.ive.app.data.Config
import ai.ive.app.data.History

class IveApp : Application() {

    override fun onCreate() {
        super.onCreate()
        Config.init(this)
        History.init(this)
        IveRuntime.init(this)
        createChannels()
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return

        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_NOTCH,
                getString(R.string.notch_channel),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notch_channel_desc)
                setShowBadge(false)
                enableVibration(false)
            }
        )

        nm.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ALERTS,
                "IVE alerts",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "When IVE needs a decision." }
        )
    }

    companion object {
        const val CHANNEL_NOTCH = "ive_notch"
        const val CHANNEL_ALERTS = "ive_alerts"
        const val NOTIF_ID = 41
    }
}
