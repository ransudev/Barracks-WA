"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Exit duration in milliseconds. Keep in sync with the `--drawer-duration`
 * value in `app/globals.css`, which drives the matching transition.
 */
const EXIT_DURATION_MS = 180;
/** Small buffer so the panel is not removed on the transition's final frame. */
const EXIT_GRACE_MS = 40;

export type DrawerPhase = "entering" | "entered" | "exiting";

type DrawerPresence = { mounted: boolean; phase: DrawerPhase };

/**
 * Keeps a closing drawer mounted until its exit transition finishes. The
 * returned `phase` is applied as `data-state` on the drawer layer, which the
 * shared drawer styles in `globals.css` animate from, so the inventory drawer
 * and the operational DetailDrawer move the same way.
 *
 * State only moves inside frame and timeout callbacks, so opening or closing a
 * drawer never cascades a render straight back into another render.
 */
export function useDrawerPresence(open: boolean): DrawerPresence {
  const [presence, setPresence] = useState<DrawerPresence>({
    mounted: open,
    phase: open ? "entering" : "exiting",
  });
  const mountedRef = useRef(presence.mounted);

  // Keep the ref current without making the transition effect rerun when the
  // presence state changes. The close effect uses this to distinguish a real
  // exit from an open that was canceled before its first frame mounted.
  useEffect(() => {
    mountedRef.current = presence.mounted;
  }, [presence.mounted]);

  useEffect(() => {
    if (open) {
      // Mount in the closed position first, then flip to the open position on the
      // next frame so the browser has a start value to transition from.
      let settle = 0;
      const mount = window.requestAnimationFrame(() => {
        setPresence((current) =>
          current.mounted ? current : { mounted: true, phase: "entering" },
        );
        settle = window.requestAnimationFrame(() =>
          setPresence({ mounted: true, phase: "entered" }),
        );
      });
      return () => {
        window.cancelAnimationFrame(mount);
        window.cancelAnimationFrame(settle);
      };
    }

    // A page can mount a closed drawer before it has ever been opened. There
    // is no exit transition to run in that case; only a real close transition
    // (open -> closed) should temporarily keep the drawer mounted.
    if (!mountedRef.current) return;

    let settle = 0;
    let finish = 0;
    const start = window.setTimeout(() => {
      setPresence({ mounted: true, phase: "exiting" });
      // Start the unmount clock only once the exit position has been painted,
      // and add a grace period so the tail of the transition is never cut.
      settle = window.requestAnimationFrame(() => {
        finish = window.setTimeout(
          () => setPresence({ mounted: false, phase: "exiting" }),
          EXIT_DURATION_MS + EXIT_GRACE_MS,
        );
      });
    }, 0);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(finish);
      window.cancelAnimationFrame(settle);
    };
  }, [open]);

  // A reopen during an exit reverses from the browser's current interpolated
  // transform. Derive the visible phase instead of synchronously setting state
  // inside the effect, which would add a cascading render during the animation.
  const phase =
    open && presence.mounted && presence.phase === "exiting" ? "entered" : presence.phase;
  return { ...presence, phase };
}
