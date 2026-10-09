// Linux CI cannot run macOS WeChat DevTools. Verify the separately executed
// local evidence and the exact sources it covered; never call this a CI UI run.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url)
const read=p=>readFileSync(new URL(p,root))
const hash=b=>createHash('sha256').update(b).digest('hex')
const evidence=JSON.parse(read('handoff/release-20261009/native-layout.json'))
assert.deepEqual(evidence.suites.map(s=>[s.suite,s.assertions,s.status]),[
  ['mp-placeholder-size',3,'passed'],['mp-overlap',4,'passed'],['mp-home-sections',9,'passed']])
assert.ok(Object.keys(evidence.files).length>30)
for(const [path,expected] of Object.entries(evidence.files)) assert.equal(hash(read(path)),expected,'Native layout evidence is stale: '+path)
for(const suite of evidence.suites) {
  const log=read(suite.log)
  assert.equal(hash(log),suite.sha256,'Changed native test log')
  assert.equal((log.toString().match(/^ok\s+\d+/gm)||[]).length,suite.assertions)
  assert.ok(!/^not ok/m.test(log.toString()))
}
console.log('Verified recorded local native evidence: 3 suites / 16 assertions. No native tests executed in this CI job.')
