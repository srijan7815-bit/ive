package ai.ive.app.overlay

import ai.ive.app.IveApp
import ai.ive.app.IveRuntime
import ai.ive.app.R
import ai.ive.app.core.NotchView
import ai.ive.app.core.NotchState
import ai.ive.app.ui.IveTheme
import ai.ive.app.ui.NotchSurface
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner

/**
 * The overlay host.
 *
 * One WRAP_CONTENT window sits at the top of the screen. Compose animates the
 * surface's own size, so the window grows with the notch — no per-frame
 * WindowManager calls, no second window, and the space around it stays
 * transparent and touch-through.
 */
class NotchService : Service(), LifecycleOwner, ViewModelStoreOwner, SavedStateRegistryOwner {

    private lateinit var lifecycleRegistry: LifecycleRegistry
    private lateinit var savedStateController: SavedStateRegistryController
    private val store = ViewModelStore()
    private lateinit var windowManager: WindowManager
    private lateinit var params: WindowManager.LayoutParams
    private var root: OverlayRoot? = null
    private var keyboardFocus = false

    override val lifecycle: Lifecycle get() = lifecycleRegistry
    override val viewModelStore: ViewModelStore get() = store
    override val savedStateRegistry: SavedStateRegistry get() = savedStateController.savedStateRegistry

    override fun onCreate() {
        super.onCreate()
        running = true
        lifecycleRegistry = LifecycleRegistry(this)
        savedStateController = SavedStateRegistryController.create(this)
        savedStateController.performRestore(null)
        savedStateController.performAttach()
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)

        IveRuntime.init(this)
        startInForeground()
        attachOverlay()

        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        ai.ive.app.sys.MediaHub.attach(this)
        ai.ive.app.sys.MediaHub.startPolling()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_ADJUST) {
            root?.let { windowManager.updateViewLayout(it, params) }
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Re-apply so the overlay follows rotation and cutout changes.
        root?.let { runCatching { windowManager.updateViewLayout(it, params) } }
    }

    private fun attachOverlay() {
        if (root != null) return
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            x = 0
            y = 0
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                setFitInsetsTypes(0)
            }
        }

        val container = OverlayRoot(this).apply {
            onOutside = {
                if (!this@NotchService.keyboardFocus && NotchState.view != NotchView.Collapsed) {
                    NotchState.view = NotchView.Collapsed
                }
            }
        }
        val compose = ComposeView(this).apply {
            Owners.attach(this, this@NotchService, this@NotchService, this@NotchService)
            setContent {
                IveTheme {
                    NotchSurface(focusSink = { wantsFocus(it) })
                }
            }
        }
        container.addView(
            compose,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT
            )
        )
        root = container
        runCatching { windowManager.addView(container, params) }
    }

    /** Compose asks for keyboard focus when a text field is touched. */
    private fun wantsFocus(needs: Boolean) {
        if (needs == keyboardFocus) return
        keyboardFocus = needs
        params.flags = if (needs) {
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
        } else {
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
        }
        root?.let {
            runCatching { windowManager.updateViewLayout(it, params) }
            if (needs) {
                it.postDelayed({
                    it.requestFocus()
                    val ime = getSystemService(InputMethodManager::class.java)
                    ime?.showSoftInput(it, InputMethodManager.SHOW_IMPLICIT)
                }, 120)
            } else {
                val ime = getSystemService(InputMethodManager::class.java)
                ime?.hideSoftInputFromWindow(it.windowToken, 0)
            }
        }
    }

    private fun startInForeground() {
        val open = PendingIntent.getActivity(
            this, 1,
            Intent(this, ai.ive.app.MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 2,
            Intent(this, NotchService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n: Notification = Notification.Builder(this, IveApp.CHANNEL_NOTCH)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(getString(R.string.notch_running))
            .setContentText(getString(R.string.notch_running_body))
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Hide notch", stop).build())
            .setOngoing(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
        startForeground(IveApp.NOTIF_ID, n)
    }

    override fun onDestroy() {
        running = false
        root?.let { runCatching { windowManager.removeView(it) } }
        root = null
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        store.clear()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Root that turns an outside tap into "fold the notch". */
    private class OverlayRoot(context: Context) : FrameLayout(context) {
        var onOutside: (() -> Unit)? = null

        override fun onTouchEvent(event: MotionEvent): Boolean {
            if (event.action == MotionEvent.ACTION_OUTSIDE) {
                onOutside?.invoke()
                return true
            }
            return super.onTouchEvent(event)
        }
    }

    companion object {
        const val ACTION_STOP = "ai.ive.app.action.STOP_NOTCH"
        const val ACTION_ADJUST = "ai.ive.app.action.ADJUST"

        @Volatile
        var running: Boolean = false
            private set
    }
}
