package ai.ive.app

import ai.ive.app.core.NotchState
import ai.ive.app.core.NotchView
import ai.ive.app.overlay.NotchService
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Pull down, tap IVE, think out loud — no need to find the icon. */
class QsTileService : TileService() {

    override fun onStartListening() {
        IveRuntime.init(this)
        paint()
    }

    override fun onClick() {
        if (NotchService.running) {
            NotchState.view = NotchView.Composer
        } else if (IveRuntime.hasOverlay()) {
            IveRuntime.startNotch()
            NotchState.view = NotchView.Composer
        } else {
            IveRuntime.requestOverlay()
        }
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ paint() }, 400)
    }

    private fun paint() {
        qsTile?.let { tile ->
            tile.label = "IVE"
            tile.state = if (NotchService.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            tile.subtitle = if (NotchService.running) "Listening" else "Off"
            tile.updateTile()
        }
    }
}
