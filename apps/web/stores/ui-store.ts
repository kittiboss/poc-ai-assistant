import { createStore } from 'zustand/vanilla';

/** A reply being streamed; it keeps going when the user leaves the chat page. */
export interface ActiveStream {
  conversationId: string;
  abort: AbortController;
}

export interface UIState {
  /** The sidebar drawer on screens narrower than md */
  mobileNavOpen: boolean;
  /** The sidebar beside the page from md up; open by default */
  sidebarOpen: boolean;
  /** Set when the session could not be renewed, so the sign-in screen can say why */
  sessionExpired: boolean;
  /** Model picked above the chat composer; empty means the first available one */
  selectedModelId: string;
  conversationSearch: string;
  /** "Show archived" in the sidebar's chat list */
  showArchived: boolean;
  stream: ActiveStream | null;
  /** Last chat error, shown above the composer */
  chatError: string;
}

export interface UIActions {
  setMobileNavOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setSessionExpired: (expired: boolean) => void;
  setSelectedModelId: (id: string) => void;
  setConversationSearch: (search: string) => void;
  setShowArchived: (show: boolean) => void;
  setStream: (stream: ActiveStream | null) => void;
  setChatError: (error: string) => void;
}

export type UIStore = UIState & UIActions;

export function createUIStore(initial: Partial<UIState> = {}) {
  return createStore<UIStore>()((set) => ({
    mobileNavOpen: false,
    sidebarOpen: true,
    sessionExpired: false,
    selectedModelId: '',
    conversationSearch: '',
    showArchived: false,
    stream: null,
    chatError: '',
    ...initial,
    setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    setSessionExpired: (sessionExpired) => set({ sessionExpired }),
    setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
    setConversationSearch: (conversationSearch) => set({ conversationSearch }),
    setShowArchived: (showArchived) => set({ showArchived }),
    setStream: (stream) => set({ stream }),
    setChatError: (chatError) => set({ chatError }),
  }));
}
