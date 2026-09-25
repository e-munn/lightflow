import assert from 'node:assert/strict';
import http from 'node:http';
const url='http://127.0.0.1:3001/api/jev';
const post=(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
assert.equal((await post('{}',{'Origin':'https://unrelated.example'})).status,403);
// Node fetch normalizes Host; use a raw request to exercise this boundary.
const invalidHostStatus=await new Promise((resolve,reject)=>{
  const request=http.request(url,{method:'POST',headers:{Host:'unrelated.example','Content-Type':'application/json'}},response=>{response.resume();resolve(response.statusCode);});
  request.on('error',reject);request.end('{}');
});
assert.equal(invalidHostStatus,403);
assert.equal((await post('{}',{'Content-Type':'text/plain'})).status,415);
assert.equal((await post('{bad json')).status,400);
assert.equal((await post(JSON.stringify({state:'an arbitrary paid prompt'}))).status,400);
assert.equal((await post('x'.repeat(9000))).status,413);
assert.equal((await fetch(url)).status,405);
console.log('Passed: local host restriction, same-origin checks, JSON-only requests, malformed/extra input rejection, size cap, POST-only endpoint. No model calls used.');
