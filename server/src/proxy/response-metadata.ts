export function safeResponseMetadata(headers: Record<string, string | string[] | undefined>) {
  const stringValue = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const upstreamRequestId = stringValue("x-request-id") ?? stringValue("openai-request-id");
  const diagnosticHeaders: Record<string, string> = {};
  for (const name of ["x-request-id", "openai-request-id", "retry-after"]) {
    const value = stringValue(name);
    if (value) diagnosticHeaders[name] = value;
  }
  return {
    upstreamRequestId,
    diagnosticHeaders: Object.keys(diagnosticHeaders).length ? diagnosticHeaders : undefined,
  };
}
