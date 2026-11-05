export type PayrollStatus = "draft" | "pending_approval" | "approved" | "paid";
export type PayrollRecord = {
  id: string;
  branch_id: number;
  barber_id: number;
  supplemental_to: string | null;
  barber_name: string;
  branch_name: string;
  period_start: string;
  period_end_exclusive: string;
  status: PayrollStatus;
  gross_centavos: string;
  adjustments_centavos: string;
  payable_centavos: string;
  service_count: number;
  approved_by: number | null;
  approver_name: string | null;
  approved_at: string | null;
  paid_at: string | null;
};
export type PayrollEntry = {
  id: string;
  source_transaction_id: number;
  earned_at: string;
  completed_at: string;
  original_price_centavos: string;
  rate_snapshot: string;
  amount_centavos: string;
  service_name: string;
  visit_type: string;
  visit_record_id: string;
  reference: string;
  transaction_status: string;
};
export type PayrollAdjustment = {
  id: string;
  source_record_id: string | null;
  amount_centavos: string;
  reason: string;
  actor_name: string;
  created_at: string;
};
export type PayrollEvent = {
  id: string;
  action: string;
  reason: string | null;
  actor_name: string;
  created_at: string;
};
export type PayrollPayment = {
  amount_centavos: string;
  paid_at: string;
  payment_method: string;
  reference: string | null;
  recorder_name: string;
};
export type PayrollDetail = {
  record: PayrollRecord;
  entries: PayrollEntry[];
  adjustments: PayrollAdjustment[];
  events: PayrollEvent[];
  payment: PayrollPayment | null;
};
export type PayrollRate = {
  id: number;
  first_name: string;
  last_name: string;
  current_rate: string | null;
  history: {
    id: string;
    old_rate: string | null;
    commission_rate: string;
    effective_at: string;
    actor_name: string;
    change_reason: string;
  }[];
};
export type UnresolvedService = {
  id: string;
  barber_name: string;
  service_name: string;
  completed_at: string;
  original_price_centavos: string;
  transaction_reference: string | null;
  transaction_status: string | null;
};
export type PayrollOverview = {
  settings: { anchor_date: string } | null;
  today: string;
  currentPeriod: { start: string; end: string } | null;
  records: PayrollRecord[];
  summary: {
    total_records: number;
    barbers: number;
    pending: number;
    paid: number;
    payable_centavos: string;
  };
  rates: PayrollRate[];
  unresolved: UnresolvedService[];
  periods: { period_start: string; period_end_exclusive: string }[];
  page: number;
  barbers: { id: number; name: string }[];
  corrections: {
    id: string;
    service_name: string;
    completed_at: string;
    barber_name: string;
    rate: string;
    reason: string;
    approver_name: string;
    approved_at: string;
  }[];
  currentEarnings: {
    barber_id: number;
    barber_name: string;
    service_count: number;
    gross_centavos: string;
  }[];
  unassigned: { service_count: number; gross_centavos: string; before_calendar: number };
};
