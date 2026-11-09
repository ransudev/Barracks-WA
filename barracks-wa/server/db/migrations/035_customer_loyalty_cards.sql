-- The owner hands out physical loyalty cards in person; the shop does not run a
-- points scheme. Record whether a customer holds a card, when it was issued and
-- by whom. loyalty_points is kept (no data is dropped) but the app no longer
-- reads or writes it.
ALTER TABLE customers ADD COLUMN loyalty_card_issued_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN loyalty_card_issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE customers ADD CONSTRAINT customers_loyalty_card_issuer_check
  CHECK (loyalty_card_issued_by IS NULL OR loyalty_card_issued_at IS NOT NULL);
CREATE INDEX customers_loyalty_card_issued_by_idx ON customers(loyalty_card_issued_by);
COMMENT ON COLUMN customers.loyalty_points IS
  'Retired by migration 035: loyalty is tracked as a physical card (loyalty_card_issued_at). Kept for history; unused by the app.';
