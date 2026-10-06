const shared = require('./_trial-booking-shared');
const { getPracticeChatAccess } = require('./cometchat-token');
const { roleForMember, ROOMS } = require('./_chat-room-policy');
const { trustedStaffConfig } = require('./_chat-room-staff');
const { createRoomProvider } = require('./_chat-room-provider');
const { roomReleaseReady } = require('./_chat-room-release');

// Read-only, default-off authorization. No user enumeration, invitations or calls.
function createHandler(deps = {}) {
  const env = deps.env || process.env;
  return async (req,res) => {
    shared.setCors(req,res,'POST, OPTIONS');res.setHeader('Cache-Control','no-store');
    if(req.method==='OPTIONS')return res.status(204).end();
    if(req.method!=='POST')return res.status(405).json({error:'Метод не підтримується.'});
    if(env.VERCEL_ENV!=='preview'||env.COMETCHAT_APP_ID!=='168437005e7f6fa2a'||env.CHAT_STAFF_TARGET_ENABLED!=='true'||!roomReleaseReady(env))return res.status(503).json({error:'Контакти тимчасово недоступні.'});
    try {
      shared.assertAllowedOrigin(req);shared.assertJsonRequest(req);
      const {memberId}=await (deps.verifyMember||shared.verifyMember)(req);
      const {config}=trustedStaffConfig(env),role=roleForMember(memberId,config);
      if(!['moderator','super_moderator'].includes(role))return res.status(403).json({error:'Контакт недоступний.'});
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(!body||Object.keys(body).some(k=>!['targetUid','roomGuid'].includes(k))||!/^mem_[A-Za-z0-9_-]{1,96}$/.test(body.targetUid||'')||!ROOMS.some(r=>r.guid===body.roomGuid))return res.status(400).json({error:'Некоректний запит.'});
      if(body.targetUid===memberId||roleForMember(body.targetUid,config)!=='student')return res.status(403).json({error:'Контакт недоступний.'});
      const chat=deps.chat||createRoomProvider();
      const actor=await chat.user(memberId);
      if(actor.role!==role)throw Error('role mismatch');
      const actorGroups=await chat.memberships(memberId);
      if(!actorGroups.some(r=>r.guid===body.roomGuid&&['admin','moderator'].includes(r.scope)))return res.status(403).json({error:'Контакт недоступний.'});
      const member=await (deps.getMember||shared.getMemberstackMember)(body.targetUid);
      if(member?.id!==body.targetUid||!(deps.access||getPracticeChatAccess)(member).allowed)return res.status(403).json({error:'Контакт недоступний.'});
      const target=await chat.user(body.targetUid),groups=await chat.memberships(body.targetUid);
      if(target.role!=='student'||!groups.some(r=>r.guid===body.roomGuid))return res.status(403).json({error:'Контакт недоступний.'});
      return res.status(200).json({actor:{uid:memberId,role},target:{uid:body.targetUid},roomGuid:body.roomGuid});
    } catch(error) {
      const status=error instanceof SyntaxError?400:[400,401,403,413,415].includes(error.status)?error.status:503;
      return res.status(status).json({error:'Не вдалося перевірити контакт.'});
    }
  };
}
module.exports=createHandler();module.exports.createHandler=createHandler;
