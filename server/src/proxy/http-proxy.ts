import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Agent, request as undiciRequest, type Dispatcher } from "undici";
import type { AccountRecord, IdentityMode, Transport } from "../types.js";
import { AccountAuthService } from "../accounts/account-auth-service.js";
import { AccountUsageService } from "../accounts/account-usage-service.js";
import { GatewayDatabase } from "../db/database.js";
import { ActiveAccountService } from "../routing/active-account-service.js";
import { hasBrowserOrigin } from "../security/origin-guard.js";
import { buildClientPassthroughHeaders, buildUpstreamHeaders, copyResponseHeaders, isCompactionRequest } from "./headers.js";
import { classifyHttpStatus, classifyProtocolTerminal, clientCancellation, gatewayFailure, transportFailure } from "./request-classification.js";
import { ResponsesSseInspector } from "./responses-sse-inspector.js";
import { transportErrorEvidence } from "./transport-error.js";

export type ProxyPath = "/responses" | "/responses/compact" | "/models" | "/alpha/search";
interface HttpProxyOptions { upstreamBaseUrl:string; activeAccounts:ActiveAccountService; auth:AccountAuthService; usage:AccountUsageService; database:GatewayDatabase; }

function errorStatus(error: unknown): number {
  switch ((error as Error).message) { case "no_active_account_selected": return 503; case "account_disabled": case "account_not_ready": case "fedramp_accounts_not_supported": return 409; default: return 502; }
}
function safeResponseMetadata(headers: Record<string,string|string[]|undefined>) {
  const stringValue=(name:string)=>{const value=headers[name];return Array.isArray(value)?value[0]:value;};
  const upstreamRequestId=stringValue("x-request-id")??stringValue("openai-request-id");
  const diagnosticHeaders:Record<string,string>={};
  for(const name of ["x-request-id","openai-request-id","retry-after"]){const value=stringValue(name);if(value)diagnosticHeaders[name]=value;}
  return {upstreamRequestId,diagnosticHeaders:Object.keys(diagnosticHeaders).length?diagnosticHeaders:undefined};
}

export class HttpProxy {
  private readonly dispatcher = new Agent({
    connectTimeout: 30_000,
    autoSelectFamily: true,
  });

