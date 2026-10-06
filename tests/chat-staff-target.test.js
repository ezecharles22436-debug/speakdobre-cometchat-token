const test=require('node:test'),assert=require('node:assert/strict');
const previousOrigins=process.env.ALLOWED_ORIGINS;
process.env.ALLOWED_ORIGINS='https://speakdobre.webflow.io';
test.after(()=>{if(previousOrigins===undefined)delete process.env.ALLOWED_ORIGINS;else process.env.ALLOWED_ORIGINS=previousOrigins;});
const {createHandler}=require('../api/chat-staff-target');const {ROOMS}=require('../api/_chat-room-policy');
const env={VERCEL_ENV:'preview',COMETCHAT_APP_ID:'168437005e7f6fa2a',CHAT_STAFF_TARGET_ENABLED:'true',CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_PERMISSIONS_VERIFIED:'true',CHAT_SUPER_MODERATOR_IDS:'mem_owner'};
async function run(changes={}) {
  const deps={env,verifyMember:async()=>({memberId:'mem_owner'}),getMember:async id=>({id}),access:()=>({allowed:true}),chat:{user:async uid=>({uid,role:uid==='mem_owner'?'super_moderator':'student'}),memberships:async uid=>[{guid:ROOMS[0].guid,scope:uid==='mem_owner'?'admin':'participant'}]},...changes};
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){}};
  await createHandler(deps)({method:'POST',headers:{origin:'https://speakdobre.webflow.io','content-type':'application/json'},body:{targetUid:'mem_student',roomGuid:ROOMS[0].guid}},res);return res;
}
test('verified staff target returns only selected identifiers, not personal data',async()=>{const r=await run();assert.equal(r.statusCode,200);assert.deepEqual(r.body.target,{uid:'mem_student'});});
test('mismatched environment and disabled feature cannot authorize even with valid actor',async()=>{for(const change of [{VERCEL_ENV:'production'},{CHAT_STAFF_TARGET_ENABLED:'false'},{COMETCHAT_APP_ID:'production'}])assert.equal((await run({env:{...env,...change}})).statusCode,503);});
test('production requires its exact app and rejects Test Mode actors',async()=>{
  const live={...env,VERCEL_ENV:'production',COMETCHAT_APP_ID:'1677376866e3f736f'};
  assert.equal((await run({env:live})).statusCode,200);
  assert.equal((await run({env:live,verifyMember:async()=>({memberId:'mem_sb_owner'})})).statusCode,403);
});
test('students cannot use staff target endpoint',async()=>{assert.equal((await run({verifyMember:async()=>({memberId:'mem_student'})})).statusCode,403);});
test('inactive target cannot be authorized',async()=>{assert.equal((await run({access:()=>({allowed:false})})).statusCode,403);});
test('nonshared group and provider role mismatch fail closed',async()=>{
  assert.equal((await run({chat:{user:async()=>({role:'student'})}})).statusCode,503);
  assert.equal((await run({chat:{user:async()=>({role:'super_moderator'}),memberships:async()=>[]}})).statusCode,403);
});
