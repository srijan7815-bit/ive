package ai.ive.app.sys

import ai.ive.app.core.MusicState
import ai.ive.app.core.NotchState
import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Music — reads the system's active media sessions through the notification
 * listener grant, so IVE shows the same track as Spotify / YouTube Music and
 * its buttons drive the real player.
 */
object MediaHub {
    private var controller: MediaController? = null
    private var ctx: Context? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
        override fun onPlaybackStateChanged(state: PlaybackState?) = publish()
        override fun onSessionDestroyed() {
            controller = null
            NotchState.music = MusicState()
        }
    }

    fun attach(context: Context) {
        ctx = context.applicationContext
        refresh()
    }

    fun refresh() {
        val c = ctx ?: return
        val mgr = c.getSystemService(MediaSessionManager::class.java) ?: return
        try {
            val sessions = mgr.getActiveSessions(ComponentName(c, IveNotificationListener::class.java))
            val best = sessions.maxByOrNull { s ->
                when (s.playbackState?.state) {
                    PlaybackState.STATE_PLAYING -> 2
                    PlaybackState.STATE_PAUSED -> 1
                    else -> 0
                }
            }
            if (best?.sessionToken != controller?.sessionToken) {
                controller?.unregisterCallback(callback)
                controller = best
                controller?.registerCallback(callback)
            }
            publish()
        } catch (e: SecurityException) {
            // notification access not granted yet
            NotchState.music = MusicState()
        } catch (e: Exception) {
            NotchState.music = MusicState()
        }
    }

    private fun publish() {
        val c = controller
        if (c == null) {
            NotchState.music = MusicState()
            return
        }
        val md = c.metadata
        val st = c.playbackState
        NotchState.music = MusicState(
            playing = st?.state == PlaybackState.STATE_PLAYING,
            title = md?.getString(MediaMetadata.METADATA_KEY_TITLE).orEmpty(),
            artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST).orEmpty(),
            album = md?.getString(MediaMetadata.METADATA_KEY_ALBUM).orEmpty(),
            positionMs = st?.position ?: 0,
            durationMs = md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0,
            packageName = c.packageName.orEmpty(),
            available = true
        )
    }

    fun playPause() {
        val st = controller?.playbackState
        if (st?.state == PlaybackState.STATE_PLAYING) controller?.transportControls?.pause()
        else controller?.transportControls?.play()
        scope.launch { kotlinx.coroutines.delay(120); refresh() }
    }

    fun next() {
        controller?.transportControls?.skipToNext()
        scope.launch { kotlinx.coroutines.delay(250); refresh() }
    }

    fun previous() {
        controller?.transportControls?.skipToPrevious()
        scope.launch { kotlinx.coroutines.delay(250); refresh() }
    }

    fun seek(ms: Long) {
        controller?.transportControls?.seekTo(ms)
    }

    fun control(action: String): Boolean {
        if (controller == null) return false
        when (action) {
            "play" -> controller?.transportControls?.play()
            "pause" -> controller?.transportControls?.pause()
            "playpause", "toggle" -> playPause()
            "next" -> next()
            "previous", "prev" -> previous()
            "stop" -> controller?.transportControls?.stop()
            else -> return false
        }
        return true
    }

    fun snapshotJson(): String {
        val m = NotchState.music
        return JSONObject()
            .put("available", m.available)
            .put("playing", m.playing)
            .put("title", m.title)
            .put("artist", m.artist)
            .put("album", m.album)
            .put("position_ms", m.positionMs)
            .put("duration_ms", m.durationMs)
            .put("app", m.packageName)
            .toString(2)
    }

    private var polling = false

    @Synchronized
    fun startPolling() {
        if (polling) return
        polling = true
        scope.launch {
            while (true) {
                refresh()
                kotlinx.coroutines.delay(5_000)
            }
        }
    }
}
