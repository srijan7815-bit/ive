package ai.ive.app.overlay;

import android.view.View;

import androidx.lifecycle.LifecycleOwner;
import androidx.lifecycle.ViewModelStoreOwner;
import androidx.savedstate.SavedStateRegistryOwner;

/**
 * Compose needs a lifecycle / ViewModelStore / SavedState owner on the view tree
 * before {@code setContent} runs. In lifecycle 2.8 the setters are hidden from
 * Kotlin source but still public on the JVM, so this thin Java bridge is the
 * supported way to attach them from a Service-hosted ComposeView.
 */
public final class Owners {

    private Owners() {
    }

    public static void attach(View view,
                              LifecycleOwner lifecycleOwner,
                              ViewModelStoreOwner viewModelStoreOwner,
                              SavedStateRegistryOwner savedStateRegistryOwner) {
        androidx.lifecycle.ViewTreeLifecycleOwner.set(view, lifecycleOwner);
        androidx.lifecycle.ViewTreeViewModelStoreOwner.set(view, viewModelStoreOwner);
        androidx.savedstate.ViewTreeSavedStateRegistryOwner.set(view, savedStateRegistryOwner);
    }
}
