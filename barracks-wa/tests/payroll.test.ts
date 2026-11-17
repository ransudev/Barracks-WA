import assert from "node:assert/strict";
import test from "node:test";
import { payrollCommandSchema, payrollQuerySchema } from "@/server/schemas/payroll.schema";
import { commissionCentavos, mutatePayroll, periodContaining, readPayroll } from "@/server/services/payroll.service";
import { applyMigrations } from "@/server/db/migrate";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { createTransaction, applyFinancialAction } from "@/server/services/payment.service";
import type { UserRole } from "@/server/schemas/user.schema";

test("payroll uses exact original-price commissions and contiguous half-open 14-day Manila dates", () => {
  assert.equal(commissionCentavos('25000','40'),'10000');
  assert.equal(commissionCentavos('25000','42.5'),'10625');
  assert.equal(commissionCentavos('1','50'),'1');
  assert.equal(commissionCentavos('1','49.99'),'0');
  assert.equal(commissionCentavos('999999999999','100'),'999999999999');
  assert.deepEqual(periodContaining('2026-10-01','2026-10-14'),{start:'2026-10-01',end:'2026-10-15'});
  assert.deepEqual(periodContaining('2026-10-01','2026-10-15'),{start:'2026-10-15',end:'2026-10-29'});
  assert.equal(periodContaining('2026-10-01','2026-09-30'),null);
  assert.equal(payrollCommandSchema.safeParse({action:'rate',branchId:1,barberId:1,rate:'100.01',reason:'change'}).success,false);
  assert.equal(payrollCommandSchema.safeParse({action:'adjust',branchId:1,recordId:1,amountCentavos:'1.01',reason:'change'}).success,false);
  assert.equal(payrollCommandSchema.safeParse({action:'approve',branchId:1,recordId:1,approvedBy:99}).success,false);
});

