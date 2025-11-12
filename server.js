// CommonJS
const express = require("express");
const cors = require("cors");
const path = require("path");
const { exec } = require("node:child_process");
const { exportUsersWithBalance } = require("./src/uat-export"); // <-- from code below

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function openBrowser(url) {
  if (process.platform === "win32") exec(`start "" "${url}"`, { shell: "cmd.exe" });
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

// POST /api/uat/export-users?limit=10&download=1&save=1
app.post("/api/uat/export-users", async (req, res) => {
  try {
    const raw = req.query.limit ?? req.body?.limit;
    let limit = parseInt(raw, 10);
    if (Number.isNaN(limit)) limit = 5;
    if (limit < 1) limit = 1;
    if (limit > 1000) limit = 1000;

    const wantDownload = String(req.query.download ?? "0") === "1";
    const alsoSave = String(req.query.save ?? "0") === "1";

    const { data, filename } = await exportUsersWithBalance({ limit, saveToDisk: alsoSave });

    if (wantDownload) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(JSON.stringify(data, null, 2));
    }

    return res.status(200).json({ ok: true, count: data.length, filename, users: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`✅ Server started at ${url}`);
  openBrowser(url);
});
