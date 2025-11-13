require("dotenv").config({ path: "../.env" });
const { Client } = require("pg");
const fs = require("fs");
const crypto = require("crypto");
const generatePassword = require("generate-password");

const PG_CONFIG = {
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: +process.env.PGPORT,
  ssl: { rejectUnauthorized: false },
};

function makeSalt() {
  return crypto.createHash("sha1").update(crypto.randomBytes(8)).digest("hex");
}
function hashPassword(login, password, salt) {
  return crypto.createHash("sha1")
    .update(Buffer.from(login + salt + password, "utf-8"))
    .digest("hex");
}
function makeTempPassword() {
  return generatePassword.generate({
    length: 12,
    numbers: true,
    symbols: false,
    uppercase: true,
    lowercase: true,
    strict: true,
  });
}
function timestampName() {
  const d = new Date();
  return d.toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+/, "");
}

/**
 * Runs your original logic:
 * 1) Select users by balance criteria with LIMIT
 * 2) Reset temp passwords (transaction)
 * 3) Return JSON data; optionally also save to disk as .json
 */
async function exportUsersWithBalance({ limit, saveToDisk = false }) {
  const client = new Client(PG_CONFIG);
  const out = [];

  const selectSql = `
    SELECT
      pl.application_id,
      pl.patron_login,
      p.parking,
      p.transit,
      a.parking_balance,
      a.transit_balance
    FROM bosc.patron_login pl
    JOIN bosc.patron p ON p.application_id = pl.application_id
    JOIN bosc.application_status a ON a.application_id = pl.application_id
    WHERE (p.parking = true  AND COALESCE(a.parking_balance, 0) > 0)
       OR (p.transit = true  AND COALESCE(a.transit_balance, 0) > 0)
    ORDER BY pl.application_id ASC
    LIMIT $1
  `;

  await client.connect();
  try {
    const { rows } = await client.query(selectSql, [limit]);

    await client.query("BEGIN");
    for (const u of rows) {
      const newPassword = makeTempPassword();
      const salt = makeSalt();
      const saltedHash = hashPassword(u.patron_login, newPassword, salt);

      await client.query(
        `UPDATE bosc.patron_login
           SET salt = $1,
               salted_hash = $2,
               last_changed = NOW()
         WHERE application_id = $3`,
        [salt, saltedHash, u.application_id]
      );

      out.push({
        application_id: u.application_id,
        patron_login: u.patron_login,
        parking: u.parking,
        transit: u.transit,
        parking_balance: u.parking_balance,
        transit_balance: u.transit_balance,
        new_password: newPassword,
      });
    }
    await client.query("COMMIT");
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    await client.end();
  }

  const filename = `uat_user_credentials_with_balance_${timestampName()}.json`;
  if (saveToDisk) {
    fs.writeFileSync(filename, JSON.stringify(out, null, 2), { mode: 0o600 });
  }

  return { data: out, filename };
}

module.exports = { exportUsersWithBalance };
