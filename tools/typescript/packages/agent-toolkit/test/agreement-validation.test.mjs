import test from 'node:test';
import assert from 'node:assert/strict';
import {CreatePaymentAgreementInputSchema,CreatePaymentAgreementRequestSchema} from '../dist/types/index.js';
import {ShabaasApiClient} from '../dist/api/client.js';
import {createPaymentAgreementTools} from '../dist/tools/payment-agreements.js';
const base={name:'Fixture',type:'email',maximum_amount:'10',frequency:'DAIL',number_of_transactions_permitted:5,pay_id:'fixture@example.com'};
const bank={...base,type:'bsb',bsb:'062000',account_number:'00123456'};delete bank.pay_id;
test('bank path does not require PayID and preserves leading zeroes',()=>{
 const result=CreatePaymentAgreementInputSchema.parse(bank);assert.equal(result.bsb,'062000');assert.equal(result.account_number,'00123456');
 assert.ok(CreatePaymentAgreementRequestSchema.safeParse(bank).success);
 assert.ok(CreatePaymentAgreementRequestSchema.safeParse({...bank,bsb:62000,account_number:123456}).success);
});
test('bank path requires both identifiers and PayID paths require a nonempty PayID',()=>{
 for(const missing of ['bsb','account_number']){const payload={...bank};delete payload[missing];assert.equal(CreatePaymentAgreementInputSchema.safeParse(payload).success,false);}
 assert.equal(CreatePaymentAgreementInputSchema.safeParse({...bank,bsb:''}).success,false);
 assert.equal(CreatePaymentAgreementInputSchema.safeParse({...base,pay_id:''}).success,false);
 assert.equal(CreatePaymentAgreementInputSchema.safeParse({...base,name:''}).success,false);
 assert.ok(CreatePaymentAgreementInputSchema.safeParse(base).success);
});
test('tool rejects malformed BSB before invoking the API',async()=>{
 let calls=0;const api={createPaymentAgreement:async()=>{calls++;throw Error('must not reach HTTP');}};
 const tools=createPaymentAgreementTools(api,{environment:'sandbox'});
 const result=await tools.create_payment_agreement.execute({...base,type:'bsb'});
 assert.equal(result.success,false);assert.equal(calls,0);
});
test('direct client rejects malformed BSB before authentication or HTTP',async()=>{
 const api=new ShabaasApiClient({environment:'sandbox'});let calls=0;
 api.getTokenForRequest=async()=>{calls++;throw Error('must not authenticate');};
 await assert.rejects(api.createPaymentAgreement({...base,type:'bsb'}),/Invalid payment agreement input/);
 assert.equal(calls,0);
});
test('tool does not send its authorization or presentation options as agreement fields',async()=>{
 let received;const tools=createPaymentAgreementTools({createPaymentAgreement:async payload=>{received=payload;return {data:{payment_agreement_id:'test',status:'created'}};}},{environment:'sandbox'});
 await tools.create_payment_agreement.execute({...base,authorization:'credential',enrich:false,include_raw:false});
 assert.equal(received.authorization,undefined);assert.equal(received.enrich,undefined);assert.equal(received.include_raw,undefined);assert.equal(received.pay_id,base.pay_id);
});
