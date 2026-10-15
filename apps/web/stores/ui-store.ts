import { createStore } from 'zustand/vanilla';

export interface UIState {
  /** The sidebar drawer on screens narrower than md */
  mobileNavOpen: boolean;
}

export interface UIActions {
  setMobileNavOpen: (open: boolean) => void;
}

export type UIStore = UIState & UIActions;

export function createUIStore(initial: Partial<UIState> = {}) {
  return createStore<UIStore>()((set) => ({
    mobileNavOpen: false,
    ...initial,
    setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  }));
}
