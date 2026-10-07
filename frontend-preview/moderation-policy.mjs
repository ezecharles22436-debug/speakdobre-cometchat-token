const staffRoles = new Set(['moderator', 'super_moderator']);
const staffScopes = new Set(['admin', 'moderator']);

// UI eligibility is not authorization. CometChat still enforces permissions
// when its normal confirmation dialog submits the deletion request.
export function canOfferStaffDelete({identity, roomGuid, group, message}) {
  return Boolean(identity?.uid && staffRoles.has(identity.role) && roomGuid &&
    group?.getGuid?.() === roomGuid && staffScopes.has(group.getScope?.()) &&
    message?.getReceiverType?.() === 'group' && message.getReceiverId?.() === roomGuid &&
    message.getCategory?.() === 'message' && !message.getDeletedAt?.() &&
    message.getSender?.()?.getUid?.() !== identity.uid);
}

export async function authorizeStaffDelete({identity, roomGuid, message, getSession, sdk}) {
  const checkSession = async () => {
    const session = await getSession();
    if (!session?.token || !staffRoles.has(identity?.role) ||
        session.user?.uid !== identity.uid || session.user.role !== identity.role ||
        !session.rooms?.some(room => room.guid === roomGuid && room.unlocked === true)) {
      throw Error('Доступ до модерації змінився. Відкрийте групу повторно.');
    }
  };
  await checkSession();
  const actor = await sdk.getLoggedInUser();
  const group = await sdk.getGroup(roomGuid);
  await checkSession();
  if (actor?.getUid?.() !== identity.uid || actor.getRole?.() !== identity.role ||
      !canOfferStaffDelete({identity, roomGuid, group, message})) {
    throw Error('Видалення цього повідомлення недоступне.');
  }
  return true;
}

export function addStaffDeleteOption(options, {identity, roomGuid, group, message, onDelete, hidden}) {
  if (hidden || options.some(option => option.id === 'delete') ||
      !canOfferStaffDelete({identity, roomGuid, group, message})) return options;
  return [...options, {id:'delete', title:'Видалити повідомлення', groupOnly:true,
    onClick: onDelete}];
}
