const test=require('node:test'),assert=require('node:assert/strict');
const endpoint='https://speakdobre-cometchat-git-db9a07-ezecharles22436-4127s-projects.vercel.app/api/chat-staff-target';
test('staff client sends Memberstack credential only to pinned preview endpoint without redirects',async()=>{
 const {createStaffTargetClient}=await import('./staff-target-client.mjs');let request;
 const client=createStaffTargetClient({endpoint,getMemberstackToken:async()=> 'synthetic',fetcher:async(url,options)=>{request={url,...options};return{ok:true,json:async()=>({target:{uid:'mem_student'}})};}});
 await client({uid:'mem_student',roomGuid:'room'});assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');assert.deepEqual(JSON.parse(request.body),{targetUid:'mem_student',roomGuid:'room'});
});
test('production or arbitrary host and credential-bearing URLs are rejected before reading token',async()=>{
 const {createStaffTargetClient}=await import('./staff-target-client.mjs');for(const url of ['https://example.com/api/chat-staff-target',endpoint+'?secret=x',endpoint.replace('https://','https://user:pass@')])assert.throws(()=>createStaffTargetClient({endpoint:url,getMemberstackToken:()=>assert.fail()}));
});
test('missing login sends no request',async()=>{
 const {createStaffTargetClient}=await import('./staff-target-client.mjs');const client=createStaffTargetClient({endpoint,getMemberstackToken:async()=>null,fetcher:()=>assert.fail()});await assert.rejects(client({uid:'x',roomGuid:'y'}));
});
