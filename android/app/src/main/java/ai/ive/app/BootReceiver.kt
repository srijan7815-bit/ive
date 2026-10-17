package ai.ive.app

import ai.ive.app.data.Config
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Brings the notch back after a reboot — only if the user had it on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return
        Config.init(context)
        IveRuntime.init(context)
        val cfg = Config.load()
        if (cfg.onboardingDone && cfg.notchEnabled && IveRuntime.hasOverlay()) {
            IveRuntime.startNotch()
        }
    }
}
