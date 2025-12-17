// -----------------------------------------
// 🧾 EverPay — Logging Helpers (Daily Rotation + 7-Day Retention)
// -----------------------------------------
import fs from "fs";
import chalk from "chalk";

const LOG_DIR = "logs";
const RETENTION_DAYS = 7;

// ------------------------------------------------
// 📅 Dynamic daily log file
// ------------------------------------------------
function getLogFilePath() {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR);
  }
  return `${LOG_DIR}/stripe-${date}.log`;
}

// ------------------------------------------------
// 🧹 Auto-cleanup old logs (older than 7 days)
// ------------------------------------------------
function cleanupOldLogs() {
  const now = new Date();

  fs.readdirSync(LOG_DIR).forEach((file) => {
    if (file.startsWith("stripe-") && file.endsWith(".log")) {
      const datePart = file.replace("stripe-", "").replace(".log", "");
      const fileDate = new Date(datePart);
      const diffDays = (now - fileDate) / (1000 * 60 * 60 * 24);

      if (diffDays > RETENTION_DAYS) {
        fs.unlinkSync(`${LOG_DIR}/${file}`);
        console.log(chalk.gray(`🧹 Deleted old log: ${file}`));
      }
    }
  });
}

// ------------------------------------------------
// 🧠 Internal helper: Write to daily file
// ------------------------------------------------
function writeLog(message) {
  const logFilePath = getLogFilePath();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFilePath, line);
  cleanupOldLogs(); // Clean up after each write
}

// ------------------------------------------------
// 🧭 Console + File Logging Functions
// ------------------------------------------------
export function logHeader(title) {
  const header = `\n-------------------------------------\n${title}\n-------------------------------------`;
  console.log(chalk.cyanBright(header));
  writeLog(header);
}

export function logInfo(message) {
  console.log(chalk.green(message));
  writeLog(`INFO: ${message}`);
}

export function logError(message) {
  console.error(chalk.red(message));
  writeLog(`ERROR: ${message}`);
}

export function logVerified() {
  const message = "✅ Webhook verified successfully!";
  console.log(chalk.yellowBright(message));
  writeLog(message);
}
