import test from 'node:test';
import assert from 'node:assert/strict';
import { reportReasonLabel, reportErrorText, submitReport } from './report-policy.mjs';

test('report reasons are Ukrainian without changing provider identity', () => {
  for (const name of ['Spam', 'Spam / Unwanted Content', 'Sexual Content', 'Harassment / Bullying', 'Future reason']) {
    const reason = { id: 'unchanged-id', name };
    assert.match(reportReasonLabel(reason), /[А-Яа-яІіЇїЄє]/);
    assert.equal(reason.id, 'unchanged-id'); assert.equal(reason.name, name);
  }
});
test('report error reveals only a bounded machine code, never raw provider details', () => {
  assert.match(reportErrorText({code:'ERR_PERMISSION_DENIED',message:'secret'}), /ERR_PERMISSION_DENIED/);
  assert.doesNotMatch(reportErrorText({code:'token=secret',details:'private',message:'secret'}), /secret|private/);
});
test('report submission retains reason ID and requires confirmed success', async () => {
  let args;
  assert.equal(await submitReport({flagMessage:async(...values)=>{args=values;return {success:true};}}, 123, 'reason-original', ' hello '), true);
  assert.deepEqual(args, ['123',{reasonId:'reason-original',remark:'hello'}]);
  await assert.rejects(submitReport({flagMessage:async()=>({success:false})},123,'reason'));
  await assert.rejects(submitReport({flagMessage:async()=>undefined},123,'reason'));
});
test('report remarks are bounded and blank remarks omitted', async () => {
  let payload;
  const sdk={flagMessage:async(id,data)=>{payload=data;return {success:true};}};
  await submitReport(sdk,'1','r','x'.repeat(700));assert.equal(payload.remark.length,500);
  await submitReport(sdk,'1','r','  ');assert.deepEqual(payload,{reasonId:'r'});
  await assert.rejects(submitReport(sdk,'','r',''));
});
