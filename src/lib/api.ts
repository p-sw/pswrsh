// Client helper for the account API. Returns the error code instead of throwing.
export async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, error: typeof data.error === "string" ? data.error : undefined, data };
  } catch {
    return { ok: false, error: "network", data: {} };
  }
}
