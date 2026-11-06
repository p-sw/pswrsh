// Fake values only, generated per run by global-setup. None of them opens anything real.
const run = process.env.PSWRSH_TEST_RUN!;

export const RUN = run;
export const VAULT_PASSPHRASE = `fake-vault-${run}`;
export const SSH_PASSWORD = `fake-ssh-${run}`;
export const KEY_PASSPHRASE = `fake-keypass-${run}`;
export const PRIVATE_KEY = process.env.PSWRSH_TEST_KEY_PRIVATE!;
export const PUBLIC_KEY = process.env.PSWRSH_TEST_KEY_PUBLIC!;
export const LOCKED_PRIVATE_KEY = process.env.PSWRSH_TEST_LOCKED_KEY_PRIVATE!;
export const LOCKED_PUBLIC_KEY = process.env.PSWRSH_TEST_LOCKED_KEY_PUBLIC!;

/** A private key leaks if any line of its body does, so each line is its own needle. */
function keyBodyLines(pem: string) {
  return pem
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("-----"));
}

/** Every plaintext value that must never reach disk, logs or the network unencrypted. */
export function secretNeedles(): { label: string; value: string }[] {
  const plain = [
    { label: "vault passphrase", value: VAULT_PASSPHRASE },
    { label: "ssh password", value: SSH_PASSWORD },
    { label: "key passphrase", value: KEY_PASSPHRASE },
    ...keyBodyLines(PRIVATE_KEY).map((value, i) => ({ label: `private key line ${i}`, value })),
    ...keyBodyLines(LOCKED_PRIVATE_KEY).map((value, i) => ({ label: `locked private key line ${i}`, value })),
  ];
  const encoded = plain
    .filter((needle) => needle.label.includes("pass"))
    .flatMap(({ label, value }) => [
      { label: `${label} (base64)`, value: Buffer.from(value).toString("base64") },
      { label: `${label} (hex)`, value: Buffer.from(value).toString("hex") },
    ]);
  return [...plain, ...encoded];
}

export function leaks(haystack: string | Buffer) {
  const buffer = typeof haystack === "string" ? Buffer.from(haystack) : haystack;
  return secretNeedles()
    .filter(({ value }) => buffer.includes(value))
    .map(({ label }) => label);
}
