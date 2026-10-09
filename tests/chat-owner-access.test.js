const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('../api/chat-owner-access');
const oldOrigins=process.env.ALLOWED_ORIGINS;
process.env.ALLOWED_ORIGINS='https://speakdobre.webflow.io';
test.after(()=>{if(oldOrigins===undefined)delete process.env.ALLOWED_ORIGINS;else process.env.ALLOWED_ORIGINS=oldOrigins;});
const env={VERCEL_ENV:'preview',COMETCHAT_APP_ID:'168437005e7f6fa2a',CHAT_OWNER_MANAGEMENT_ENABLED:'true',CHAT_ROOMS_ENABLED:'true',CHAT_ROOMS_PERMISSIONS_VERIFIED:'true',CHAT_SUPER_MODERATOR_IDS:'mem_sb_owner',CHAT_MODERATOR_IDS:'mem_sb_mod'};
async function run(overrides={},body={targetUid:'mem_sb_student',action:'status'}) {
  const writes=[];
  const deps={env,verifyMember:async()=>({memberId:'mem_sb_owner'}),getMember:async id=>({id}),
    chat:{user:async uid=>({uid,name:'Student',role:uid==='mem_sb_owner'?'super_moderator':'student'})},
    store:{read:async()=>({accessState:'suspended'}),writeAccess:async(...args)=>{writes.push(args);throw Error('unexpected write');}},...overrides};
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;},end(){}};
  await createHandler(deps)({method:'POST',headers:{origin:'https://speakdobre.webflow.io','content-type':'application/json'},body},res);
  return {...res,writes};
}
test('owner status is read-only and reports durable suspension',async()=>{const r=await run();assert.equal(r.statusCode,200);assert.equal(r.body.status,'suspended');assert.deepEqual(r.writes,[]);});
test('student and moderator cannot manage global chat access',async()=>{for(const memberId of ['mem_sb_student','mem_sb_mod'])assert.equal((await run({verifyMember:async()=>({memberId})})).statusCode,403);});
test('owner cannot target self, staff, or live accounts from Preview',async()=>{for(const targetUid of ['mem_sb_owner','mem_sb_mod','mem_live'])assert.equal((await run({},{targetUid,action:'suspend'})).statusCode,403);});
test('feature and exact environment gates fail closed',async()=>{for(const change of [{CHAT_OWNER_MANAGEMENT_ENABLED:'false'},{VERCEL_ENV:'production'},{COMETCHAT_APP_ID:'wrong'},{CHAT_ROOMS_PERMISSIONS_VERIFIED:'false'}])assert.equal((await run({env:{...env,...change}})).statusCode,503);});
test('untrusted provider owner role and disabled owner are denied',async()=>{for(const actor of [{role:'student'},{role:'super_moderator',deactivatedAt:1}])assert.equal((await run({chat:{user:async()=>actor}})).statusCode,403);});
test('client cannot supply roles or unknown actions',async()=>{for(const body of [{targetUid:'mem_sb_student',action:'delete'},{targetUid:'mem_sb_student',action:'suspend',role:'super_moderator'}])assert.equal((await run({},body)).statusCode,400);});
test('missing Memberstack student cannot be suspended',async()=>{assert.equal((await run({getMember:async()=>null},{targetUid:'mem_sb_student',action:'suspend'})).statusCode,404);});
