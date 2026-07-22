// CLI helper to change an account password without touching source code.
//
//   node setPassword.js <username> <new-password> [admin|user]
//
// Writes a scrypt hash into users.json - the plain password is never stored.

const { setPassword, loadUsers } = require("./auth");

const [, , username, password, role] = process.argv;

if (!username || !password) {
  console.error("Usage: node setPassword.js <username> <new-password> [admin|user]");
  process.exit(1);
}

if (role && role !== "admin" && role !== "user") {
  console.error(`Invalid role "${role}" - must be "admin" or "user".`);
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const existed = Object.prototype.hasOwnProperty.call(loadUsers(), username);
setPassword(username, password, role);
console.log(`${existed ? "Updated" : "Created"} account "${username}"${role ? ` (role: ${role})` : ""}.`);
