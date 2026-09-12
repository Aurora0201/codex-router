import { Transform } from "node:stream";
import { inspectServerFrame, type ServerFrameMetadata } from "./ws-metadata.js";

const MAX_EVENT_BYTES = 128 * 1024;

/** Bounded, read-only SSE inspection. Network chunk boundaries are irrelevant. */
export class ResponsesSseInspector extends Transform {
  terminal: ServerFrameMetadata | null = null;
  parseFailed = false;
  private line: number[] = [];
  private data: string[] = [];
  private eventBytes = 0;
  private discarded = false;
  private afterCR = false;

  constructor(private readonly onTerminal: (metadata: ServerFrameMetadata) => void = () => undefined) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    for (const byte of chunk) {
      if (this.terminal) break;
      if (this.afterCR && byte === 10) { this.afterCR = false; continue; }
      this.afterCR = byte === 13;
      if (byte === 10 || byte === 13) {
        this.inspectLine();
        this.line = [];
      } else if (this.line.length <= MAX_EVENT_BYTES) {
        this.line.push(byte);
        if (this.line.length > MAX_EVENT_BYTES) {
          this.discarded = true;
          this.parseFailed = true;
        }
      }
    }
    callback(null, chunk);
  }

  private inspectLine(): void {
    if (this.line.length === 0) {
      if (!this.discarded && this.data.length) {
        const data = this.data.join("\n");
        if (data !== "[DONE]") {
          const metadata = inspectServerFrame(Buffer.from(data), false);
          if (!metadata || metadata.parseFailed) this.parseFailed = true;
          else if (["response.completed", "response.incomplete", "response.failed", "error"].includes(metadata.type ?? "")) {
            this.terminal = metadata;
            this.onTerminal(metadata);
          }
        }
      }
      this.data = [];
      this.eventBytes = 0;
      this.discarded = false;
      return;
    }
    if (this.discarded) return;
    const line = Buffer.from(this.line).toString("utf8");
    if (line !== "data" && !line.startsWith("data:")) return;
    const value = line.slice(5).replace(/^ /, "");
    this.eventBytes += Buffer.byteLength(value) + 1;
    if (this.eventBytes > MAX_EVENT_BYTES) {
      this.discarded = true;
      this.parseFailed = true;
      this.data = [];
    } else this.data.push(value);
  }
}
