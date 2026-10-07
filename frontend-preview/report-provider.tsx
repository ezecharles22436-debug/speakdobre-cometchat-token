import React, { useMemo, useState } from 'react';
import { CometChat } from '@cometchat/chat-sdk-javascript';
import { CometChatProvider, CometChatFlagMessageDialog, defaultPlugins,
  useCometChatFlagMessageDialogContext } from '@cometchat/chat-uikit-react';
import { reportReasonLabel, reportErrorText, submitReport } from './report-policy.mjs';
import { addStaffDeleteOption, authorizeStaffDelete } from './moderation-policy.mjs';

function UkrainianReasons() {
  const {flagReasons,selectedReason,selectReason,isLoadingReasons,isLoading}=useCometChatFlagMessageDialogContext();
  if(isLoadingReasons)return <p role="status">Завантажуємо причини…</p>;
  if(!flagReasons.length)return <p role="alert">Причини скарги недоступні. Спробуйте пізніше.</p>;
  return <fieldset disabled={isLoading} style={{border:0,padding:0}}><legend>Оберіть причину</legend>
    {flagReasons.map(reason=><label key={reason.id} style={{display:'block',padding:'8px 0'}}>
      <input type="radio" name="sd-report-reason" checked={selectedReason?.id===reason.id}
        onChange={()=>selectReason(reason)}/> {reportReasonLabel(reason)}
    </label>)}
  </fieldset>;
}

type Moderation = {identity:{uid:string;role:string};roomGuid:string;getSession:()=>Promise<any>};
export function ReportProvider({children,moderation,...props}:React.ComponentProps<typeof CometChatProvider>&{moderation?:Moderation}) {
  const [message,setMessage]=useState<CometChat.BaseMessage|null>(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [moderationError,setModerationError]=useState('');
  const plugins=useMemo(()=>defaultPlugins.map(plugin=>({...plugin,
    getOptions:plugin.getOptions ? (item,context)=>{
      const options=plugin.getOptions!(item,{
      ...context,onFlagMessage:target=>{setError('');setNotice('');setMessage(target);},
      });
      if(!moderation)return options;
      return addStaffDeleteOption(options,{...moderation,group:context.group,message:item,
        hidden:context.hideDeleteMessageOption,
        onDelete:async()=>{
          setModerationError('');
          try{await authorizeStaffDelete({...moderation,message:item,sdk:CometChat});context.onDeleteMessage?.(item);}
          catch{setModerationError('Не вдалося перевірити права модератора. Відкрийте групу повторно.');}
        },
      });
    }:undefined,
  })),[moderation]);
  return <CometChatProvider {...props} plugins={plugins}>
    {children}
    {notice&&<p role="status">{notice}</p>}
    {moderationError&&<p role="alert">{moderationError}</p>}
    {message&&<CometChatFlagMessageDialog.Root message={message} isOpen onClose={()=>setMessage(null)}
      onSubmit={async(id,reason,remark)=>{
        setError('');
        try {await submitReport(CometChat,id,reason,remark);setNotice('Скаргу на повідомлення надіслано.');return true;}
        catch(failure){setError(reportErrorText(failure));return false;}
      }}>
      <CometChatFlagMessageDialog.Header />
      <UkrainianReasons />
      <CometChatFlagMessageDialog.Remark />
      {error&&<p role="alert">{error}</p>}
      <CometChatFlagMessageDialog.Actions />
    </CometChatFlagMessageDialog.Root>}
  </CometChatProvider>;
}
