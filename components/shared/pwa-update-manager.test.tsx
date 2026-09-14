import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateManager } from './pwa-update-manager';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

afterEach(() => {
  cleanup();
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
  if (originalVisibilityState) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityState);
  }
  navigation.pathname = '/';
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

function installServiceWorkerMock(controller: ServiceWorker | null = {} as ServiceWorker) {
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = { update } as unknown as ServiceWorkerRegistration;
  const listeners = new Map<string, EventListener>();
  const serviceWorker = {
    controller,
    ready: Promise.resolve(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') listeners.set(type, listener);
    }),
    removeEventListener: vi.fn(),
  } as unknown as ServiceWorkerContainer;

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: serviceWorker,
  });

  return { serviceWorker, update, listeners };
}

describe('PwaUpdateManager', () => {
  it('checks for updates and removes the same listeners on unmount', async () => {
    const { serviceWorker, update } = installServiceWorkerMock();
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const view = render(<PwaUpdateManager reloadPage={vi.fn()} />);

    await waitFor(() => expect(update).toHaveBeenCalled());
    const controllerListener = (serviceWorker.addEventListener as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1];
    const visibilityListener = documentAdd.mock.calls.find(
      ([type]) => type === 'visibilitychange',
    )?.[1];
    const onlineListener = windowAdd.mock.calls.find(([type]) => type === 'online')?.[1];
    expect(controllerListener).toEqual(expect.any(Function));
    expect(visibilityListener).toEqual(expect.any(Function));
    expect(onlineListener).toEqual(expect.any(Function));

    view.unmount();

    expect(serviceWorker.removeEventListener).toHaveBeenCalledWith(
      'controllerchange',
      controllerListener,
    );
    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', visibilityListener);
    expect(windowRemove).toHaveBeenCalledWith('online', onlineListener);
  });

  it('ignores the initial controller install but reloads for a replacement controller', () => {
    const initial = installServiceWorkerMock(null);
    const reloadInitial = vi.fn();
    const firstView = render(<PwaUpdateManager reloadPage={reloadInitial} />);

    (initial.serviceWorker as { controller: ServiceWorker | null }).controller =
      {} as ServiceWorker;
    act(() => initial.listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(reloadInitial).not.toHaveBeenCalled();
    firstView.unmount();

    const replacement = installServiceWorkerMock({} as ServiceWorker);
    const reloadReplacement = vi.fn();
    render(<PwaUpdateManager reloadPage={reloadReplacement} />);

    act(() => replacement.listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(reloadReplacement).toHaveBeenCalledTimes(1);
  });

  it('defers a replacement reload during a live session until the route changes', () => {
    navigation.pathname = '/session/session-1';
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    const view = render(<PwaUpdateManager reloadPage={reload} />);

    act(() => listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(reload).not.toHaveBeenCalled();

    navigation.pathname = '/history';
    view.rerender(<PwaUpdateManager reloadPage={reload} />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('guards against repeated update reloads across page lifetimes', () => {
    const now = 1_000_000;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = installServiceWorkerMock({} as ServiceWorker);
    const firstReload = vi.fn();
    const firstView = render(<PwaUpdateManager reloadPage={firstReload} />);

    act(() => first.listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(firstReload).toHaveBeenCalledTimes(1);
    firstView.unmount();

    const second = installServiceWorkerMock({} as ServiceWorker);
    const secondReload = vi.fn();
    const secondView = render(<PwaUpdateManager reloadPage={secondReload} />);
    act(() => second.listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(secondReload).not.toHaveBeenCalled();
    secondView.unmount();

    dateNow.mockReturnValue(now + 60_001);
    const later = installServiceWorkerMock({} as ServiceWorker);
    const laterReload = vi.fn();
    render(<PwaUpdateManager reloadPage={laterReload} />);
    act(() => later.listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(laterReload).toHaveBeenCalledTimes(1);
  });

  it('defers a replacement reload while hidden and reloads when visibility returns', () => {
    setVisibilityState('hidden');
    const { listeners } = installServiceWorkerMock({} as ServiceWorker);
    const reload = vi.fn();
    render(<PwaUpdateManager reloadPage={reload} />);

    act(() => listeners.get('controllerchange')?.(new Event('controllerchange')));
    expect(reload).not.toHaveBeenCalled();

    setVisibilityState('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('checks for updates again when the page becomes visible or comes online', async () => {
    setVisibilityState('hidden');
    const { serviceWorker, update } = installServiceWorkerMock({} as ServiceWorker);
    render(<PwaUpdateManager reloadPage={vi.fn()} />);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    update.mockClear();

    setVisibilityState('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    (serviceWorker.getRegistration as ReturnType<typeof vi.fn>).mockClear();
    update.mockClear();
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(serviceWorker.getRegistration).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });
});
