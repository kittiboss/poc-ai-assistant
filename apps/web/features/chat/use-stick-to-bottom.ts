'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const AT_BOTTOM_THRESHOLD_PX = 80;

/**
 * Keeps a scroll container pinned to the bottom while its content grows (streaming),
 * and lets go as soon as the user scrolls up to read earlier messages.
 */
export function useStickToBottom(scrollRef: RefObject<HTMLElement | null>, contentRef: RefObject<HTMLElement | null>) {
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      stickRef.current = true;
      setIsAtBottom(true);
      scroller.scrollTo({ top: scroller.scrollHeight, behavior });
    },
    [scrollRef],
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    const onScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickRef.current = distance < AT_BOTTOM_THRESHOLD_PX;
      setIsAtBottom(stickRef.current);
    };
    // Content also grows after render (streamed tokens, lazy syntax highlighting), so watch its size.
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scroller.scrollTop = scroller.scrollHeight;
    });

    scroller.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    scroller.scrollTop = scroller.scrollHeight;
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollRef, contentRef]);

  return { isAtBottom, scrollToBottom };
}
