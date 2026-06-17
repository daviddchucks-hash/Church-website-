/* ==============================================
   SERVER.JS — DEPRECATED
   -----------------------------------------------
   ⚠️  THIS FILE IS NO LONGER USED.
   App Control has been migrated to Firebase
   Realtime Database (/appSettings). This file
   is kept for reference only. It cannot run on
   GitHub Pages and is not called by any client
   code. See js/app-control-client.js for the
   new real-time RTDB implementation.
   ───────────────────────────────────────────────
   ORIGINAL: Jesus Embassy App Control Server
   Node.js + Express server for managing app status
   without Firebase. Reads/writes app-status.json.

   START:    node server.js
   ENV VARS:
     PORT             — default 3000
     APP_CONTROL_CODE — 4-digit admin code (default: 0000)

   API:
     GET  /api/app-status  — public, returns current status
     POST /api/app-status  — admin only, requires code in body
============================================== */

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Config ─────────────────────────────────────── */
const STATUS_FILE        = path.join(__dirname, 'app-status.json');
const APP_CONTROL_CODE   = process.env.APP_CONTROL_CODE || '0000';

/* ── Default status ─────────────────────────────── */
const DEFAULT_STATUS = {
  maintenance:        false,
  readOnly:           false,
  shutdown:           false,
  online:             true,
  maintenanceMessage: '',
  lastUpdated:        ''
};

/* ── Helpers ─────────────────────────────────────── */
function readStatus() {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf8');
    return { ...DEFAULT_STATUS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

function writeStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/* ── Middleware ──────────────────────────────────── */
app.use(express.json());

/* CORS — allow requests from any origin (GitHub Pages, localhost, etc.) */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

/* ── GET /api/app-status ─────────────────────────── */
/* Public endpoint — returns current app status */
app.get('/api/app-status', (req, res) => {
  try {
    const status = readStatus();
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Could not read app-status.json', detail: err.message });
  }
});

/* ── POST /api/app-status ────────────────────────── */
/* Admin-only — requires matching code in request body */
app.post('/api/app-status', (req, res) => {
  const {
    code,
    maintenance,
    readOnly,
    shutdown,
    online,
    maintenanceMessage
  } = req.body || {};

  /* Validate code */
  if (!code || String(code).trim() !== String(APP_CONTROL_CODE)) {
    console.warn('[AppControl] Rejected POST — invalid code from', req.ip);
    return res.status(403).json({ error: 'Invalid admin code. Status not changed.' });
  }

  /* Validate booleans */
  const boolCheck = { maintenance, readOnly, shutdown, online };
  for (const [key, val] of Object.entries(boolCheck)) {
    if (val !== undefined && typeof val !== 'boolean') {
      return res.status(400).json({ error: `Field "${key}" must be a boolean.` });
    }
  }

  try {
    const current = readStatus();

    const updated = {
      maintenance:        typeof maintenance === 'boolean'  ? maintenance  : current.maintenance,
      readOnly:           typeof readOnly    === 'boolean'  ? readOnly     : current.readOnly,
      shutdown:           typeof shutdown    === 'boolean'  ? shutdown     : current.shutdown,
      online:             typeof online      === 'boolean'  ? online       : current.online,
      maintenanceMessage: typeof maintenanceMessage === 'string'
                            ? maintenanceMessage
                            : (current.maintenanceMessage || ''),
      lastUpdated:        new Date().toISOString()
    };

    writeStatus(updated);

    console.log('[AppControl] Status updated →',
      `maintenance:${updated.maintenance}`,
      `readOnly:${updated.readOnly}`,
      `shutdown:${updated.shutdown}`,
      `online:${updated.online}`
    );

    res.json({ success: true, status: updated });

  } catch (err) {
    console.error('[AppControl] Write error:', err.message);
    res.status(500).json({ error: 'Could not write app-status.json', detail: err.message });
  }
});

/* ── Serve static files ──────────────────────────── */
/* Optional: serve the church website at root */
app.use(express.static(__dirname));

/* ── Start ───────────────────────────────────────── */
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Jesus Embassy — App Control Server          ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  GET  /api/app-status  — read current status`);
  console.log(`  POST /api/app-status  — update status (requires code)`);
  console.log(`  Control code: ${APP_CONTROL_CODE}`);
  console.log('');
});
