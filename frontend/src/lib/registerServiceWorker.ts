interface ServiceWorkerMessage {
  type: 'SKIP_WAITING';
}

const UPDATE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Registers the UI service worker and keeps it fresh by:
 *
 * - explicitly asking the browser to re-download `/sw.js` on an interval and
 *   whenever the tab becomes visible again (`registration.update()`). The
 *   browser only fires `updatefound` if that network request produced a new
 *   worker script.
 * - requesting that any newly installed worker activates immediately while an
 *   existing controller is present so the new bundle can take over without the
 *   usual waiting period.
 * - reloading the page only after the browser confirms the new worker has been
 *   activated (via `controllerchange`) to avoid unnecessary refreshes when no
 *   update was found.
 */
async function registerServiceWorker(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js');

  let refreshTriggered = false;
  let pendingUpdateActivation = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshTriggered) {
      return;
    }

    if (!pendingUpdateActivation) {
      return;
    }

    refreshTriggered = true;
    window.location.reload();
  });

  const activateWaitingWorker = (waiting: ServiceWorker | null) => {
    if (!waiting) {
      return;
    }

    if (!navigator.serviceWorker.controller) {
      // First load: allow the worker to take control without forcing a reload.
      return;
    }

    pendingUpdateActivation = true;
    const message: ServiceWorkerMessage = { type: 'SKIP_WAITING' };
    waiting.postMessage(message);
  };

  if (registration.waiting) {
    activateWaitingWorker(registration.waiting);
  }

  registration.addEventListener('updatefound', () => {
    activateWaitingWorker(registration.installing);
  });

  const requestUpdate = () => {
    // Ask the browser to fetch the latest `/sw.js` from the UI server. If the
    // contents are unchanged nothing else happens; otherwise the browser emits
    // `updatefound` and the flow above activates the new worker.
    void registration.update();
  };

  const visibilityListener = () => {
    if (document.visibilityState === 'visible') {
      requestUpdate();
    }
  };

  document.addEventListener('visibilitychange', visibilityListener);

  const intervalId = window.setInterval(requestUpdate, UPDATE_INTERVAL_MS);

  window.addEventListener('beforeunload', () => {
    document.removeEventListener('visibilitychange', visibilityListener);
    window.clearInterval(intervalId);
  });
}

export default registerServiceWorker;
