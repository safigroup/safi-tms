"use client";

// Ported from index.html's saveDraft()/restoreDraft()/clearDraft(), added
// specifically for unreliable border-post connectivity — a killed or
// reloaded tab shouldn't cost someone a re-typed cost entry. The receipt
// photo itself isn't persisted here (would need IndexedDB, not
// localStorage), only the text fields.
export type CostDraft = {
  cat: string;
  amt: string;
  cur: string;
  when: string;
  desc: string;
  loc: string;
  paid: string;
  ref: string;
  liters: string;
  pricePerLiter: string;
};

const draftKey = (tripId: string) => `safi:costDraft:${tripId}`;

export function saveCostDraft(tripId: string, draft: CostDraft) {
  try {
    const hasContent = Object.values(draft).some(Boolean);
    if (hasContent) {
      localStorage.setItem(draftKey(tripId), JSON.stringify(draft));
    } else {
      localStorage.removeItem(draftKey(tripId));
    }
  } catch {
    // storage unavailable or full — draft just won't survive a reload
  }
}

export function loadCostDraft(tripId: string): CostDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(tripId));
    return raw ? (JSON.parse(raw) as CostDraft) : null;
  } catch {
    return null;
  }
}

export function clearCostDraft(tripId: string) {
  try {
    localStorage.removeItem(draftKey(tripId));
  } catch {
    // ignore
  }
}
