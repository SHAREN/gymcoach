'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

export function isServiceWorkerUpdate(previousController: ServiceWorker | null): boolean {
  return previousController !== null;
}

interface Props {
  reloadPage?: () => void;
}

const PWA_RELOAD_GUARD_KEY = 'gymcoach:pwa-update-reloaded-at';
const PWA_RELOAD_GUARD_MS = 60_000;
const PWA_UPDATE_CHECK_INTERVAL_MS = 30_000;

function wasRecentlyReloadedForUpdate() {
  try {
    const value = window.sessionStorage.getItem(PWA_RELOAD_GUARD_KEY);
    if (!value) return false;

    const reloadedAt = Number(value);
    const age = Date.now() - reloadedAt;
    return Number.isFinite(reloadedAt) && age >= 0 && age < PWA_RELOAD_GUARD_MS;
  } catch {
    return false;
  }
}

function markUpdateReload() {
  try {
    window.sessionStorage.setItem(PWA_RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // A storage failure must not prevent a required update reload.
  }
}

function reloadCurrentPage() {
  window.location.reload();
}

export function isLiveSessionPath(pathname: string): boolean {
  return pathname.startsWith('/session/');
}

export function PwaUpdateManager({ reloadPage = reloadCurrentPage }: Props = {}) {
  const pathname = usePathname();
  const reloadPending = useRef(false);
  const reloading = useRef(false);
  const lastUpdateCheckAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (
      reloadPending.current &&
      !isLiveSessionPath(pathname) &&
      document.visibilityState !== 'hidden'
    ) {
      reloadPending.current = false;
      reloading.current = true;
      reloadPage();
      return;
    }

    let controller = navigator.serviceWorker.controller;

    function reloadForUpdate() {
      if (reloading.current || wasRecentlyReloadedForUpdate()) return;
      if (document.visibilityState === 'hidden' || isLiveSessionPath(pathname)) {
        reloadPending.current = true;
        return;
      }

      reloadPending.current = false;
      reloading.current = true;
      markUpdateReload();
      reloadPage();
    }

    function handleControllerChange() {
      // A controller appearing for the first time is the initial PWA install,
      // not an update to a page that is already running.
      if (!isServiceWorkerUpdate(controller)) {
        controller = navigator.serviceWorker.controller;
        return;
      }

      reloadForUpdate();
    }

    async function checkForUpdate() {
      const now = Date.now();
      if (now - lastUpdateCheckAt.current < PWA_UPDATE_CHECK_INTERVAL_MS) return;
      lastUpdateCheckAt.current = now;

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      } catch {
        // Updates are best-effort; offline mode continues through Workbox caches.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (reloadPending.current) {
        reloadForUpdate();
        return;
      }
      void checkForUpdate();
    }

    function handleOnline() {
      void checkForUpdate();
    }

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    void navigator.serviceWorker.ready
      .then((registration) => {
        lastUpdateCheckAt.current = Date.now();
        return registration.update();
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [pathname, reloadPage]);

  return null;
}
