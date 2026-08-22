import { describe, expect, it, vi } from 'vitest';
import { clearLocalePageCaches } from './locale-cache';

describe('clearLocalePageCaches', () => {
  it('clears every page cache version and the start page without touching API/static caches', async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const cleared = await clearLocalePageCaches({
      keys: vi.fn().mockResolvedValue([
        'pages-v2',
        'pages-old',
        'start-url',
        'api-get',
        'static-assets',
      ]),
      delete: deleteCache,
    });

    expect(cleared).toEqual(['pages-v2', 'pages-old', 'start-url']);
    expect(deleteCache).toHaveBeenCalledTimes(3);
    expect(deleteCache).not.toHaveBeenCalledWith('api-get');
    expect(deleteCache).not.toHaveBeenCalledWith('static-assets');
  });
});
