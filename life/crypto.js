const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const PBKDF2_ITERATIONS = 310_000;

export function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomSalt() { return crypto.getRandomValues(new Uint8Array(16)); }

export async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: typeof salt === "string" ? decodeBase64Url(salt) : salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

function aad(entityId, nextRev, deleted) { return encoder.encode(`life:v1:${entityId}:${nextRev}:${Boolean(deleted)}`); }

export async function encryptEntity(key, entity, baseRev = 0) {
  const nextRev = baseRev + 1;
  const deleted = Boolean(entity.deletedAt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(entity.id, nextRev, deleted) }, key, encoder.encode(JSON.stringify(entity)));
  return { entityId: entity.id, baseRev, nextRev, deleted, iv: encodeBase64Url(iv), ct: encodeBase64Url(ct), schema: 1 };
}

export async function decryptEnvelope(key, envelope) {
  const bytes = await crypto.subtle.decrypt({
    name: "AES-GCM", iv: decodeBase64Url(envelope.iv),
    additionalData: aad(envelope.entityId, envelope.nextRev, envelope.deleted),
  }, key, decodeBase64Url(envelope.ct));
  return JSON.parse(decoder.decode(bytes));
}

export async function createSentinel(key) {
  const entity = { id: "sys:sentinel:v1", value: "life-unlocked", createdAt: new Date().toISOString() };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode("life:v1:sentinel") }, key, encoder.encode(JSON.stringify(entity)));
  return { iv: encodeBase64Url(iv), ct: encodeBase64Url(ct), schema: 1 };
}

export async function verifySentinel(key, sentinel) {
  try {
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(sentinel.iv), additionalData: encoder.encode("life:v1:sentinel") }, key, decodeBase64Url(sentinel.ct));
    return JSON.parse(decoder.decode(bytes)).value === "life-unlocked";
  } catch { return false; }
}
