import crypto from "node:crypto";

export function makeId(prefix) {
  const raw = crypto.randomBytes(6).toString("base64url");
  return `${prefix}_${raw}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