test("payroll migration, corrections, accrual, refunds, rates, branch security, approval, payment and supplements", {skip:!databaseConfigured}, async()=>{
  const {db,cleanup}=await createDisposableSchema(27);
  try {
    const branchId=(await db.query("SELECT id FROM branches WHERE code='MAIN'")).rows[0].id as number;
    const actors={} as Record<'administrator'|'manager'|'front_desk',{id:number;role:UserRole}>;
    for(const role of ['administrator','manager','front_desk'] as const) {
      const id=(await db.query(`INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES($1::text,'Payroll',$2,'hash',(SELECT id FROM roles WHERE name=$1::text)) RETURNING id`,[role,`${role}@payroll.test`])).rows[0].id;
      actors[role]={id,role};
      if(role!=='administrator') await db.query("INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)",[id,branchId]);
    }
    const customer=(await db.query("INSERT INTO customers(first_name,last_name) VALUES('Payroll','Customer') RETURNING id")).rows[0].id;
    const barber=(await db.query("INSERT INTO barbers(first_name,last_name,commission_rate) VALUES('Juan','Barber',40) RETURNING id")).rows[0].id as number;
    const secondBarber=(await db.query("INSERT INTO barbers(first_name,last_name,commission_rate) VALUES('Mark','Barber',50) RETURNING id")).rows[0].id as number;
    const historyBooking=(await db.query(`INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status,updated_at)
      VALUES($1,$2,'barracks-basic','Historic discounted haircut',250,'2026-08-02','09:00','completed','2026-08-02T01:45:00Z') RETURNING id`,[customer,barber])).rows[0].id;
    const historical=await db.connect();
    let txId:number;
    try {
      await historical.query('BEGIN');
      txId=(await historical.query(`INSERT INTO transactions(customer_id,booking_id,visit_type,visit_record_id,barber_id,service_id,customer_name,barber_name,service_name,amount,payment_method,status,branch_id,created_at)
        VALUES($1,$2,'booking',$2,$3,'barracks-basic','Payroll Customer','Juan Barber','Historic discounted haircut',200,'card','completed',$4,'2026-08-02T02:00:00Z') RETURNING id`,[customer,historyBooking,barber,branchId])).rows[0].id;
      await historical.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,created_at) VALUES($1,'card',200,'completed','2026-08-02T02:00:00Z')",[txId]);
      await historical.query('COMMIT');
    } finally { historical.release(); }
    await applyMigrations(db); await applyMigrations(db);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM barber_commission_entries")).rows[0].n,0,'Migration must not fabricate historical commissions');
    const snap=(await db.query("SELECT * FROM payroll_service_snapshots WHERE booking_id=$1",[historyBooking])).rows[0];
    assert.equal(snap.rate_snapshot,null);
    const correct={action:'correct_snapshot',branchId,snapshotId:Number(snap.id),rate:'40',reason:'Original signed rate agreement confirms 40%'} as const;
    await assert.rejects(mutatePayroll(db,actors.administrator,correct),/Only an assigned Manager/);
    await mutatePayroll(db,actors.manager,correct);
    let entry=(await db.query("SELECT * FROM barber_commission_entries WHERE source_transaction_id=$1",[txId!])).rows[0];
    assert.equal(entry.original_price_centavos,'25000'); assert.equal(entry.amount_centavos,'10000');
    await db.query("SELECT accrue_payroll_commission($1)",[txId!]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM barber_commission_entries")).rows[0].n,1);
    const reference=(await db.query("SELECT reference FROM transactions WHERE id=$1",[txId!])).rows[0].reference;
    // Void replaced Refund: the sale is reversed and the earned commission is kept.
    await applyFinancialAction(db,reference,{action:'void',amount:200,reason:'Customer complaint'},actors.manager.id);
    assert.equal((await db.query("SELECT amount_centavos FROM barber_commission_entries WHERE source_transaction_id=$1",[txId!])).rows[0].amount_centavos,'10000');
    await assert.rejects(db.query("UPDATE barber_commission_entries SET amount_centavos=0 WHERE id=$1",[entry.id]),/immutable/);
    await assert.rejects(db.query("UPDATE payroll_service_snapshots SET rate_snapshot=99 WHERE id=$1",[snap.id]),/immutable/);
    await assert.rejects(mutatePayroll(db,actors.manager,correct),/separately approved adjustment/);
    await mutatePayroll(db,actors.manager,{action:'configure',branchId,anchorDate:'2026-08-01'});
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-02'}),/14-day calendar/);
    await Promise.all([mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'}),mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'})]);
    const record=(await db.query("SELECT * FROM payroll_records WHERE barber_id=$1",[barber])).rows[0];
    assert.equal(record.gross_centavos,'10000'); assert.equal((await db.query("SELECT count(*)::int AS n FROM payroll_record_entries")).rows[0].n,1);
    const rid=Number(record.id);
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'pay',branchId,recordId:rid,paidAt:new Date().toISOString(),paymentMethod:'cash'}),/approval is required/);
    await mutatePayroll(db,actors.manager,{action:'adjust',branchId,recordId:rid,amountCentavos:'-500',reason:'Approved equipment advance recovery'});
    await mutatePayroll(db,actors.administrator,{action:'submit',branchId,recordId:rid});
    await assert.rejects(mutatePayroll(db,actors.administrator,{action:'approve',branchId,recordId:rid}),/Only an assigned Manager/);
    await mutatePayroll(db,actors.manager,{action:'return',branchId,recordId:rid,reason:'Recheck equipment advance'});
    await mutatePayroll(db,actors.manager,{action:'submit',branchId,recordId:rid});
    await mutatePayroll(db,actors.manager,{action:'approve',branchId,recordId:rid});
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'adjust',branchId,recordId:rid,amountCentavos:'1',reason:'Unexpected edit'}),/Draft/);
    await assert.rejects(db.query("UPDATE payroll_records SET gross_centavos=0, payable_centavos=0 WHERE id=$1",[rid]),/locked/);
    const payment={action:'pay',branchId,recordId:rid,paidAt:new Date().toISOString(),paymentMethod:'bank_transfer',reference:'BANK-TEST-1'} as const;
    const paid=await Promise.allSettled([mutatePayroll(db,actors.manager,payment),mutatePayroll(db,actors.administrator,payment)]);
    assert.equal(paid.filter(r=>r.status==='fulfilled').length,1);
    const details=await readPayroll(db,actors.manager,payrollQuerySchema.parse({branchId,recordId:rid}));
    assert.ok('record' in details); if('record' in details) {
      assert.equal(details.record.status,'paid'); assert.equal(details.payment.amount_centavos,'9500');
      assert.equal(details.record.approved_by,actors.manager.id); assert.equal(details.entries![0].transaction_status,'voided');
      assert.deepEqual(details.events!.map(e=>e.action),['generate','adjust','submit','return','submit','approve','pay']);
    }
    await assert.rejects(readPayroll(db,actors.front_desk,payrollQuerySchema.parse({branchId})),/Management/);
    const otherBranch=(await db.query("INSERT INTO branches(name,code) VALUES('Other','PAYROLL-OTHER') RETURNING id")).rows[0].id;
    await assert.rejects(readPayroll(db,actors.manager,payrollQuerySchema.parse({branchId:otherBranch})),/access to this branch/);
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'configure',branchId:otherBranch,anchorDate:'2026-08-01'}),/access to this branch/);
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'approve',branchId:otherBranch,recordId:rid}),/access to this branch/);
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'pay',branchId:otherBranch,recordId:rid,paidAt:new Date().toISOString(),paymentMethod:'cash'}),/access to this branch/);
    // Rate snapshots are taken at completion, before checkout, not generation.
    async function bookingFor(bid:number,status='completed') {
      return (await db.query(`INSERT INTO bookings(customer_id,barber_id,service_id,service_name,service_price,booking_date,booking_time,status)
        VALUES($1,$2,'barracks-basic','Original haircut',250,'2026-08-20','09:00',$3) RETURNING id`,[customer,bid,status])).rows[0].id as number;
    }
    const forty=await bookingFor(barber);
    await mutatePayroll(db,actors.manager,{action:'rate',branchId,barberId:barber,rate:'45',reason:'New forward-only agreement'});
    const fortyfive=await bookingFor(barber); const fifty=await bookingFor(secondBarber);
    await mutatePayroll(db,actors.manager,{action:'rate',branchId,barberId:secondBarber,rate:'42.5',reason:'Fractional individual rate'});
    const fractional=await bookingFor(secondBarber);
    for(const [bid,expected] of [[forty,'10000'],[fortyfive,'11250'],[fifty,'12500'],[fractional,'10625']] as const) {
      const payment=await createTransaction(db,{visit:{bookingId:bid},paymentMethod:'card'},actors.front_desk.id);
      assert.equal((await db.query("SELECT amount_centavos FROM barber_commission_entries WHERE source_transaction_id=$1",[payment.id])).rows[0].amount_centavos,expected);
      await assert.rejects(createTransaction(db,{visit:{bookingId:bid},paymentMethod:'card'},actors.front_desk.id),/already exists/);
    }
    for(const state of ['confirmed','in_progress','cancelled','no_show']) {
      const bid=await bookingFor(secondBarber,state);
      await assert.rejects(createTransaction(db,{visit:{bookingId:bid},paymentMethod:'card'},actors.front_desk.id),/completed visits/);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM payroll_service_snapshots WHERE booking_id=$1",[bid])).rows[0].n,0);
      await db.query("DELETE FROM bookings WHERE id=$1",[bid]);
    }
    const unpaid=await bookingFor(barber);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM barber_commission_entries e JOIN payroll_service_snapshots s ON s.id=e.snapshot_id WHERE s.booking_id=$1",[unpaid])).rows[0].n,0);
    await db.query("UPDATE services SET current_price=999 WHERE id='barracks-basic'");
    await db.query("UPDATE barbers SET branch_id=$2 WHERE id=$1",[barber,otherBranch]);
    entry=(await db.query("SELECT * FROM barber_commission_entries WHERE source_transaction_id=$1",[txId!])).rows[0];
    assert.equal(entry.amount_centavos,'10000'); assert.equal(entry.branch_id,branchId);
    // Late historical qualification belongs to its earned period and gets a
    // separately approved supplement, never changing the paid record.
    const late=(await db.query(`INSERT INTO queue_entries(customer_id,barber_id,service_id,status,started_at,completed_at,branch_id)
      VALUES($1,$2,'barracks-basic','completed','2026-08-03T01:00:00Z','2026-08-03T01:45:00Z',$3) RETURNING id`,[customer,secondBarber,branchId])).rows[0].id;
    // This service predates activation and therefore has no rate snapshot.
    const lateSnap=(await db.query("SELECT * FROM payroll_service_snapshots WHERE queue_entry_id=$1",[late])).rows[0];
    assert.equal(lateSnap.rate_snapshot,null);
    const lateClient=await db.connect();
    try {
      await lateClient.query('BEGIN');
      const lateTx=(await lateClient.query(`INSERT INTO transactions(customer_id,queue_entry_id,visit_type,visit_record_id,barber_id,service_id,customer_name,barber_name,service_name,amount,payment_method,status,branch_id,created_at)
        VALUES($1,$2,'queue',$2,$3,'barracks-basic','Customer','Mark Barber','Cut',999,'card','completed',$4,'2026-08-03T02:00:00Z') RETURNING id`,[customer,late,secondBarber,branchId])).rows[0].id;
      await lateClient.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,created_at) VALUES($1,'card',999,'completed','2026-08-03T02:00:00Z')",[lateTx]);
      await lateClient.query('COMMIT');
    } finally { lateClient.release(); }
    await mutatePayroll(db,actors.manager,{action:'correct_snapshot',branchId,snapshotId:Number(lateSnap.id),rate:'40',reason:'Verified historical 40%'});
    await mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'});
    const markRecord=(await db.query("SELECT * FROM payroll_records WHERE barber_id=$1 AND supplemental_to IS NULL",[secondBarber])).rows[0];
    await mutatePayroll(db,actors.manager,{action:'submit',branchId,recordId:Number(markRecord.id)});
    await mutatePayroll(db,actors.manager,{action:'approve',branchId,recordId:Number(markRecord.id)});
    async function historicalQueue(completedAt:string,paidAt:string) {
      const q=(await db.query(`INSERT INTO queue_entries(customer_id,barber_id,service_id,status,started_at,completed_at,branch_id)
        VALUES($1,$2,'barracks-basic','completed',$3::timestamptz-interval '45 minutes',$3,$4) RETURNING id`,[customer,secondBarber,completedAt,branchId])).rows[0].id;
      const client=await db.connect();
      try {
        await client.query('BEGIN');
        const t=(await client.query(`INSERT INTO transactions(customer_id,queue_entry_id,visit_type,visit_record_id,barber_id,service_id,customer_name,barber_name,service_name,amount,payment_method,status,branch_id,created_at)
          VALUES($1,$2,'queue',$2,$3,'barracks-basic','Customer','Mark Barber','Cut',999,'card','completed',$4,$5) RETURNING id`,[customer,q,secondBarber,branchId,paidAt])).rows[0].id;
        await client.query("INSERT INTO transaction_payments(transaction_id,payment_method,amount,status,created_at) VALUES($1,'card',999,'completed',$2)",[t,paidAt]);
        await client.query('COMMIT');
      } finally {client.release();}
      const snapshot=(await db.query("SELECT id FROM payroll_service_snapshots WHERE queue_entry_id=$1",[q])).rows[0].id;
      await mutatePayroll(db,actors.manager,{action:'correct_snapshot',branchId,snapshotId:Number(snapshot),rate:'40',reason:'Signed historical rate evidence'});
      return snapshot as string;
    }
    await historicalQueue('2026-08-04T01:45:00Z','2026-08-04T02:00:00Z');
    await mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'});
    const supplement=(await db.query("SELECT * FROM payroll_records WHERE supplemental_to=$1",[markRecord.id])).rows[0];
    assert.ok(supplement); assert.equal(supplement.status,'draft'); assert.equal(supplement.gross_centavos,'39960');
    assert.equal((await db.query("SELECT gross_centavos,status FROM payroll_records WHERE id=$1",[markRecord.id])).rows[0].status,'approved');
    await mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'});
    assert.equal((await db.query("SELECT count(*)::int AS n FROM payroll_records WHERE supplemental_to=$1",[markRecord.id])).rows[0].n,1);
    const boundary=await historicalQueue('2026-08-14T15:59:00Z','2026-08-14T16:00:00Z');
    await mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-01'});
    assert.equal((await db.query("SELECT count(*)::int AS n FROM payroll_record_entries x JOIN barber_commission_entries e ON e.id=x.commission_entry_id WHERE e.snapshot_id=$1",[boundary])).rows[0].n,0);
    await mutatePayroll(db,actors.manager,{action:'generate',branchId,periodStart:'2026-08-15'});
    assert.equal((await db.query("SELECT p.period_start::text FROM payroll_record_entries x JOIN barber_commission_entries e ON e.id=x.commission_entry_id JOIN payroll_records r ON r.id=x.payroll_record_id JOIN payroll_periods p ON p.id=r.payroll_period_id WHERE e.snapshot_id=$1",[boundary])).rows[0].period_start,'2026-08-15');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM payroll_records WHERE barber_id=$1 AND supplemental_to IS NULL",[barber])).rows[0].n,1);
    assert.equal((await db.query("SELECT payable_centavos FROM payroll_records WHERE id=$1",[rid])).rows[0].payable_centavos,'9500');
    const manual=await mutatePayroll(db,actors.manager,{action:'supplement',branchId,recordId:rid,reason:'Correct a proven recording error after disbursement'});
    assert.ok(manual.recordId);
    await mutatePayroll(db,actors.manager,{action:'adjust',branchId,recordId:Number(manual.recordId),amountCentavos:'200',reason:'Additional original commission evidenced by source record'});
    const correctionAdjustment=(await db.query("SELECT * FROM payroll_adjustments WHERE payroll_record_id=$1",[manual.recordId])).rows[0];
    assert.equal(correctionAdjustment.source_record_id,record.id);
    await assert.rejects(mutatePayroll(db,actors.manager,{action:'adjust',branchId,recordId:Number(manual.recordId),sourceRecordId:Number(markRecord.id),amountCentavos:'100',reason:'Wrong barber source'}),/same barber and branch/);
    await mutatePayroll(db,actors.manager,{action:'submit',branchId,recordId:Number(manual.recordId)});
    await mutatePayroll(db,actors.manager,{action:'approve',branchId,recordId:Number(manual.recordId)});
    assert.equal((await db.query("SELECT payable_centavos FROM payroll_records WHERE id=$1",[rid])).rows[0].payable_centavos,'9500');
    await db.query("DELETE FROM bookings WHERE id=$1",[historyBooking]);
    const retained=(await db.query("SELECT * FROM payroll_service_snapshots WHERE id=$1",[snap.id])).rows[0];
    assert.equal(retained.booking_id,null); assert.equal(retained.visit_record_id,String(historyBooking)); assert.equal(retained.original_price_centavos,'25000');
    const overview=await readPayroll(db,actors.manager,payrollQuerySchema.parse({branchId}));
    assert.ok('currentEarnings' in overview);
    if('currentEarnings' in overview) {
      assert.equal(overview.currentEarnings!.reduce((sum,e)=>sum+e.service_count,0),4);
      assert.equal(overview.currentEarnings!.reduce((sum,e)=>sum+BigInt(e.gross_centavos),BigInt(0)).toString(),'44375');
      assert.ok(overview.barbers!.some(b=>b.id===barber),'Transferred barbers remain searchable in their source branch');
      assert.ok(overview.corrections!.length>=4);
    }
    const tables=(await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname LIKE 'payroll_%' AND relkind='r'")).rows;
    assert.ok(tables.length>=9); assert.ok(tables.every(t=>t.relrowsecurity));
    const privileges=await db.query("SELECT has_table_privilege('anon','payroll_records','SELECT') AS anon_read,has_table_privilege('authenticated','payroll_records','SELECT') AS user_read");
    assert.equal(privileges.rows[0].anon_read,false); assert.equal(privileges.rows[0].user_read,false);
  } finally {await cleanup();}
});
