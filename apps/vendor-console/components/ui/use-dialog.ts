'use client';

import { useCallback, useState } from 'react';

/**
 * Open state for a dialog that starts fresh every time it opens: render it with `key`, so its form,
 * request state and anything else it holds begin anew instead of keeping the last visit's values.
 */
export function useDialog() {
  const [state, setState] = useState({ open: false, key: 0 });
  const show = useCallback(() => setState((s) => ({ open: true, key: s.key + 1 })), []);
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { ...state, show, hide };
}
