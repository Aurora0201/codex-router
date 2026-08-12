import { Transform } from "node:stream";
import { inspectServerFrame, type ServerFrameMetadata } from "./ws-metadata.js";

const MAX_SSE_LINE_BYTES = 128 * 1024;

export class ResponsesSseInspector extends Transform {
  terminal: ServerFrameMetadata | null = null;
  parseFailed = false;
  private line = Buffer.alloc(0);

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.inspect(chunk);
    callback(null, chunk);
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.line.length) this.inspectLine(this.line);
    callback();
  }

  private inspect(chunk: Buffer): void {
    if (this.line.length + chunk.length > MAX_SSE_LINE_BYTES) {
      this.parseFailed = true;
      this.line = Buffer.alloc(0);
      return;
    }
    const combined = this.line.length ? Buffer.concat([this.line, chunk]) : chunk;
    let start = 0;
    for (let index = 0; index < combined.length; index += 1) {
      if (combined[index] !== 0x0a) continue;
      this.inspectLine(combined.subarray(start, index));
      start = index + 1;
    }
    this.line = Buffer.from(combined.subarray(start));
  }

  private inspectLine(rawLine: Buffer): void {
    const line = rawLine.at(-1) === 0x0d ? rawLine.subarray(0, -1) : rawLine;
    if (!line.subarray(0, 5).equals(Buffer.from("data:"))) return;
    const data = line.subarray(5).toString("utf8").trimStart();
    if (!data || data === "[DONE]") return;
    const metadata = inspectServerFrame(Buffer.from(data), false);
    if (!metadata || metadata.parseFailed) { this.parseFailed = true; return; }
    if (["response.completed", "response.incomplete", "response.failed", "error"].includes(metadata.type ?? "")) this.terminal = metadata;
  }
}
