'use strict';
// Preview-only retirement. The assessment and existing payment revocation routes stay intact.
function retired(req,res,env=process.env) {
 if(env.COMMUNITY_RETIREMENT_ENABLED!=='true'){
  if(env.VERCEL_ENV==='preview' && env.VERCEL_GIT_COMMIT_REF==='codex/memberstack-retirement'){res.status(503).json({error:'Ізольована перевірка ще не налаштована.'});return true;}
  return false;
 }
 const isolated=env.VERCEL_ENV==='preview' && env.VERCEL_GIT_COMMIT_REF==='codex/memberstack-retirement';
 const production=env.VERCEL_ENV==='production' && env.VERCEL_GIT_COMMIT_REF==='main';
 res.setHeader('Cache-Control','no-store');
 if((production?['https://www.speakdobre.com','https://speakdobre.com']:['https://speakdobre.webflow.io']).includes(req.headers?.origin)) {
  res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 }
 if(!isolated&&!production){res.status(503).json({error:'Перехід до спільноти ще не налаштовано.'});return true;}
 if(req.method==='OPTIONS'){res.status(204).end();return true;}
 res.status(410).json({code:'COMMUNITY_MOVED',error:'Спільнота SpeakDobre тепер у Telegram. Реєстрація на сайті не потрібна.',communityUrl:'https://t.me/speakdobre_english'});
 return true;
}
module.exports={retired};
