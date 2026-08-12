import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayDatabase } from "../src/db/database.js";
import { classifyHttpStatus, classifyProtocolTerminal } from "../src/proxy/request-classification.js";

const roots:string[]=[];
async function databasePath(name:string){const root=await mkdtemp(path.join(os.tmpdir(),"request-evidence-"));roots.push(root);return path.join(root,name);}
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});

describe("request evidence lifecycle",()=>{
  it("inserts running immediately and completes the same record once",async()=>{
    const database=new GatewayDatabase(await databasePath("lifecycle.db"));
    const started=vi.fn();const finished=vi.fn();database.requestLog.onStarted=started;database.requestLog.onFinished=finished;
    const id=database.requestLog.startRequest({requestId:"request-1",route:"/responses",transport:"ws",startedAt:100,bytesIn:12})!;
    expect(database.requestLog.query({since:0,status:"running",limit:10}).items[0]).toMatchObject({id,state:"running",outcome:null});
    expect(database.requestLog.finishRequest(id,{...classifyProtocolTerminal("response.completed")!,completedAt:150,bytesOut:20})).toBe(true);
    expect(database.requestLog.finishRequest(id,{...classifyProtocolTerminal("response.failed","late_error")!,completedAt:160})).toBe(false);
    expect(database.requestLog.query({since:0,limit:10}).items[0]).toMatchObject({id,state:"completed",outcome:"success",statusCode:200,durationMs:50});
    expect(started).toHaveBeenCalledWith(id);expect(finished).toHaveBeenCalledOnce();database.close();
  });

  it("interrupts running records on the next process start",async()=>{
    const file=await databasePath("interrupted.db");const first=new GatewayDatabase(file);first.requestLog.startRequest({route:"/responses",transport:"http",startedAt:100});first.close();
    const second=new GatewayDatabase(file);expect(second.requestLog.query({since:0,limit:10}).items[0]).toMatchObject({state:"interrupted",outcome:"gateway_error",failureSource:"gateway",failureStage:undefined,diagnosticCode:"gateway_process_interrupted"});second.close();
  });

  it("keeps unknown protocol codes and separates HTTP classification",()=>{
    expect(classifyProtocolTerminal("response.failed","future_private_code")).toMatchObject({state:"failed",outcome:"upstream_error",protocolErrorCode:"future_private_code"});
    expect(classifyProtocolTerminal("error","usage_limit_reached",429)).toMatchObject({state:"failed",outcome:"upstream_error",httpStatus:429,protocolErrorCode:"usage_limit_reached"});
    expect(classifyHttpStatus(422)).toMatchObject({state:"rejected",outcome:"rejected",httpStatus:422});
    expect(classifyHttpStatus(429)).toMatchObject({state:"failed",outcome:"upstream_error",httpStatus:429});
  });

  it("migrates historical connection scope separately and idempotently",async()=>{
    const file=await databasePath("migration.db");const legacy=new Database(file);legacy.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES(8,1);
      CREATE TABLE gateway_state(singleton INTEGER PRIMARY KEY,active_account_id TEXT);
      INSERT INTO gateway_state VALUES(1,NULL);
      CREATE TABLE request_log(id TEXT PRIMARY KEY,request_id TEXT,route TEXT NOT NULL,transport TEXT NOT NULL,account_id TEXT,status_code INTEGER,duration_ms INTEGER,bytes_in INTEGER,bytes_out INTEGER,error_code TEXT,outcome TEXT NOT NULL,scope TEXT NOT NULL,identity_mode TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO request_log VALUES('request-old','request-1','/responses','http',NULL,200,20,1,2,NULL,'success','request','managed_account',100);
      INSERT INTO request_log VALUES('connection-old','connection-1','/responses','ws',NULL,101,30,NULL,NULL,'account_switch_connection_retired','success','connection','managed_account',200);
    `);legacy.close();
    const migrated=new GatewayDatabase(file);expect(migrated.requestLog.query({since:0,limit:10}).items).toHaveLength(1);expect(migrated.websocketConnectionLog.query({since:0,limit:10}).items[0]).toMatchObject({connectionId:"connection-1",handshakeHttpStatus:101,outcome:"retired",closeReasonCode:"account_switch_connection_retired"});migrated.close();
    const reopened=new GatewayDatabase(file);expect(reopened.websocketConnectionLog.query({since:0,limit:10}).items).toHaveLength(1);reopened.close();
  });
});
