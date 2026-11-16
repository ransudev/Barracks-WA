-- Panel revisions: package inclusions, receipt business details, booking
-- deposits/reasons/remarks, a booking event log, partial payments for
-- underpaid visits, manager voids, and combined receipts. Additive only.

-- A10: what a service package includes, shown to customers on the booking page.
ALTER TABLE services ADD COLUMN inclusions TEXT[] NOT NULL DEFAULT '{}';

-- A25: the tax identification number printed on receipts (address and phone
-- already live on the branch).
ALTER TABLE branches ADD COLUMN tin VARCHAR(40) NOT NULL DEFAULT '';

-- A13/A15/A14: why a booking was rejected or cancelled and by whom, staff
-- remarks shown in appointment history, and the booking deposit.
ALTER TABLE bookings
  ADD COLUMN status_reason TEXT,
  ADD COLUMN closed_by VARCHAR(10),
  ADD COLUMN remarks TEXT,
  ADD COLUMN deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN deposit_method VARCHAR(40),
  ADD COLUMN deposit_reference VARCHAR(80),
  ADD COLUMN deposit_status VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_reason_check CHECK (status_reason IS NULL OR length(btrim(status_reason)) BETWEEN 1 AND 500),
  ADD CONSTRAINT bookings_closed_by_check CHECK (closed_by IS NULL OR closed_by IN ('shop','customer')),
  ADD CONSTRAINT bookings_remarks_check CHECK (remarks IS NULL OR length(remarks) <= 500),
  ADD CONSTRAINT bookings_deposit_amount_check CHECK (deposit_amount >= 0),
  ADD CONSTRAINT bookings_deposit_method_check CHECK (deposit_method IS NULL OR deposit_method IN ('cash','card','e_wallet','bank_transfer')),
  -- submitted: the customer reported paying it; received: staff verified it;
  -- released: the booking was rejected or cancelled by the shop, so it is owed back.
  ADD CONSTRAINT bookings_deposit_status_check CHECK (deposit_status IN ('none','submitted','received','released'));

-- A4: one row per thing that happened to a booking. The partial unique index
-- guarantees that creating a booking can only ever log a single event.
CREATE TABLE booking_events (
  id BIGSERIAL PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
    'created','rescheduled','confirmed','rejected','cancelled','checked_in',
    'in_progress','completed','no_show','remarks')),
  detail TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name VARCHAR(240) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX booking_events_booking_idx ON booking_events(booking_id, created_at, id);
CREATE UNIQUE INDEX booking_events_one_created ON booking_events(booking_id) WHERE event_type='created';
ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE booking_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE booking_events_id_seq FROM PUBLIC;

-- Existing bookings get their single creation event.
INSERT INTO booking_events(booking_id, event_type, detail, actor_name, created_at)
SELECT id, 'created', 'Recorded before the event log existed', '', created_at FROM bookings;

-- A21: money collected for a completed visit that does not yet cover its
-- balance. The visit stays unpaid until the balance reaches zero.
CREATE TABLE visit_partial_payments (
  id BIGSERIAL PRIMARY KEY,
  visit_type VARCHAR(20) NOT NULL CHECK (visit_type IN ('booking','queue')),
  visit_record_id BIGINT NOT NULL CHECK (visit_record_id > 0),
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(40) NOT NULL CHECK (payment_method IN ('cash','card','e_wallet','bank_transfer','other')),
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_by_name VARCHAR(240) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX visit_partial_payments_visit_idx ON visit_partial_payments(visit_type, visit_record_id);
ALTER TABLE visit_partial_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE visit_partial_payments FROM PUBLIC;
REVOKE ALL ON SEQUENCE visit_partial_payments_id_seq FROM PUBLIC;

CREATE FUNCTION prevent_partial_payment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Partial payments are immutable'
    USING ERRCODE='23514', CONSTRAINT='partial_payment_immutable';
END;
$$;
CREATE TRIGGER partial_payment_immutable BEFORE UPDATE OR DELETE ON visit_partial_payments
FOR EACH ROW EXECUTE FUNCTION prevent_partial_payment_change();

-- A23: a manager closes an unpaid or underpaid visit (underpayment or a
-- special price) with a required reason. One void per visit, never edited.
CREATE TABLE visit_voids (
  id BIGSERIAL PRIMARY KEY,
  visit_type VARCHAR(20) NOT NULL CHECK (visit_type IN ('booking','queue')),
  visit_record_id BIGINT NOT NULL CHECK (visit_record_id > 0),
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  customer_name VARCHAR(240) NOT NULL,
  service_name VARCHAR(160) NOT NULL,
  amount_due NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12,2) NOT NULL CHECK (amount_paid >= 0),
  voided_amount NUMERIC(12,2) NOT NULL CHECK (voided_amount > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  staff_name VARCHAR(240) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (visit_type, visit_record_id)
);
ALTER TABLE visit_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE visit_voids FROM PUBLIC;
REVOKE ALL ON SEQUENCE visit_voids_id_seq FROM PUBLIC;

CREATE FUNCTION prevent_visit_void_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Visit voids are immutable'
    USING ERRCODE='23514', CONSTRAINT='visit_void_immutable';
END;
$$;
CREATE TRIGGER visit_void_immutable BEFORE UPDATE OR DELETE ON visit_voids
FOR EACH ROW EXECUTE FUNCTION prevent_visit_void_change();

-- A21/A26: what was already paid before the final tender (deposit plus partial
-- payments), and the shared reference of visits paid together on one receipt.
ALTER TABLE transactions ADD COLUMN prior_paid NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (prior_paid >= 0);
ALTER TABLE transactions ADD COLUMN receipt_group VARCHAR(64);
CREATE INDEX transactions_receipt_group_idx ON transactions(receipt_group) WHERE receipt_group IS NOT NULL;

-- A24: Void replaces Refund. A voided sale is reversed in full while the
-- barber keeps the commission for the service already rendered, which is what
-- the retired refund did. The old block on post-payment voids is removed.
DROP TRIGGER payroll_void_policy ON transactions;

-- Starter inclusions for the launch packages, taken from their descriptions.
-- Managers edit these under Services.
UPDATE services SET inclusions = ARRAY['Tailored haircut','Finished to your preference'] WHERE id='barracks-basic' AND inclusions = '{}';
UPDATE services SET inclusions = ARRAY['Close shave','Warm towel finish'] WHERE id='signature-shave' AND inclusions = '{}';
UPDATE services SET inclusions = ARRAY['Complete haircut','Styling','Premium finish'] WHERE id='barracks-premium' AND inclusions = '{}';
