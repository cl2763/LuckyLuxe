// Regression fixtures use the real pending-only migration entry, never the retired CSV writer.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { assertTestTarget } from './test-guard.mjs'
export async function pendingCustomerFixture(request, tenantId, rows, { baseUrl = process.env.TEST_BASE_URL, dbPath = process.env.TEST_DB_PATH } = {}) {
  await assertTestTarget(baseUrl)
  if (!dbPath) throw new Error('Isolated TEST_DB_PATH required')
  const sourceSystem = 'fixture-' + randomUUID()
  const pkg = { packageType:'youji-customer-migration-v1',schemaVersion:1,sourceSystem,sourceExportedAt:'2020-01-01T00:00:00Z',dataCutoffAt:'2020-01-01T00:00:00Z',sourceTimezone:'Asia/Shanghai',merchantConfirmedAt:'2020-01-02T00:00:00Z',mode:'initial',records:rows.map((mapped,i)=>({sourceRecordId:String(i),mapped,source:{},details:{cards:[],gifts:[],transactions:[],serviceNotes:[],attachments:[]},review:{}})) }
  const path = `/platform/tenants/${tenantId}/migrations`
  const preview = await request(path+'/preview',{method:'POST',body:JSON.stringify({package:pkg})})
  if(preview.status!==200)throw new Error('Fixture preview: '+JSON.stringify(preview.data))
  const result = await request(path+'/execute',{method:'POST',body:JSON.stringify({package:pkg,confirmPendingOnly:true,confirmPackageHash:preview.data.report.packageHash,confirmOpeningBalanceCents:rows.reduce((s,r)=>s+(r.balanceCents||0),0),confirmImportCount:rows.length,confirmExcludedCount:0})})
  if(result.status!==200)throw new Error('Fixture execute: '+JSON.stringify(result.data))
  const db = new DatabaseSync(dbPath,{readOnly:true})
  try{return rows.map((_,i)=>{const row=db.prepare('SELECT user_id FROM customer_migration_links WHERE tenant_id=? AND source_system=? AND source_record_id=?').get(tenantId,sourceSystem,String(i));if(!row)throw new Error('Fixture link missing');return row.user_id})}finally{db.close()}
}
