export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureSetupToken } = await import("./server/setup.ts");
  ensureSetupToken();
}
