export interface LocaleCacheStorage {
  keys(): Promise<string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export async function clearLocalePageCaches(cacheStorage: LocaleCacheStorage): Promise<string[]> {
  const cacheNames = await cacheStorage.keys();
  const staleNames = cacheNames.filter(
    (name) => name === 'start-url' || name.startsWith('pages'),
  );

  await Promise.all(staleNames.map((name) => cacheStorage.delete(name)));
  return staleNames;
}
