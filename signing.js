// -------------------------------------------------------
// 🧾 signing.js — Local TrueLayer JWS signing helper
// -------------------------------------------------------

import crypto from "crypto";

/**
 * Build a JWS (JSON Web Signature) for TrueLayer API requests.
 * Mirrors behavior of truelayer-signing v0.2.0
 */
export function sign({ kid, privateKey, method, path, body, headers }) {
  const header = {
    alg: "ES512",
    kid,
    tl_version: "2",
  };

  const payload = {
    method: method.toUpperCase(),
    path,
    headers,
    body,
  };

  // Encode header & payload as Base64URL
  const encodedHeader = Buffer.from(JSON.stringify(header))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const encodedPayload = Buffer.from(JSON.stringify(payload))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Sign using ES512 (ECDSA with SHA-512)
  const message = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("sha512", Buffer.from(message), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  const encodedSignature = Buffer.from(signature)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Combine all 3 parts into a compact JWS
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}