  constructor(private readonly options: HttpProxyOptions) {}
  async close(): Promise<void> { await this.dispatcher.close(); }
  async handle(request:FastifyRequest,reply:FastifyReply,path:ProxyPath):Promise<void>{
    const startedAt=Date.now();
    const transport:Transport=path==="/models"?"models":path==="/responses/compact"||(path==="/responses"&&isCompactionRequest(request.headers))?"compact":path==="/alpha/search"?"search":"http";
    const logId=this.options.database.requestLog.startRequest({requestId:request.id,route:path,transport,startedAt});
    if(hasBrowserOrigin(request)){this.options.database.requestLog.finishRequest(logId,gatewayFailure("browser_origin_not_allowed",403,"routing"));await reply.code(403).send({error:"browser_origin_not_allowed"});return;}
    let rawBody:Buffer<ArrayBufferLike>=Buffer.alloc(0); let selectedAccount:AccountRecord|null=null; let identityMode:IdentityMode="managed_account"; let clientCancelled=false; let failureStage:"sending"|"streaming"="sending";
    try{
      rawBody=request.method==="GET"?Buffer.alloc(0):this.rawBody(request.body);
      const identity=this.options.activeAccounts.resolveIdentity(); if(identity.mode==="unavailable")throw new Error("no_active_account_selected");
      identityMode=identity.mode; selectedAccount=identity.mode==="managed_account"?identity.account:null;
      if(selectedAccount?.fedRamp)throw new Error("fedramp_accounts_not_supported");
      this.options.database.requestLog.setContext(logId,{accountId:selectedAccount?.id,identityMode,bytesIn:rawBody.length});
      let credential=selectedAccount?await this.options.auth.getCredential(selectedAccount.id):null;
      const controller=new AbortController(); const abort=()=>{if(!reply.raw.writableEnded){clientCancelled=true;controller.abort();}};
      request.raw.once("aborted",abort);reply.raw.once("close",abort);
      const send=()=>undiciRequest(this.upstreamUrl(request,path),{method:request.method as Dispatcher.HttpMethod,headers:credential?buildUpstreamHeaders(request.headers,credential,request.method==="GET"?undefined:rawBody.length):buildClientPassthroughHeaders(request.headers,request.method==="GET"?undefined:rawBody.length),body:request.method==="GET"?undefined:rawBody,signal:controller.signal,headersTimeout:120_000,bodyTimeout:0,dispatcher:this.dispatcher});
      let upstream=await send(); if(upstream.statusCode===401&&selectedAccount&&credential){await upstream.body.dump();credential=await this.options.auth.refresh(selectedAccount.id);upstream=await send();}
      if(upstream.statusCode===429&&selectedAccount){this.options.database.accounts.update(selectedAccount.id,{authStatus:"rate_limited"});void this.options.usage.refreshInBackground(selectedAccount.id);}
      const headers=upstream.headers as Record<string,string|string[]|undefined>; const safe=safeResponseMetadata(headers);
      failureStage="streaming";copyResponseHeaders(headers,reply.raw);reply.hijack();reply.raw.writeHead(upstream.statusCode);
      let bytesOut=0;const counter=new Transform({transform(chunk:Buffer,_e,cb){bytesOut+=chunk.length;cb(null,chunk);}});
      const inspectResponses=path==="/responses"&&upstream.statusCode>=200&&upstream.statusCode<300;
      const inspector=inspectResponses?new ResponsesSseInspector():null;
      if(inspector)await pipeline(upstream.body,inspector,counter,reply.raw);else await pipeline(upstream.body,counter,reply.raw);
      let evidence=classifyHttpStatus(upstream.statusCode);
      if(inspector){
        const terminal=inspector.terminal; evidence=terminal?classifyProtocolTerminal(terminal.type??"",terminal.errorCode??terminal.incompleteReason,terminal.status)??transportFailure("protocol_terminal_unrecognized","terminal"):transportFailure(inspector.parseFailed?"protocol_event_parse_failed":"protocol_terminal_missing","terminal");
      }
      this.options.database.requestLog.finishRequest(logId,{...evidence,...safe,bytesIn:rawBody.length,bytesOut});
      if(selectedAccount)this.options.usage.refreshIfStale(selectedAccount.id);
    }catch(error){
      const rawCode=(error as Error).message; const status=errorStatus(error); const gateway=["no_active_account_selected","account_disabled","account_not_ready","fedramp_accounts_not_supported","raw_request_body_unavailable"].includes(rawCode);
      this.options.database.requestLog.setContext(logId,{accountId:selectedAccount?.id,identityMode,bytesIn:rawBody.length});
      const transportError=transportErrorEvidence(error);
      this.options.database.requestLog.finishRequest(logId,clientCancelled?clientCancellation():gateway?gatewayFailure(rawCode,status,rawCode.includes("account")?"routing":"sending"):{...transportFailure(transportError.diagnosticCode,failureStage),transportErrorChain:transportError.transportErrorChain});
      if(clientCancelled)return;if(!reply.raw.headersSent)await reply.code(status).send({error:gateway?rawCode:"upstream_request_failed"});else reply.raw.destroy(error as Error);
    }
  }
  private upstreamUrl(request:FastifyRequest,path:ProxyPath){const base=`${this.options.upstreamBaseUrl}${path}`;const raw=request.raw.url??"";const index=raw.indexOf("?");return index===-1?base:`${base}${raw.slice(index)}`;}
  private rawBody(body:unknown){if(Buffer.isBuffer(body))return body;if(body==null)return Buffer.alloc(0);throw new Error("raw_request_body_unavailable");}
}
