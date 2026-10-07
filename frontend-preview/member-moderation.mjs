// Uses the existing server-authorized student picker; no new credentials or
// provider permissions. Provider scope/hierarchy remains the final authority.
export async function moderateGroupMember({sdk,identity,uid,roomGuid,action,check}) {
  if(!['kick','ban'].includes(action)||!['moderator','super_moderator'].includes(identity?.role)||uid===identity.uid||!/^mem_[A-Za-z0-9_-]{1,96}$/.test(uid))throw Error('Недоступно.');
  await check();
  const actor=await sdk.getLoggedInUser(),group=await sdk.getGroup(roomGuid),target=await sdk.getUser(uid);
  await check();
  if(actor?.getUid()!==identity.uid||actor.getRole()!==identity.role||group?.getGuid()!==roomGuid||!['admin','moderator'].includes(group.getScope())||target?.getUid()!==uid||target.getRole()!=='student')throw Error('Недоступно.');
  const result=await sdk[action==='kick'?'kickGroupMember':'banGroupMember'](roomGuid,uid);
  if(result!==true)throw Error('Не підтверджено.');
  return true;
}
