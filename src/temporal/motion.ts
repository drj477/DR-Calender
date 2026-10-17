/**
 * Reanimated 3 preset values.
 *
 * Import Reanimated's withSpring/withTiming in UI components and pass these
 * constants to them. Keeping this file dependency-free makes domain tests easy.
 */
export const SPRING_PRESETS = {
  /** Crisp settling for date and time snapping. */
  snap: {
    damping: 28,
    stiffness: 280,
    mass: 0.8,
  },
  /** Short, tactile lift on press-and-hold. */
  lift: {
    damping: 20,
    stiffness: 320,
    mass: 0.6,
  },
  /** Subtle elastic response for drag/drop placement. */
  elastic: {
    damping: 22,
    stiffness: 300,
    mass: 0.7,
  },
} as const;

export const TIMING_PRESETS = {
  taskCollapse: {
    duration: 180,
    easing: "ease-out",
  },
  microFade: {
    duration: 120,
    easing: "ease-out",
  },
  viewportMorph: {
    duration: 240,
    easing: "ease-in-out",
  },
} as const;

export const MOTION_TOKENS = {
  liftedScale: 1.025,
  taskCheckScale: 0.85,
  itemStaggerMs: 18,
  snapMinutes: [15, 30] as const,
  liftShadow: {
    opacity: 0.18,
    radius: 12,
  },
} as const;

export type SpringPresetName = keyof typeof SPRING_PRESETS;
export type TimingPresetName = keyof typeof TIMING_PRESETS;
