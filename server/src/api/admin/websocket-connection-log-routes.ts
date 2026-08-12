import type { FastifyInstance } from "fastify";
import type { ConnectionOutcome } from "../../db/repositories/websocket-connection-log-repository.js";
import type { AdminContext } from "./context.js";

const RANGES:Record<string,number>={"1h":3600000,"24h":86400000,"7d":604800000};
const OUTCOMES=new Set<ConnectionOutcome>(["connected","rejected","failed","retired","closed"]);
function decodeCursor(value:string|undefined):{startedAt:number;id:string}|undefined{if(!value)return undefined;const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as {startedAt?:unknown;id?:unknown};if(typeof parsed.startedAt!=="number"||typeof parsed.id!=="string")throw new Error();return {startedAt:parsed.startedAt,id:parsed.id};}
export function registerWebSocketConnectionLogRoutes(app:FastifyInstance,ctx:AdminContext):void{
  app.get("/api/websocket-connection-logs",async(request,reply)=>{try{
    const query=request.query as Record<string,string|undefined>;const range=query.range??"24h";const limit=query.limit===undefined?50:Number(query.limit);const page=query.page===undefined?undefined:Number(query.page);
    if(!RANGES[range]||!Number.isInteger(limit)||limit<1||limit>100||(page!==undefined&&(!Number.isInteger(page)||page<1))||(page!==undefined&&query.cursor!==undefined))throw new Error();
    if(query.outcome&&!OUTCOMES.has(query.outcome as ConnectionOutcome))throw new Error();if((query.q?.length??0)>100)throw new Error();
    const result=ctx.database.websocketConnectionLog.query({since:Date.now()-RANGES[range],outcome:query.outcome as ConnectionOutcome|undefined,accountId:query.accountId,query:query.q?.trim()||undefined,cursor:decodeCursor(query.cursor),page,limit});
    return {...result,nextCursor:result.nextCursor?Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url"):null};
  }catch{return reply.code(400).send({error:"invalid_websocket_connection_log_query"});}});
}
