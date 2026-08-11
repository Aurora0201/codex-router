import { spawn } from "node:child_process";
import open from "open";

export async function openDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") {
    await open(directory, { wait: false });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("explorer.exe", [directory], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
