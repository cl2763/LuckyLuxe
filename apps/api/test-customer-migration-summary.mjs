import {DatabaseSync} from 'node:sqlite'
import assert from 'node:assert/strict'
import {customerMigrationSummary} from './customer-migration-summary.mjs'
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE migration_pending_balances(tenant_id TEXT,user_id TEXT,status TEXT);
CREATE TABLE customer_legacy_assets(id TEXT,tenant_id TEXT,user_id TEXT,raw_json TEXT);
CREATE TABLE migration_asset_activations(asset_id TEXT,tenant_id TEXT,user_id TEXT,review_json TEXT);`)
let n=0;const check=(name,f)=>{f();console.log('ok',++n,name)}
check('empty customer has no pending notice',()=>assert.equal(customerMigrationSummary(db,'A','u').hasPending,false))
db.exec(`INSERT INTO migration_pending_balances VALUES('A','u','pending');INSERT INTO customer_legacy_assets VALUES('asset','A','u','secret phone and internal note');`)
check('pending appears without changing redemption availability',()=>{const s=customerMigrationSummary(db,'A','u');assert.equal(s.hasPending,true);assert.equal(s.redeemable,false)})
check('projection contains no raw source, amount, identity or evidence',()=>{const s=customerMigrationSummary(db,'A','u');assert.deepEqual(Object.keys(s).sort(),['hasPending','message','redeemable','status','title']);assert.ok(!JSON.stringify(s).includes('secret'))})
check('both customer and tenant scope enforced',()=>{assert.equal(customerMigrationSummary(db,'B','u').hasPending,false);assert.equal(customerMigrationSummary(db,'A','v').hasPending,false)})
check('confirmed balance alone cannot hide still-unreviewed source card',()=>{db.exec("UPDATE migration_pending_balances SET status='active'");assert.equal(customerMigrationSummary(db,'A','u').hasPending,true)})
check('confirmed source no longer pending; foreign confirmation cannot hide it',()=>{db.exec("INSERT INTO migration_asset_activations VALUES('asset','B','u','private')");assert.equal(customerMigrationSummary(db,'A','u').hasPending,true);db.exec("INSERT INTO migration_asset_activations VALUES('asset','A','u','private')");assert.equal(customerMigrationSummary(db,'A','u').hasPending,false)})
console.log(n+' customer migration projection checks passed');db.close()
