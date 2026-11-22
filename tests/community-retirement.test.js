const {test}=require('node:test'),assert=require('node:assert/strict');
const {retired}=require('../api/_community-retirement');
const env={COMMUNITY_RETIREMENT_ENABLED:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/memberstack-retirement'};
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(){return this;}});
test('retirement is default-off and cannot activate on production',()=>{
 let res=response();assert.equal(retired({headers:{}},res,{}),false);assert.equal(res.code,undefined);
 res=response();assert.equal(retired({headers:{}},res,{...env,VERCEL_ENV:'production'}),true);assert.equal(res.code,503);
});
test('isolated retirement sends visitors to Telegram without account or chat calls',async()=>{
 const old={...process.env};Object.assign(process.env,env);const fetchBefore=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('No network allowed');};
 try {
  for(const name of ['cometchat-token','chat-rooms','chat-owner-access','chat-staff-target','cloudinary-upload-signature','verified-registration']){
   const res=response();await require('../api/'+name)({method:'POST',headers:{origin:'https://speakdobre.webflow.io'}},res);
   assert.equal(res.code,410,name);assert.equal(res.body.communityUrl,'https://t.me/speakdobre_english');assert.equal(res.headers['Cache-Control'],'no-store');
  }
  assert.equal(calls,0);
 } finally {global.fetch=fetchBefore;for(const k of Object.keys(env)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});
test('staging retirement supports preflight without authorizing other origins',()=>{
 let res=response();retired({method:'OPTIONS',headers:{origin:'https://speakdobre.webflow.io'}},res,env);assert.equal(res.code,204);assert.equal(res.headers['Access-Control-Allow-Origin'],'https://speakdobre.webflow.io');
 res=response();retired({method:'GET',headers:{origin:'https://evil.invalid'}},res,env);assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
});
test('production retirement requires the production main branch and permits only live origins',()=>{
 const live={...env,VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main'};
 let res=response();retired({method:'GET',headers:{origin:'https://www.speakdobre.com'}},res,live);assert.equal(res.code,410);assert.equal(res.headers['Access-Control-Allow-Origin'],'https://www.speakdobre.com');
 res=response();retired({method:'GET',headers:{origin:'https://speakdobre.webflow.io'}},res,live);assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
 res=response();retired({method:'GET',headers:{}},res,{...live,VERCEL_GIT_COMMIT_REF:'unreviewed'});assert.equal(res.code,503);
});
