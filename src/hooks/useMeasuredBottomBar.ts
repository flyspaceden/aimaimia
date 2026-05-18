import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * Measures a fixed bottom bar after first layout.
 * fallbackHeight is only the first-frame placeholder; onLayout self-corrects
 * to the actual rendered height before the user reaches the bottom content.
 */
export function useMeasuredBottomBar(fallbackHeight: number, extraSpacing: number) {
  const [barHeight, setBarHeight] = useState(fallbackHeight);

  const onBarLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setBarHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    }
  }, []);

  return {
    barHeight,
    bottomPadding: barHeight + extraSpacing,
    onBarLayout,
  };
}
