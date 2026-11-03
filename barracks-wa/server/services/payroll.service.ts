import type { PoolClient } from "pg";
import { inTransaction, type Db } from "@/server/db/transaction";
import { requireBranchAccess } from "@/server/auth/branch-access";
import type { PublicUser } from "@/server/services/user.service";
import type { PayrollCommand, PayrollQuery } from "@/server/schemas/payroll.schema";

type Actor = Pick<PublicUser, "id" | "role">;
export class PayrollError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function periodContaining(anchor: string, manilaDate: string): { start: string; end: string } | null {
  const start = Date.parse(`${anchor}T00:00:00Z`);
  const day = Date.parse(`${manilaDate}T00:00:00Z`);
  if (day < start) return null;
  const offset = Math.floor((day - start) / (14 * 86400000)) * 14;
  return { start: new Date(start + offset * 86400000).toISOString().slice(0, 10), end: new Date(start + (offset + 14) * 86400000).toISOString().slice(0, 10) };
}
export function commissionCentavos(original: string, rate: string): string {
  const [whole, fraction = ""] = rate.split(".");
  const basisPoints = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  // Nonnegative values: half up to the nearest centavo, once per service.
  return ((BigInt(original) * basisPoints + BigInt(5000)) / BigInt(10000)).toString();
}
async function authorize(db: Db, actor: Actor, branchId: number) {
  if (!["administrator", "manager"].includes(actor.role)) throw new PayrollError("Management access is required", 403);
  await requireBranchAccess(db, actor, branchId);
}
async function currentActor(client: PoolClient, actor: Actor, branchId: number) {
  const user = (await client.query<{ role: PublicUser["role"]; name: string }>(
    `SELECT r.name AS role,concat_ws(' ',u.first_name,u.last_name) AS name FROM users u JOIN roles r ON r.id=u.role_id
     WHERE u.id=$1 AND u.deleted_at IS NULL AND u.is_verified AND NOT u.is_blocked FOR SHARE OF u`, [actor.id])).rows[0];
  if (!user || user.role!==actor.role) throw new PayrollError("Your staff access changed; sign in again", 403);
  await authorize(client, actor, branchId);
  if (actor.role === "manager") await client.query("SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id=$2 FOR SHARE", [actor.id, branchId]);
  return user;
}
const recordSelect = `SELECT r.*,p.period_start::text,p.period_end_exclusive::text,
  (SELECT count(*)::int FROM payroll_record_entries x WHERE x.payroll_record_id=r.id) AS service_count
  FROM payroll_records r JOIN payroll_periods p ON p.id=r.payroll_period_id`;

