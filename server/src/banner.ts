function bannerLine(text: string, width = 44): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return `│${" ".repeat(left)}${text}${" ".repeat(pad - left)}│`;
}

export const BANNER = [
  `╔${"═".repeat(44)}╗`,
  bannerLine("codex-router"),
  bannerLine("Transparent identity proxy for Codex"),
  `╚${"═".repeat(44)}╝`,
].join("\n");

export function printBanner(): void {
  process.stdout.write(`${BANNER}\n`);
}
