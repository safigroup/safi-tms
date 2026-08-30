// Shapes returned by /api/bootstrap, matching the trip_board/billable views
// and reference tables exactly (index.html's S.board / S.billable / etc).

export type OrgRole = "owner" | "admin" | "ops" | "finance" | "viewer";

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
  customer_id: string;
  route_id: string;
  driver_id: string | null;
  truck_id: string | null;
  seal_no: string | null;
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

export type RouteBorderPath = {
  id: string;
  route_id: string;
  label: string;
  borders: string[];
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

export type FxRate = {
  id: string;
  currency: string;
  rate_to_usd: number;
  effective_on: string;
  source: string | null;
};

export type AuditLogEntry = {
  field: string;
  old_value: string | null;
  new_value: string | null;
  edited_by_email: string;
  edited_at: string;
};

export type TripCost = {
  id: string;
  trip_id: string;
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  fx_rate_to_usd: number;
  amount_usd: number;
  incurred_on: string;
  location: string | null;
  paid_by: string | null;
  receipt_ref: string | null;
  receipt_path: string | null;
  liters: number | null;
  price_per_liter: number | null;
};

export type DocStatus = "pending" | "issued" | "lodged" | "cleared" | "received" | "rejected";

export type TripDocument = {
  id: string;
  trip_id: string;
  doc_type: string;
  doc_number: string | null;
  status: DocStatus;
  storage_path: string | null;
  issued_on: string | null;
  received_on: string | null;
};

export type BillableTrip = {
  trip_id: string;
  trip_no: string;
  customer: string;
  route: string;
  status: TripStatus;
  revenue_usd: number;
  half_usd: number;
  pod_in_hand: boolean;
  loading_invoiced: boolean;
  delivery_invoiced: boolean;
};

export type ArInvoice = {
  id: string;
  invoice_no: string;
  invoice_type: string;
  status: string;
  customer: string;
  currency: string;
  total_due: number;
  paid: number;
  outstanding: number;
  issued_on: string;
  due_on: string;
  days_overdue: number;
  bucket: string;
  trips: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

export type TruckCost = {
  id: string;
  truck_id: string;
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  fx_rate_to_usd: number;
  amount_usd: number;
  incurred_on: string;
};

export type TruckReportTrip = {
  trip_id: string;
  trip_no: string;
  actual_load_date: string | null;
  revenue_usd: number;
  cost_usd: number;
  margin_usd: number;
};

export type CategoryAmount = {
  category: string;
  amountUsd: number;
  // Only populated for the "fuel" row.
  liters?: number;
  avgPricePerLiterUsd?: number;
};

export type TruckReport = {
  truck: Truck;
  from: string | null;
  to: string | null;
  trips: TruckReportTrip[];
  standingCosts: TruckCost[];
  tripRevenue: number;
  tripExpenses: number;
  standingExpenses: number;
  totalExpenses: number;
  margin: number;
  tripExpensesByCategory: CategoryAmount[];
  standingExpensesByCategory: CategoryAmount[];
};

export type BootstrapPayload = {
  fetchErrors: string[];
  role: OrgRole;
  userId: string;
  board: BoardTrip[];
  billable: BillableTrip[];
  ar: ArInvoice[];
  fx: FxRate[];
  customers: Customer[];
  routes: Route[];
  trucks: Truck[];
  drivers: Driver[];
  rateCards: RateCard[];
  routeBorderPaths: RouteBorderPath[];
};
