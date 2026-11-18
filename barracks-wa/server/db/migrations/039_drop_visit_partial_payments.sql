-- Partial payments were removed from checkout: an amount below the balance is
-- refused, so visit_partial_payments (036) no longer receives rows. Drop it and
-- its immutability trigger. Settled visits keep what was paid earlier in
-- transactions.prior_paid, and booking deposits live on bookings, so no
-- balance depends on this table.
DROP TABLE IF EXISTS visit_partial_payments;
DROP FUNCTION IF EXISTS prevent_partial_payment_change();
