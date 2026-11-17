import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {beginWriteSavepoint} from './write-savepoint.mjs'
import {writeDepositConfig} from './deposit-switch.mjs'
const root=mkdtempSync(join(tmpdir(),'ll-config-lock-')),file=join(root,'probe.sqlite')
const a=new DatabaseSync(file),b=new DatabaseSync(file)
let n=0;const ok=name=>console.log(`ok ${++n} - ${name}`)
try {
 a.exec("PRAGMA journal_mode=WAL; CREATE TABLE tenant_settings(tenant_id TEXT,key TEXT,value TEXT,updated_at TEXT,PRIMARY KEY(tenant_id,key)); INSERT INTO tenant_settings VALUES('test','booking_rules','{\"onlineDeposit\":true,\"other\":7}','old'); CREATE TABLE audit(n); CREATE TRIGGER unchanged_guard AFTER UPDATE ON tenant_settings BEGIN INSERT INTO audit VALUES(1); END;")
 b.exec('PRAGMA busy_timeout=0')
 a.exec('SAVEPOINT old_deferred');a.prepare('SELECT * FROM tenant_settings').all()
 b.exec("UPDATE tenant_settings SET updated_at='concurrent'")
 assert.throws(()=>a.exec("UPDATE tenant_settings SET value='stale'"),/locked/)
 a.exec('ROLLBACK TO old_deferred; RELEASE old_deferred');ok('两个真实连接复现旧保存点读后写升级失败')
 const before=JSON.stringify(a.prepare('SELECT * FROM tenant_settings').all()),audit=a.prepare('SELECT count(*) n FROM audit').get().n
 beginWriteSavepoint(a,'config_edit','tenant_settings')
 assert.equal(JSON.stringify(a.prepare('SELECT * FROM tenant_settings').all()),before)
 assert.equal(a.prepare('SELECT count(*) n FROM audit').get().n,audit);ok('预留写锁不改记录且不触发行级审计')
 assert.throws(()=>b.exec("UPDATE tenant_settings SET value='interleaved'"),/locked/);ok('读取配置前已持有写锁，第二连接不能插入过期快照')
 writeDepositConfig(a,'test',{enabled:false},'new')
 assert.equal(JSON.parse(a.prepare("SELECT value FROM tenant_settings WHERE key='booking_rules'").get().value).onlineDeposit,false);ok('定金同步写入可嵌套在平台事务中')
 a.exec('ROLLBACK TO config_edit; RELEASE config_edit')
 assert.equal(JSON.stringify(a.prepare('SELECT * FROM tenant_settings').all()),before);ok('外层失败完整回滚内层配置及新增记录')
 writeDepositConfig(a,'test',{enabled:false},'new')
 const rules=JSON.parse(b.prepare("SELECT value FROM tenant_settings WHERE key='booking_rules'").get().value)
 assert.equal(rules.onlineDeposit,false);assert.equal(rules.other,7);ok('成功提交后第二连接立即读到新值并保留其他配置')
 b.exec('BEGIN IMMEDIATE')
 a.exec('PRAGMA busy_timeout=1')
 assert.throws(()=>beginWriteSavepoint(a,'blocked_edit','tenant_settings'),/locked/)
 b.exec('ROLLBACK')
 a.exec('BEGIN IMMEDIATE; ROLLBACK');ok('取锁失败清理保存点，不遗留事务')
 a.exec("CREATE TRIGGER fail_rules BEFORE UPDATE ON tenant_settings WHEN NEW.key='booking_rules' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")
 const snapshot=JSON.stringify(a.prepare('SELECT * FROM tenant_settings ORDER BY key').all())
 assert.throws(()=>writeDepositConfig(a,'test',{enabled:true},'fail'),/fixture failure/)
 assert.equal(JSON.stringify(a.prepare('SELECT * FROM tenant_settings ORDER BY key').all()),snapshot);ok('第二步失败时定金与预约开关同时回滚')
} finally {a.close();b.close();rmSync(root,{recursive:true,force:true})}
