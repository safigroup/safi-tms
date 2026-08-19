// Shapes returned by /api/bootstrap, matching the trip_board/billable views
// and reference tables exactly (index.html's S.board / S.billable / etc).

export type TripStatus =
  | "draft"
  | "allocated"
  | "loading"
  | "in_transit"
  | "at_border"
  | "delivered"
  | "pod_received"
  | "invoiced"
  | "closed";

export type BoardTrip = {
  trip_id: string;
  org_id: string;
  trip_no: string;
  status: TripStatus;
  customer: string;
  route: string;
  borders: string[] | null;
  target_days: number | null;
  fleet_no: string | null;
  horse_reg: string | null;
  driver: string | null;
  commodity: string | null;
  tonnage: number | null;
  container_no: string | null;
  actual_load_date: string | null;
  planned_eta: string | null;
  actual_delivery_at: string | null;
  pod_received_at: string | null;
  days_running: number | null;
  over_target: boolean | null;
  revenue_usd: number;
  cost_usd: number;
  margin_usd: number;
  margin_pct: number | null;
  cost_entries: number;
  docs_pending: number;
  pod_in_hand: boolean;
  last_border: string | null;
};

export type Customer = {
  id: string;
  name: string;
  is_active: boolean;
};

export type Route = {
  id: string;
  name: string;
  target_days: number | null;
  borders: string[] | null;
  is_active?: boolean;
};

export type Truck = {
  id: string;
  fleet_no: string;
  horse_reg: string;
  is_active: boolean;
};

export type Driver = {
  id: string;
  full_name: string;
  is_active: boolean;
};

export type RateCard = {
  id: string;
  customer_id: string;
  route_id: string;
  commodity: string | null;
  rate_amount: number;
  valid_from: string;
  valid_to: string | null;
};

export type BootstrapPayload = {
  fetchErrors: string[];
  board: BoardTrip[];
  billable: unknown[];
  ar: unknown[];
  fx: unknown[];
  customers: Customer[];
  routes: Route[];
  trucks: Truck[];
  drivers: Driver[];
  rateCards: RateCard[];
};
