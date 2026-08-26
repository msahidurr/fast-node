import type { RoutingCandidate, RoutingResult, RoutingStrategy } from "../types";

// FR-4.1's v1 strategy, per the SRS's own risk mitigation (Section 9): rules-
// based first, weighted-scoring/ML later. Filters to candidates that are both
// in stock and support the shipping region, then picks the cheapest (ties
// broken by SLA). Swapping this out for a scored/ML strategy later only means
// implementing RoutingStrategy and registering it -- engine.server.ts doesn't
// change.
export const rulesBasedStrategy: RoutingStrategy = {
  name: "rules-based-v1",

  select(candidates: RoutingCandidate[]): RoutingResult {
    if (candidates.length === 0) {
      return { selectedPartnerId: null, reasonCode: "NO_CANDIDATES", costEstimate: null, slaEstimateHours: null };
    }

    const eligible = candidates.filter((candidate) => candidate.available && candidate.regionSupported);

    if (eligible.length === 0) {
      const reasonCode = candidates.every((candidate) => !candidate.regionSupported)
        ? "NO_REGION_MATCH"
        : "OUT_OF_STOCK";
      return { selectedPartnerId: null, reasonCode, costEstimate: null, slaEstimateHours: null };
    }

    const [best] = [...eligible].sort(
      (a, b) => a.costEstimate - b.costEstimate || a.slaHours - b.slaHours,
    );

    return {
      selectedPartnerId: best.partnerId,
      reasonCode: "LOWEST_COST",
      costEstimate: best.costEstimate,
      slaEstimateHours: best.slaHours,
    };
  },
};
