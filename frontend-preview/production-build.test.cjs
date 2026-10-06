const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('production session is fixed to live host and rejects Test Mode IDs',async()=>{
  const {productionSource}=await import('./production-build.mjs');
  const source=productionSource(fs.readFileSync('preview-session-client.mjs','utf8'),'preview-session-client.mjs');
  const {createPreviewSessionClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let requests=0;
  const memberstack={getCurrentMember:async()=>({data:{id:'mem_sb_test'}}),getMemberCookie:async()=>'synthetic'};
  assert.throws(()=>createPreviewSessionClient({pageOrigin:'https://speakdobre.webflow.io',memberstack}));
  const client=createPreviewSessionClient({pageOrigin:'https://www.speakdobre.com',memberstack,fetcher:async()=>{requests++;}});
  await assert.rejects(client.getSession());assert.equal(requests,0);
  memberstack.getCurrentMember=async()=>({data:{id:'mem_live'}});
  const live=createPreviewSessionClient({pageOrigin:'https://www.speakdobre.com',memberstack,fetcher:async(url,options)=>{
    assert.equal(url,'https://speakdobre-cometchat-token.vercel.app/api/cometchat-token');
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    return{ok:true,json:async()=>({token:'synthetic',user:{uid:'mem_live',role:'student'},rooms:[],staffContacts:[]})};
  }});assert.equal((await live.getSession()).user.uid,'mem_live');
});
test('production transform only changes reviewed files and preserves Preview sources',async()=>{
  const {productionSource}=await import('./production-build.mjs');
  for(const name of ['chat.tsx','preview-host.mjs','call-session.mjs','incoming-calls.mjs','outgoing-calls.mjs']){
    const source=fs.readFileSync(name,'utf8'),live=productionSource(source,name);
    assert.ok(source.includes('168437005e7f6fa2a'));assert.ok(live.includes('1677376866e3f736f'));
    assert.ok(!live.includes('168437005e7f6fa2a'));
  }
  assert.equal(productionSource('168437005e7f6fa2a','unreviewed.mjs'),'168437005e7f6fa2a');
});
