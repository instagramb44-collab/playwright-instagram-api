const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const encoded = process.env.INSTAGRAM_SESSION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("INSTAGRAM_SESSION_ENCRYPTION_KEY is not configured.");

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("INSTAGRAM_SESSION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

function encryptStorageState(storageState) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(storageState), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    encrypted_storage_state: ciphertext.toString("base64"),
    encryption_iv: iv.toString("base64"),
    encryption_auth_tag: cipher.getAuthTag().toString("base64")
  };
}

function decryptStorageState(record) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(record.encryption_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(record.encryption_auth_tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.encrypted_storage_state, "base64")),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

module.exports = { encryptStorageState, decryptStorageState };
