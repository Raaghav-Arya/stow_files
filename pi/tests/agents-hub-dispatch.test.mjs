// Durable notification dispatch contracts; no provider requests.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir=fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/",import.meta.url));
const { DurableMailbox }=await jiti.import(join(dir,"mailbox.ts"));
const { ParentDelivery }=await jiti.import(join(dir,"delivery.ts"));
const root=mkdtempSync(join(tmpdir(),"hub-dispatch-"));
try {
 const mailbox=new DurableMailbox(join(root,"mailbox.jsonl")); let busy=true; const sends=[];
 const delivery=new ParentDelivery({mailbox,journalPath:join(root,"delivery.jsonl"),recipientId:"main",isBusy:()=>busy,send:async n=>sends.push(n),coalesceMs:0});
 const event=mailbox.create({rootSessionId:"s",rootGeneration:1,recipientId:"main",sourceAgentId:"child",kind:"completed",taskId:"t",revision:2,text:"done",provenance:{actor:"agent",label:"actual child"}});
 delivery.enqueue(event); await delivery.onSafeBoundary("turn_end",false); assert.equal(sends.length,0);
 await delivery.onSafeBoundary("turn_end",true); assert.equal(sends.length,1); assert.match(sends[0].content,/actual child/);
 busy=false; const input=mailbox.create({rootSessionId:"s",rootGeneration:1,recipientId:"main",sourceAgentId:"child",kind:"needs_input",taskId:"t",revision:3,text:"question",requestId:"r1",provenance:{actor:"agent",label:"actual child"}});
 delivery.hold("explicit-interrupt"); delivery.enqueue(input); await delivery.drain().catch(e=>assert.match(e.message,/held|in-flight/));
 assert.equal(delivery.pendingEvents().length,1); delivery.onIdle(); delivery.resume("explicit-interrupt"); await new Promise(r=>setTimeout(r,20)); assert.equal(sends.length,2);
 delivery.dispose();
} finally {rmSync(root,{recursive:true,force:true});}
console.log("Agents Hub dispatch tests passed (busy boundary, provenance, explicit holds, input notification)");
