import assert from "node:assert/strict";
import test from "node:test";
import { createDisposableSchema, databaseConfigured } from "./helpers/database";
import { createService, deleteService, findServiceById, updateService } from "@/server/services/service.service";
import { updateCustomer } from "@/server/services/customer.service";
import { addWalkIn, updateWalkInStatus } from "@/server/services/queue.service";
import { walkinCustomerProfileSchema, walkinCustomerStaffProfileSchema } from "@/server/schemas/sprint.schema";

test("unused services delete; used services archive and restore without losing queue history", { skip: !databaseConfigured }, async () => {
 const {db,cleanup}=await createDisposableSchema();
 try {
  const input={id:"sprint-probe",name:"Sprint probe",description:"Disposable",price:100,durationMinutes:15,active:true};
  assert.equal((await createService(db,input)).hasHistory,false);
  assert.equal(await deleteService(db,input.id),"deleted");
  assert.equal(await findServiceById(db,input.id),null);
  assert.equal(await deleteService(db,input.id),"not_found");
  await createService(db,input);
  const visit=await addWalkIn(db,{customer:{firstName:"Sprint",lastName:"Guest",phone:"09123456789"},serviceId:input.id});
  assert.equal((await findServiceById(db,input.id))?.hasHistory,true);
  assert.equal(await deleteService(db,input.id),"has_history");
  // A live queue visit locks the service; it can be archived once the visit leaves the queue.
  await assert.rejects(updateService(db,input.id,{active:false}),{code:"RECORD_LOCKED"});
  await updateWalkInStatus(db,visit.id,"removed");
  assert.equal((await updateService(db,input.id,{active:false}))?.active,false);
  assert.equal(await deleteService(db,input.id),"has_history");
  assert.equal(Number((await db.query("SELECT count(*) FROM queue_entries WHERE id=$1",[visit.id])).rows[0].count),1);
  assert.equal((await updateService(db,input.id,{active:true}))?.active,true);
 } finally {await cleanup();}
});

test("walk-in edits persist without creating accounts and preserve the loyalty card on contact-only edits", { skip: !databaseConfigured }, async()=>{
 const {db,cleanup}=await createDisposableSchema();
 try {
  const id=Number((await db.query("INSERT INTO customers(first_name,last_name,phone) VALUES('Before','Guest','09123456789') RETURNING id")).rows[0].id);
  const before=(await db.query("SELECT count(*) FROM users")).rows[0].count;
  const input={firstName:"After",lastName:"Guest",phone:"09123456780",preferredBarberId:null,loyaltyCardIssued:true};
  const manager=Number((await db.query("INSERT INTO users(first_name,last_name,email,password_hash,role_id) VALUES('Card','Manager','card.manager@test.local','x',(SELECT id FROM roles WHERE name='manager')) RETURNING id")).rows[0].id);
  assert.equal(walkinCustomerProfileSchema.safeParse(input).success,true);
  assert.equal(walkinCustomerStaffProfileSchema.safeParse(input).success,false);
  assert.equal(walkinCustomerProfileSchema.safeParse({...input,email:"unexpected@example.com"}).success,false);
  const saved=await updateCustomer(db,id,input,{id:manager,role:"manager"});
  assert.equal(saved?.firstName,"After");assert.equal(saved?.phone,input.phone);assert.equal(saved?.userId,null);assert.equal(saved?.email,"");assert.ok(saved?.loyaltyCard?.issuedAt);
  const contact={firstName:input.firstName,lastName:input.lastName,phone:input.phone,preferredBarberId:input.preferredBarberId};
  assert.equal(walkinCustomerStaffProfileSchema.safeParse(contact).success,true);
  assert.equal((await updateCustomer(db,id,{...contact,lastName:"Updated"}))?.loyaltyCard?.issuedAt,saved?.loyaltyCard?.issuedAt);
  assert.equal(Number((await db.query("SELECT count(*) FROM users")).rows[0].count),Number(before)+1);
 } finally {await cleanup();}
});
