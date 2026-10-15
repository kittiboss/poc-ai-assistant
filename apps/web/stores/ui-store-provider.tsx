'use client';

import { createContext, use, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createUIStore, type UIStore } from './ui-store';

type UIStoreApi = ReturnType<typeof createUIStore>;

const UIStoreContext = createContext<UIStoreApi | null>(null);

/** One store per request (Zustand's recommended Next.js setup), so state never leaks between users. */
export function UIStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createUIStore());
  return <UIStoreContext value={store}>{children}</UIStoreContext>;
}

export function useUIStore<T>(selector: (state: UIStore) => T): T {
  const store = use(UIStoreContext);
  if (!store) throw new Error('useUIStore must be used inside <UIStoreProvider>');
  return useStore(store, selector);
}
