import { useEffect, useRef, useState } from 'react';

export function useDeferredLoad(defer: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(!defer);

  useEffect(() => {
    if (!defer) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '80px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [defer]);

  return { ref, shouldLoad };
}
