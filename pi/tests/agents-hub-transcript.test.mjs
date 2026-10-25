import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { jiti } from "./pi-runtime.mjs";
const dir=fileURLToPath(new URL("../.pi/agent/extensions/agents-hub/",import.meta.url));
const {parseSessionJsonl,appendLiveTranscript}=await jiti.import(`${dir}transcript.ts`);
const records=[
 {type:"session",version:3,id:"s"},
 {type:"message",id:"r",parentId:null,timestamp:"1",message:{role:"user",content:"root"}},
 {type:"message",id:"u1",parentId:"r",timestamp:"2",message:{role:"user",content:"on active"}},
 {type:"message",id:"a1",parentId:"u1",timestamp:"3",message:{role:"assistant",content:[{type:"text",text:"**answer**"},{type:"toolCall",name:"read"}]}},
 {type:"message",id:"t1",parentId:"a1",timestamp:"4",message:{role:"toolResult",toolName:"read",content:[{type:"text",text:"result"}]}},
 {type:"message",id:"branch",parentId:"r",timestamp:"5",message:{role:"user",content:"abandoned"}},
 {type:"message",id:"leaf",parentId:"t1",timestamp:"6",message:{role:"user",content:"latest"}},
].map(x=>JSON.stringify(x)).join("\n")+"\n{";
let page=parseSessionJsonl(records,{limit:20,artifactPath:"/private/session.jsonl"});
assert.deepEqual(page.items.map(x=>x.id),["r","u1","a1","t1","leaf"]);
assert.ok(page.items.some(x=>x.text.includes("Tool call: read")));
assert.ok(page.items.some(x=>x.text==="result"));
assert.equal(page.artifactPath,"/private/session.jsonl");
assert.ok(!page.items.some(x=>x.text.includes("abandoned")));
assert.throws(()=>parseSessionJsonl(records,{leafId:"stale-leaf"}),/Invalid or stale/);
assert.throws(()=>parseSessionJsonl('{"id":"ok","parentId":null}\n{bad}\n'),/Malformed session JSONL at line 2/);
const provisional=parseSessionJsonl(records,{limit:20});
assert.ok(!provisional.items.some(x=>x.id==="runtime-only"),"persisted active branch remains authoritative over unrelated live events");
const compact=[
 {type:"message",id:"old",parentId:null,message:{role:"user",content:"history"}},
 {type:"compaction",id:"c",parentId:"old",summary:"condensed",firstKeptEntryId:"old"},
 {type:"message",id:"after",parentId:"c",message:{role:"assistant",content:[{type:"text",text:"current"}]}}
].map(x=>JSON.stringify(x)).join("\n");
page=parseSessionJsonl(compact,{limit:10});
assert.ok(page.items.some(x=>x.text.includes("Earlier conversation compacted")));
assert.ok(page.items.some(x=>x.text==="current"));
const repeated=appendLiveTranscript([{id:"x",role:"user",text:"old",source:"session"}],{id:"x",role:"user",text:"stream",source:"live"});
assert.equal(repeated.length,1); assert.equal(repeated[0].text,"stream");
page=parseSessionJsonl(records,{limit:2});
assert.equal(page.items.length,2); assert.equal(page.truncated,true); assert.equal(page.nextBefore,"t1");
console.log("Agents Hub transcript tests passed (active leaf, compaction, tools, hydration dedupe, bounded history)");
