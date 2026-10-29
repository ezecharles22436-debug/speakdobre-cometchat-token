const test=require('node:test');
const assert=require('node:assert/strict');
const {assessmentLocation}=require('../api/_assessment-location');
const handler=require('../api/assessment');
const valid={submissionId:'123e4567-e89b-42d3-a456-426614174000',name:'Synthetic Student',email:'student@example.com',englishLevel:'Не знаю',availability:'Вечір',privacyConsent:true,contactMethod:'email',contactValue:'',referralSource:'instagram',locationSchemaVersion:1,currentCountry:' Польща ',currentCity:' Варшава '};
test('old cached forms keep working without invented location',()=>assert.deepEqual(assessmentLocation({}),{currentCountry:'',currentCity:'',locationSummary:'Не вказано',locationSchemaVersion:0}));
test('new form normalizes self-reported country and optional city',()=>{
 assert.deepEqual(assessmentLocation(valid),{currentCountry:'Польща',currentCity:'Варшава',locationSummary:'Польща, Варшава',locationSchemaVersion:1});
 assert.equal(assessmentLocation({...valid,currentCity:''}).locationSummary,'Польща');
 assert.equal(assessmentLocation({...valid,currentCity:undefined}).currentCity,'');
});
test('supports Ukrainian and international place names',()=>{
 for(const [currentCountry,currentCity] of [['Україна','Кам’янець-Подільський'],['Côte d’Ivoire','Abidjan'],['中国','北京'],['United Kingdom','St. Albans']])assert(assessmentLocation({...valid,currentCountry,currentCity}));
});
test('rejects blank country, malformed schema, types, control characters and markup',()=>{
 for(const currentCountry of ['', ' ', '1', {}, [], null, 'a'.repeat(81), '<b>Poland</b>', 'Poland\nBcc:attacker@example.com'])assert.equal(assessmentLocation({...valid,currentCountry}),null);
 for(const currentCity of [{},'<script>','Kyiv\u0000'])assert.equal(assessmentLocation({...valid,currentCity}),null);
 for(const locationSchemaVersion of [undefined,0,2,'1',null])assert.equal(assessmentLocation({...valid,locationSchemaVersion}),null);
});
test('endpoint forwards location into existing staff webhook without new calls',async()=>{
 const original=global.fetch,old=process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;
 process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL='https://hooks.example.test/assessment';
 let payload,calls=0;
 global.fetch=async(url,options)=>{assert.equal(url,'https://hooks.example.test/assessment');calls++;payload=JSON.parse(options.body);return{ok:true}};
 const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this},json(body){this.body=body;return this},end(){return this}};
 try{
  await handler({method:'POST',headers:{origin:'https://www.speakdobre.com','content-type':'application/json'},body:valid},res);
  assert.equal(res.statusCode,200);assert.equal(calls,1);assert.equal(payload.currentCountry,'Польща');assert.equal(payload.currentCity,'Варшава');assert.equal(payload.locationSummary,'Польща, Варшава');
  assert.equal(payload.contactValue,valid.email);assert.equal(payload.referralSource,'instagram');assert.equal(payload.englishLevel,valid.englishLevel);
 }finally{global.fetch=original;if(old===undefined)delete process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL;else process.env.ZAPIER_ASSESSMENT_WEBHOOK_URL=old;}
});

test('location cannot become a spreadsheet formula',()=>{
 for(const value of ['=NOW()','  =IMPORTXML(CHAR(65))','+SUM(A1)','-SUM(A1)','@SUM(A1)']) {
  assert.equal(assessmentLocation({...valid,currentCountry:value}),null);
  assert.equal(assessmentLocation({...valid,currentCity:value}),null);
 }
 assert.equal(assessmentLocation({...valid,currentCountry:'Timor-Leste',currentCity:"’s-Hertogenbosch"}).currentCountry,'Timor-Leste');
});
test('endpoint rejects incomplete location before any network call',()=>assert.throws(()=>handler._test.validateSubmission({...valid,currentCountry:''}),e=>e.code==='INVALID_LOCATION'));
