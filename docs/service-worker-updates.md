# Service worker background refresh flow

The frontend uses the browser's built-in service worker update cycle to keep the
PWA experience fresh without interrupting users unnecessarily.

1. During boot, `registerServiceWorker()` (`src/lib/registerServiceWorker.ts`)
   registers the worker located at `/sw.js`. When the app tab regains focus or
   every fifteen minutes, it calls `registration.update()`. This method tells
   the browser to fetch the latest `sw.js` from the UI server and compare it
   with the cached version. If the file contents differ, the browser downloads
   the new worker script and emits the `updatefound` event.
2. The `updatefound` callback calls `activateWaitingWorker()` once the browser
   finishes installing the new worker. That helper sends a `SKIP_WAITING`
   message, requesting the freshly installed worker to activate immediately.
   The helper only does this when there is already an active controller so that
   first-time installations do not force a reload.
3. When the worker activates, the browser fires the `controllerchange` event.
   We only respond to that event if an update was explicitly activated in step
   two. In that case, we reload the page so the new worker controls the fresh
   bundle.

In short, the code does not guess whether an update is available. It uses the
browser's `registration.update()` call to fetch `/sw.js` from the server and
listens for the `updatefound` signal that the browser emits only after it has
successfully downloaded a different worker script.
