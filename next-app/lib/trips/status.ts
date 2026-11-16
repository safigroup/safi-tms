// The pill colour for each trip status, the same wherever a trip shows.
export const STATUS_PILL: Record<string, string> = {
  draft: "grey",
  allocated: "grey",
  loading: "violet",
  in_transit: "violet",
  at_border: "warn",
  delivered: "warn",
  pod_received: "good",
  invoiced: "good",
  closed: "grey",
};
