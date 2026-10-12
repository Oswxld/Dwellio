// Dedicated move-out statement SMS sender.
// Uses the same Africa's Talking credentials as send-invoices.
// Builds complete SMS text from server-side finalized financial snapshots.
// NO URL. A tenant does not need portal access after termination.
// Deploy as Supabase Edge Function: send-move-out-invoice.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

type Claim={claimed:boolean;invoice_id?:string;phone?:string;message?:string;reason?:string};
type Result={invoice_id:string;status:"accepted"|"failed"|"unknown"|"skipped";reason?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function phoneNumber(input:string):string|null {
  const value=input.replace(/[\s()-]/g,"");
  const normalized=value.startsWith("0")?"+254"+value.slice(1):
    value.startsWith("254")?"+"+value:value;
  return /^\+254[17]\d{8}$/.test(normalized)?normalized:null;
}

export default {
  fetch:withSupabase({auth:"user"},async (req,ctx)=>{
    if(req.method!=="POST")return Response.json({error:"POST required"},{status:405});
    let invoiceId:string;
    try {
      const payload=await req.json();
      invoiceId=payload?.invoice_id;
    } catch {
      return Response.json({error:"Invalid request JSON"},{status:400});
    }
    if(typeof invoiceId!=="string"||!uuid.test(invoiceId))
      return Response.json({error:"A valid invoice ID is required"},{status:400});
    const actorId=ctx.userClaims?.id;
    if(!actorId)return Response.json({error:"Authentication required"},{status:401});

    const username=Deno.env.get("AFRICASTALKING_USERNAME");
    const apiKey=Deno.env.get("AFRICASTALKING_API_KEY");
    const senderId=Deno.env.get("AFRICASTALKING_SENDER_ID");
    if(!username||!apiKey)
      return Response.json({error:"SMS provider is not configured"},{status:503});
    const environment=username==="sandbox"?"sandbox":"production";
    if(environment==="production"&&!senderId)
      return Response.json({error:"An approved SMS sender ID is required in production"},{status:503});

    const {data,error}=await ctx.supabaseAdmin.rpc("claim_move_out_sms_delivery",{
      p_invoice_id:invoiceId,p_environment:environment,p_actor_id:actorId,
    });
    if(error)return Response.json({error:error.message},{status:400});
    const claim=data as Claim|null;
    if(!claim?.claimed)
      return Response.json({environment,invoice_id:invoiceId,status:"skipped",reason:claim?.reason??"Not eligible"});

    const phone=phoneNumber(String(claim.phone??""));
    const message=String(claim.message??"");
    async function record(status:"accepted"|"failed"|"unknown",extra:Record<string,unknown>={}) {
      const {error}=await ctx.supabaseAdmin.from("move_out_sms_deliveries")
        .update({status,...extra,updated_at:new Date().toISOString()})
        .eq("invoice_id",invoiceId).eq("status","sending");
      if(error)throw new Error("Could not record SMS status");
    }

    if(!phone||!message) {
      try {await record("failed",{error_message:!phone?"Invalid recipient phone":"Empty statement"})}catch{}
      return Response.json({environment,invoice_id:invoiceId,status:"failed",reason:"Recipient or message missing"});
    }

    const endpoint=environment==="sandbox"
      ?"https://api.sandbox.africastalking.com/version1/messaging"
      :"https://api.africastalking.com/version1/messaging";
    const form=new URLSearchParams({username,to:phone,message});
    if(environment==="production"&&senderId)form.set("from",senderId);

    let result:Result;
    try {
      const response=await fetch(endpoint,{
        method:"POST",
        headers:{
          apiKey,Accept:"application/json",
          "Content-Type":"application/x-www-form-urlencoded",
        },
        body:form.toString(),
        signal:AbortSignal.timeout(15000),
      });
      const raw=await response.text();
      let parsed:Record<string,unknown>={};
      try {parsed=JSON.parse(raw)}catch{}
      const recipient=(parsed.SMSMessageData as
        {Recipients?:Array<Record<string,unknown>>}|undefined)?.Recipients?.[0];
      const accepted=response.ok && recipient?.status==="Success"
        && Number(recipient?.statusCode)===101;
      const status:Result["status"]=accepted?"accepted":
        response.status>=500||(response.ok&&!recipient)?"unknown":"failed";
      await record(status,{
        phone,
        provider_message_id:typeof recipient?.messageId==="string"?recipient.messageId:null,
        provider_status:typeof recipient?.status==="string"?recipient.status:null,
        provider_cost:typeof recipient?.cost==="string"?recipient.cost:null,
        error_message:accepted?null:status==="unknown"
          ?"Provider response unclear; verify before retrying"
          :"SMS provider rejected the statement",
        accepted_at:accepted?new Date().toISOString():null,
      });
      result={invoice_id:invoiceId,status,reason:status==="unknown"
        ?"Provider outcome uncertain; do not retry automatically":undefined};
    }catch{
      // Provider might have received the message before the timeout or DB error.
      // Do not auto-retry. Keep 'sending' if outcome cannot be recorded.
      try {await record("unknown",{error_message:"Timeout or uncertain provider submission; verify before retry"})}catch{}
      result={invoice_id:invoiceId,status:"unknown",reason:"Provider outcome uncertain; verify before retry"};
    }
    return Response.json({environment,...result});
  }),
};
