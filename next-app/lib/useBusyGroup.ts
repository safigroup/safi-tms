"use client";

import { useCallback, useState } from "react";

/**
 * Ports the original app's busyGroup() double-submit guard (index.html),
 * whose one important nuance was: a group of buttons disabled during an
 * in-flight request must each restore to their OWN prior disabled state
 * afterward, not get force-enabled — some buttons (e.g. an already-raised
 * invoice half) are meant to stay disabled regardless.
 *
 * In React that nuance falls out for free: render each button's `disabled`
 * as `businessLogicDisabled || busy`. There's nothing to "restore" because
 * disabled is recomputed from current props on every render — the original
 * needed to save/restore prior state only because it was mutating
 * button.disabled imperatively. No equivalent bookkeeping needed here.
 */
export function useBusyGroup() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