export async function readPayroll(db: Db, actor: Actor, query: PayrollQuery) {
  await authorize(db, actor, query.branchId);
  if (query.recordId) {
    const record = (await db.query(`${recordSelect} WHERE r.id=$1 AND r.branch_id=$2`, [query.recordId,query.branchId])).rows[0];
    if (!record) throw new PayrollError("Payroll not found", 404);
    const [entries, adjustments, events, payment] = await Promise.all([
      db.query(`SELECT e.*,s.completed_at,s.visit_type,s.visit_record_id,s.booking_id,s.queue_entry_id,t.reference,t.status AS transaction_status
        FROM payroll_record_entries x JOIN barber_commission_entries e ON e.id=x.commission_entry_id
        JOIN payroll_service_snapshots s ON s.id=e.snapshot_id JOIN transactions t ON t.id=e.source_transaction_id
        WHERE x.payroll_record_id=$1 ORDER BY e.earned_at,e.id`, [query.recordId]),
      db.query(`SELECT a.*,concat_ws(' ',u.first_name,u.last_name) AS actor_name FROM payroll_adjustments a JOIN users u ON u.id=a.created_by WHERE payroll_record_id=$1 ORDER BY a.id`, [query.recordId]),
      db.query(`SELECT a.*,concat_ws(' ',u.first_name,u.last_name) AS actor_name FROM payroll_audit_events a JOIN users u ON u.id=a.actor_id WHERE payroll_record_id=$1 ORDER BY a.id`, [query.recordId]),
      db.query(`SELECT p.*,concat_ws(' ',u.first_name,u.last_name) AS recorder_name FROM payroll_payments p JOIN users u ON u.id=p.recorded_by WHERE payroll_record_id=$1`, [query.recordId]),
    ]);
    return { record, entries: entries.rows, adjustments: adjustments.rows, events: events.rows, payment: payment.rows[0] ?? null };
  }
  const settings = (await db.query("SELECT anchor_date::text FROM payroll_settings WHERE branch_id=$1", [query.branchId])).rows[0] ?? null;
  const today = (await db.query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date::text AS today")).rows[0].today as string;
  const currentPeriod=settings ? periodContaining(settings.anchor_date,today) : null;
  const values = [query.branchId, query.periodStart ?? null, query.barberId ?? null, query.status ?? null, query.search];
  const where = `WHERE r.branch_id=$1 AND ($2::date IS NULL OR p.period_start=$2::date)
    AND ($3::integer IS NULL OR r.barber_id=$3) AND ($4::text IS NULL OR r.status=$4)
    AND strpos(lower(r.barber_name),lower($5))>0`;
  const [records, summary, rates, unresolved, periods, barbers, corrections, currentEarnings, unassigned] = await Promise.all([
    db.query(`${recordSelect} ${where} ORDER BY p.period_start DESC,r.barber_name,r.id DESC LIMIT 50 OFFSET $6`, [...values, (query.page-1)*50]),
    db.query(`SELECT count(*)::int AS total_records,count(DISTINCT r.barber_id)::int AS barbers,
      count(*) FILTER(WHERE r.status='pending_approval')::int AS pending,
      count(*) FILTER(WHERE r.status='paid')::int AS paid,
      COALESCE(sum(r.payable_centavos) FILTER(WHERE r.status<>'paid'),0)::text AS payable_centavos
      FROM payroll_records r JOIN payroll_periods p ON p.id=r.payroll_period_id ${where}`, values),
    db.query(`SELECT b.id,b.first_name,b.last_name,
      (SELECT commission_rate::text FROM barber_commission_rates WHERE barber_id=b.id AND effective_at<=clock_timestamp() ORDER BY effective_at DESC LIMIT 1) AS current_rate,
      COALESCE((SELECT json_agg(h ORDER BY h.effective_at DESC) FROM
        (SELECT r.*,concat_ws(' ',u.first_name,u.last_name) AS actor_name FROM barber_commission_rates r LEFT JOIN users u ON u.id=r.changed_by WHERE r.barber_id=b.id) h),'[]') AS history
      FROM barbers b WHERE b.branch_id=$1 ORDER BY b.first_name,b.last_name`, [query.branchId]),
    db.query(`SELECT s.*,concat_ws(' ',b.first_name,b.last_name) AS barber_name,t.reference AS transaction_reference,t.status AS transaction_status
      FROM payroll_service_snapshots s JOIN barbers b ON b.id=s.barber_id LEFT JOIN transactions t ON t.visit_type=s.visit_type AND t.visit_record_id=s.visit_record_id
      WHERE s.branch_id=$1 AND s.rate_snapshot IS NULL AND NOT EXISTS(SELECT 1 FROM payroll_snapshot_corrections c WHERE c.snapshot_id=s.id)
      ORDER BY s.completed_at DESC,s.id DESC`, [query.branchId]),
    db.query("SELECT period_start::text,period_end_exclusive::text FROM payroll_periods WHERE branch_id=$1 ORDER BY period_start DESC", [query.branchId]),
    db.query(`SELECT DISTINCT b.id,concat_ws(' ',b.first_name,b.last_name) AS name FROM barbers b
      WHERE b.branch_id=$1 OR EXISTS(SELECT 1 FROM payroll_service_snapshots s WHERE s.barber_id=b.id AND s.branch_id=$1)
      ORDER BY name,b.id`, [query.branchId]),
    db.query(`SELECT c.*,s.service_name,s.completed_at,concat_ws(' ',b.first_name,b.last_name) AS barber_name,
      concat_ws(' ',u.first_name,u.last_name) AS approver_name FROM payroll_snapshot_corrections c
      JOIN payroll_service_snapshots s ON s.id=c.snapshot_id JOIN barbers b ON b.id=s.barber_id JOIN users u ON u.id=c.approved_by
      WHERE s.branch_id=$1 ORDER BY c.approved_at DESC,c.id DESC`, [query.branchId]),
    db.query(`SELECT e.barber_id,concat_ws(' ',b.first_name,b.last_name) AS barber_name,count(*)::int AS service_count,sum(e.amount_centavos)::text AS gross_centavos
      FROM barber_commission_entries e JOIN barbers b ON b.id=e.barber_id WHERE e.branch_id=$1
        AND e.earned_at>=($2::date::timestamp AT TIME ZONE 'Asia/Manila') AND e.earned_at<($3::date::timestamp AT TIME ZONE 'Asia/Manila')
      GROUP BY e.barber_id,b.first_name,b.last_name ORDER BY barber_name,e.barber_id`,[query.branchId,currentPeriod?.start ?? null,currentPeriod?.end ?? null]),
    db.query(`SELECT count(*)::int AS service_count,COALESCE(sum(e.amount_centavos),0)::text AS gross_centavos,
      count(*) FILTER(WHERE e.earned_at<($2::date::timestamp AT TIME ZONE 'Asia/Manila'))::int AS before_calendar
      FROM barber_commission_entries e WHERE e.branch_id=$1 AND NOT EXISTS(SELECT 1 FROM payroll_record_entries x WHERE x.commission_entry_id=e.id)`,[query.branchId,settings?.anchor_date ?? null]),
  ]);
  return { settings, today, currentPeriod,
    records: records.rows, summary: summary.rows[0], rates: rates.rows, unresolved: unresolved.rows, periods: periods.rows,
    barbers: barbers.rows, corrections: corrections.rows, currentEarnings: currentEarnings.rows, unassigned: unassigned.rows[0], page: query.page };
}
async function audit(client: PoolClient, recordId: string, actorId: number, action: string, reason?: string) {
  await client.query("INSERT INTO payroll_audit_events(payroll_record_id,actor_id,action,reason) VALUES($1,$2,$3,$4)", [recordId,actorId,action,reason ?? null]);
}
async function recalculate(client: PoolClient, recordId: string) {
  await client.query(`UPDATE payroll_records SET gross_centavos=v.gross,adjustments_centavos=v.adjustments,
    payable_centavos=v.gross+v.adjustments,updated_at=clock_timestamp() FROM (
      SELECT COALESCE((SELECT sum(e.amount_centavos) FROM payroll_record_entries x JOIN barber_commission_entries e ON e.id=x.commission_entry_id WHERE x.payroll_record_id=$1),0) AS gross,
        COALESCE((SELECT sum(amount_centavos) FROM payroll_adjustments WHERE payroll_record_id=$1),0) AS adjustments
    ) v WHERE id=$1`, [recordId]);
}

export async function mutatePayroll(db: Db, actor: Actor, input: PayrollCommand) {
  return inTransaction(db, async (client) => {
    const staff = await currentActor(client,actor,input.branchId);
    if ((input.action==='approve' || input.action==='correct_snapshot') && actor.role!=='manager')
      throw new PayrollError("Only an assigned Manager can approve payroll or a historical rate correction",403);
    if (input.action==='configure') {
      await client.query("INSERT INTO payroll_settings(branch_id,anchor_date,configured_by) VALUES($1,$2,$3)", [input.branchId,input.anchorDate,actor.id]);
      return { message: "Payroll calendar configured" };
    }
    if (input.action==='rate') {
      const barber = (await client.query("SELECT id FROM barbers WHERE id=$1 AND branch_id=$2 FOR UPDATE", [input.barberId,input.branchId])).rows[0];
      if (!barber) throw new PayrollError("Barber not found in this branch",404);
      const now = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now as Date;
      if (input.effectiveAt && new Date(input.effectiveAt)<now) throw new PayrollError("Rate changes cannot be backdated; use an audited correction for a historical error",400);
      const effective = input.effectiveAt ?? now.toISOString();
      const old = (await client.query("SELECT commission_rate FROM barber_commission_rates WHERE barber_id=$1 AND effective_at<=$2 ORDER BY effective_at DESC LIMIT 1", [input.barberId,effective])).rows[0];
      await client.query(`INSERT INTO barber_commission_rates(barber_id,old_rate,commission_rate,effective_at,changed_by,change_reason) VALUES($1,$2,$3,$4,$5,$6)`, [input.barberId,old?.commission_rate ?? null,input.rate,effective,actor.id,input.reason]);
      return { message: "Rate change recorded; completed services keep their snapshots" };
    }
    if (input.action==='correct_snapshot') {
      const snap = (await client.query("SELECT * FROM payroll_service_snapshots WHERE id=$1 AND branch_id=$2 FOR UPDATE", [input.snapshotId,input.branchId])).rows[0];
      if (!snap) throw new PayrollError("Service snapshot not found",404);
      if (snap.rate_snapshot!==null) throw new PayrollError("An existing service rate cannot be overwritten; use a separately approved payroll adjustment");
      await client.query("INSERT INTO payroll_snapshot_corrections(snapshot_id,rate,reason,approved_by) VALUES($1,$2,$3,$4)", [input.snapshotId,input.rate,input.reason,actor.id]);
      const tx = (await client.query("SELECT id FROM transactions WHERE visit_type=$1 AND visit_record_id=$2", [snap.visit_type,snap.visit_record_id])).rows[0];
      if (tx) await client.query("SELECT accrue_payroll_commission($1)", [tx.id]);
      return { message: "Historical rate confirmed with Manager approval and audit evidence" };
    }
    if (input.action==='generate') {
      const setting = (await client.query("SELECT anchor_date::text FROM payroll_settings WHERE branch_id=$1 FOR UPDATE", [input.branchId])).rows[0];
      if (!setting) throw new PayrollError("Configure the first period start date before generating payroll");
      const period = periodContaining(setting.anchor_date,input.periodStart);
      if (!period || period.start!==input.periodStart) throw new PayrollError("Select a start date on the configured 14-day calendar",400);
      const today = (await client.query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date::text AS today")).rows[0].today;
      if (period.end>today) throw new PayrollError("Generate a payroll draft after the 14-day period closes");
      const p = (await client.query(`INSERT INTO payroll_periods(branch_id,period_start,period_end_exclusive) VALUES($1,$2,$3)
        ON CONFLICT(branch_id,period_start) DO NOTHING RETURNING id`, [input.branchId,period.start,period.end])).rows[0]
        ?? (await client.query("SELECT id FROM payroll_periods WHERE branch_id=$1 AND period_start=$2", [input.branchId,period.start])).rows[0];
      const entries = (await client.query(`SELECT e.* FROM barber_commission_entries e WHERE e.branch_id=$1
        AND e.earned_at>=($2::date::timestamp AT TIME ZONE 'Asia/Manila') AND e.earned_at<($3::date::timestamp AT TIME ZONE 'Asia/Manila')
        AND NOT EXISTS(SELECT 1 FROM payroll_record_entries x WHERE x.commission_entry_id=e.id) ORDER BY e.barber_id,e.id FOR UPDATE OF e`, [input.branchId,period.start,period.end])).rows;
      const changed = new Set<string>();
      // Resolve each barber's target record once, then attach all their entries in one insert.
      const entryIdsByBarber = new Map<number, string[]>();
      for (const entry of entries) entryIdsByBarber.set(entry.barber_id, [...(entryIdsByBarber.get(entry.barber_id) ?? []), entry.id]);
      for (const [barberId, entryIds] of entryIdsByBarber) {
        let record = (await client.query("SELECT * FROM payroll_records WHERE payroll_period_id=$1 AND barber_id=$2 AND supplemental_to IS NULL FOR UPDATE", [p.id,barberId])).rows[0];
        const parent = record;
        if (record && record.status==='pending_approval') continue; // Return to Draft to incorporate late entries.
        if (record && ['approved','paid'].includes(record.status)) {
          record = (await client.query("SELECT * FROM payroll_records WHERE supplemental_to=$1 AND status IN ('draft','pending_approval') FOR UPDATE", [record.id])).rows[0];
          if (record?.status==='pending_approval') continue;
        }
        if (!record) record = (await client.query(`INSERT INTO payroll_records(payroll_period_id,branch_id,barber_id,supplemental_to,barber_name,branch_name)
          SELECT $1,$2,b.id,$4,concat_ws(' ',b.first_name,b.last_name),br.name FROM barbers b JOIN branches br ON br.id=$2 WHERE b.id=$3 RETURNING *`, [p.id,input.branchId,barberId,parent?.id ?? null])).rows[0];
        await client.query("INSERT INTO payroll_record_entries(payroll_record_id,commission_entry_id) SELECT $1,unnest($2::bigint[]) ON CONFLICT DO NOTHING", [record.id,entryIds]);
        changed.add(record.id);
      }
      for (const id of changed) { await recalculate(client,id); await audit(client,id,actor.id,'generate'); }
      return { message: `${changed.size} payroll draft(s) updated; locked records were preserved`, count: changed.size };
    }
    const record = (await client.query("SELECT * FROM payroll_records WHERE id=$1 AND branch_id=$2 FOR UPDATE", [input.recordId,input.branchId])).rows[0];
    if (!record) throw new PayrollError("Payroll not found",404);
    if (input.action==='supplement') {
      if (record.supplemental_to || !['approved','paid'].includes(record.status)) throw new PayrollError("Choose an approved or paid normal payroll as the correction source");
      const existing=(await client.query("SELECT id FROM payroll_records WHERE supplemental_to=$1 AND status IN ('draft','pending_approval') FOR UPDATE",[record.id])).rows[0];
      if(existing) return {message:"An open supplement already exists; review it before creating another",recordId:existing.id};
      const correction=(await client.query(`INSERT INTO payroll_records(payroll_period_id,branch_id,barber_id,supplemental_to,barber_name,branch_name)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[record.payroll_period_id,record.branch_id,record.barber_id,record.id,record.barber_name,record.branch_name])).rows[0];
      await audit(client,correction.id,actor.id,'create_correction',input.reason);
      return {message:"Correction draft created; add an itemized adjustment and submit it for Manager approval",recordId:correction.id};
    } else if (input.action==='adjust') {
      if (record.status!=='draft') throw new PayrollError("Return payroll to Draft before making an adjustment");
      if (BigInt(record.payable_centavos)+BigInt(input.amountCentavos)<BigInt(0)) throw new PayrollError("Payable amount cannot be negative",400);
      if(input.sourceRecordId) {
        const source=(await client.query("SELECT id FROM payroll_records WHERE id=$1 AND branch_id=$2 AND barber_id=$3 AND status IN ('approved','paid') FOR SHARE",[input.sourceRecordId,input.branchId,record.barber_id])).rows[0];
        if(!source) throw new PayrollError("Correction source must be approved payroll for the same barber and branch",400);
      }
      await client.query("INSERT INTO payroll_adjustments(payroll_record_id,amount_centavos,reason,created_by,source_record_id) VALUES($1,$2,$3,$4,$5)", [record.id,input.amountCentavos,input.reason,actor.id,input.sourceRecordId ?? record.supplemental_to ?? null]);
      await recalculate(client,record.id); await audit(client,record.id,actor.id,'adjust',input.reason);
    } else if (input.action==='submit') {
      if (record.status!=='draft') throw new PayrollError("Only a Draft can be submitted");
      await client.query("UPDATE payroll_records SET status='pending_approval',submitted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", [record.id]);
      await audit(client,record.id,actor.id,'submit');
    } else if (input.action==='return') {
      if (record.status!=='pending_approval') throw new PayrollError("Only pending payroll can be returned");
      await client.query("UPDATE payroll_records SET status='draft',submitted_at=NULL,updated_at=clock_timestamp() WHERE id=$1", [record.id]);
      await audit(client,record.id,actor.id,'return',input.reason);
    } else if (input.action==='approve') {
      if (record.status!=='pending_approval') throw new PayrollError("Only pending payroll can be approved");
      await client.query("UPDATE payroll_records SET status='approved',approved_by=$2,approver_name=$3,approved_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", [record.id,actor.id,staff.name]);
      await audit(client,record.id,actor.id,'approve');
    } else if (input.action==='pay') {
      if (record.status!=='approved') throw new PayrollError("Manager approval is required before payment");
      const paidAt = new Date(input.paidAt);
      if (paidAt<new Date(record.approved_at) || paidAt>new Date()) throw new PayrollError("Payment date must be after approval and cannot be in the future",400);
      await client.query("INSERT INTO payroll_payments(payroll_record_id,amount_centavos,paid_at,payment_method,reference,recorded_by) VALUES($1,$2,$3,$4,$5,$6)", [record.id,record.payable_centavos,input.paidAt,input.paymentMethod,input.reference ?? null,actor.id]);
      await client.query("UPDATE payroll_records SET status='paid',paid_at=$2,updated_at=clock_timestamp() WHERE id=$1", [record.id,input.paidAt]);
      await audit(client,record.id,actor.id,'pay');
    }
    return { message: "Payroll updated", recordId: record.id };
  });
}
