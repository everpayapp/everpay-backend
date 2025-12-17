import fs from "fs";
import { sign } from "./signing.js";

const KID = "test-key-id"; // just a dummy for testing
const privateKey = fs.readFileSync("./signing-private.pem", "utf8").trim();

const jws = sign({
  kid: KID,
  privateKey,
  method: "POST",
  path: "/payments",
  body: JSON.stringify({ test: "ok" }),
  headers: {
    "content-type": "application/json",
    "idempotency-key": "12345",
  },
});

console.log("\n✅ JWS generated successfully!\n");
console.log(jws);
