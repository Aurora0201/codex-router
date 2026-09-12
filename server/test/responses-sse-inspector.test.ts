import { describe, expect, it } from "vitest";
import { ResponsesSseInspector } from "../src/proxy/responses-sse-inspector.js";

const event = (type: string) => Buffer.from(`data: ${JSON.stringify({ type })}\n\n`);
async function inspect(chunks: Buffer[]) {
  const observed: string[] = [];
  const output: Buffer[] = [];
  const stream = new ResponsesSseInspector((metadata) => observed.push(metadata.type!));
  stream.on("data", (chunk: Buffer) => output.push(chunk));
  const ended = new Promise<void>((resolve, reject) => { stream.on("end", resolve); stream.on("error", reject); });
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await ended;
  expect(Buffer.concat(output)).toEqual(Buffer.concat(chunks));
  return { terminal: stream.terminal?.type, parseFailed: stream.parseFailed, observed };
}

describe("transparent SSE inspection", () => {
  it("keeps the first terminal and calls the observer once", async () => {
    expect(await inspect([event("response.failed"), event("response.completed")])).toMatchObject({
      terminal: "response.failed", observed: ["response.failed"],
    });
  });
  it("does not confuse a large network chunk with a large event", async () => {
    const chunks = [...Array.from({ length: 6000 }, () => event("response.created")), event("response.completed")];
    expect(await inspect([Buffer.concat(chunks)])).toEqual(await inspect(chunks));
  });
  it("recovers at the next event after an oversized one", async () => {
    const bytes = Buffer.from(`data: ${"x".repeat(140_000)}\n\n`);
    expect(await inspect([bytes.subarray(0, 100), bytes.subarray(100), event("response.completed")]))
      .toMatchObject({ terminal: "response.completed", parseFailed: true });
  });
  it("handles CRLF and multiline data even when every byte is split", async () => {
    const bytes = Buffer.from('data: {"type":\r\ndata: "response.completed"}\r\n\r\n');
    expect(await inspect([...bytes].map((b) => Buffer.from([b])))).toMatchObject({ terminal: "response.completed", parseFailed: false });
  });
  it("does not invent an event from an incomplete EOF", async () => {
    expect(await inspect([Buffer.from('data: {"type":"response.completed"}')])).toMatchObject({ terminal: undefined });
  });
});
