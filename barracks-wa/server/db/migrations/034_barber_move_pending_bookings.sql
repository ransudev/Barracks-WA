-- Migration 032 made pending requests hold a barber's slot, but the branch-move
-- guard from migration 023 still ignored them. A pending request could stay at
-- the old branch, be approved there, and then fail at check-in. Treat pending
-- like the other active booking statuses; the rest of the guard is unchanged.
CREATE OR REPLACE FUNCTION validate_barber_branch_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_id=OLD.branch_id THEN RETURN NEW; END IF;
  IF EXISTS(SELECT 1 FROM bookings WHERE barber_id=OLD.id AND status IN ('pending','confirmed','checked_in','in_progress'))
    OR EXISTS(SELECT 1 FROM queue_entries WHERE barber_id=OLD.id AND status IN ('waiting','ready','in_progress')) THEN
    RAISE EXCEPTION 'Resolve active bookings and queue entries before moving this barber' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM shop_operating_hours WHERE branch_id=NEW.branch_id)<>7
    OR EXISTS(SELECT 1 FROM barber_schedules s LEFT JOIN shop_operating_hours h
      ON h.branch_id=NEW.branch_id AND h.day_of_week=s.day_of_week
      WHERE s.barber_id=OLD.id AND s.is_working AND
        (h.id IS NULL OR h.is_closed OR s.start_time<h.open_time OR s.end_time>h.close_time)) THEN
    RAISE EXCEPTION 'Barber schedule must fit destination branch hours before moving' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

-- Moves made before this migration may already have left pending requests at a
-- branch their barber no longer belongs to. Report them for staff review rather
-- than changing customer bookings automatically.
DO $$ DECLARE stranded TEXT; BEGIN
  SELECT string_agg(b.id::text, ', ' ORDER BY b.id) INTO stranded
  FROM bookings b JOIN barbers br ON br.id=b.barber_id
  WHERE b.status IN ('pending','confirmed','checked_in','in_progress') AND b.branch_id<>br.branch_id;
  IF stranded IS NOT NULL THEN
    RAISE NOTICE 'Active bookings whose barber now belongs to another branch (reassign or reject them): %', stranded;
  END IF;
END $$;
