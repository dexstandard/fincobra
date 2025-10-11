interface ServiceWorkerMessage {
  type: 'SKIP_WAITING';
}

const UPDATE_INTERVAL_MS = 15 * 60 * 1000;

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
