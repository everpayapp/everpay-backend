// -----------------------------------------
// 🌍 Environment Variable Validation
// -----------------------------------------
export default function validateEnv() {
  const requiredVars = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NGROK_AUTHTOKEN",
    "NGROK_DOMAIN",
  ];

  const missing = requiredVars.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("🧾 Environment variables validated successfully.");
}
