import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateManager } from './pwa-update-manager';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

afterEach(() => {
  if (originalServiceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  } else {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});

describe('PwaUpdateManager', () => {
  it('checks for an updated worker and listens for controller changes', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const registration = { update } as unknown as ServiceWorkerRegistration;
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const serviceWorker = {
      controller: {} as ServiceWorker,
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
      addEventListener,
      removeEventListener,
    } as unknown as ServiceWorkerContainer;

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker,
    });

    const view = render(<PwaUpdateManager />);

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(addEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));

    view.unmount();
    expect(removeEventListener).toHaveBeenCalledWith('controllerchange', expect.any(Function));
  });
});
