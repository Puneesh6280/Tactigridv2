// Session-based auth using only Node built-ins (no new dependencies).
//
// Accounts live in users.json (git-ignored), NOT in source. Passwords are
// stored as scrypt hashes with a per-user salt, so the file never contains a
// readable password. Sessions are random tokens held in memory and handed to
// the browser as an HttpOnly cookie - a server restart logs everyone out,
// which is an acceptable trade for not persisting session state.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SESSION_COOKIE = "tg_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const usersFilePath = path.join(__dirname, "users.json");

const sessions = new Map(); // token -> { username, role, expiresAt }

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash: derived };
}

function verifyPassword(password, salt, expectedHash) {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  // Lengths must match before timingSafeEqual, or it throws.
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// Seeds users.json on first run so the app still boots out of the box. The
// seed passwords come from env vars when provided; otherwise the old
// hardcoded defaults are used and we warn loudly, because those are public
// knowledge (they were committed to git).
function ensureUsersFile() {
  if (fs.existsSync(usersFilePath)) return;

  const adminPw = process.env.TACTIGRID_ADMIN_PASSWORD || "admin123";
  const userPw = process.env.TACTIGRID_USER_PASSWORD || "user123";

  const seeded = {
    admin: { role: "admin", ...hashPassword(adminPw) },
    user: { role: "user", ...hashPassword(userPw) }
  };
  fs.writeFileSync(usersFilePath, JSON.stringify(seeded, null, 2));

  if (!process.env.TACTIGRID_ADMIN_PASSWORD) {
    console.warn(
      "\n[auth] users.json created with the OLD DEFAULT passwords (admin123 / user123).\n" +
      "[auth] These were committed to git and must be considered public.\n" +
      "[auth] Change them before this is reachable by anyone else:\n" +
      "[auth]   node setPassword.js admin <new-password>\n"
    );
  }
}

function loadUsers() {
  ensureUsersFile();
  return JSON.parse(fs.readFileSync(usersFilePath, "utf8"));
}

function setPassword(username, password, role) {
  const users = loadUsers();
  const existing = users[username];
  users[username] = { role: role || (existing && existing.role) || "user", ...hashPassword(password) };
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2));
}

function authenticate(username, password) {
  const users = loadUsers();
  // Object.prototype keys ("constructor", "toString", ...) must not resolve
  // to inherited members and look like accounts.
  const account = Object.prototype.hasOwnProperty.call(users, username) ? users[username] : null;
  if (!account) return null;
  if (!verifyPassword(password, account.salt, account.hash)) return null;
  return { username, role: account.role };
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { ...user, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { ...session, token };
}

// Attaches req.user when a valid session exists; never rejects on its own.
function attachUser(req, res, next) {
  req.user = getSession(req);
  next();
}

// Only a real browser navigation should be bounced to the login page. Every
// other caller (fetch, XHR, asset loads) must get a 401 it can act on -
// redirecting those hands back an HTML login page where JSON was expected.
function isPageNavigation(req) {
  if (req.method !== "GET") return false;
  if (req.headers["sec-fetch-mode"] === "navigate") return true;
  // Fallback for clients that don't send Sec-Fetch-*: only treat it as a
  // navigation if HTML is explicitly preferred over JSON.
  const accept = req.headers.accept || "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function denyUnauthenticated(req, res) {
  if (isPageNavigation(req)) return res.redirect("/index.html");
  return res.status(401).json({ success: false, message: "Not signed in." });
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return denyUnauthenticated(req, res);
}

function requireAdmin(req, res, next) {
  if (!req.user) return denyUnauthenticated(req, res);
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Admin access required." });
  }
  next();
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authenticate,
  createSession,
  destroySession,
  attachUser,
  requireAuth,
  requireAdmin,
  setPassword,
  loadUsers
};
