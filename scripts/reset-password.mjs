import { openDatabase } from "../server/db.js";
import { passwordHash, credentials, audit } from "../server/auth.js";
import { loadParameters } from "../server/integrations.js";
await loadParameters();
const { email, password } = credentials({
  email: process.env.RESET_EMAIL,
  password: process.env.RESET_PASSWORD,
});
const db = await openDatabase();
try {
  const encoded = await passwordHash(password);
  await db.tx(async (tx) => {
    const user = (
      await tx.query("SELECT id FROM users WHERE email=$1", [email])
    ).rows[0];
    if (!user) throw Error("Administrator not found.");
    await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      encoded,
      user.id,
    ]);
    await tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    await audit(tx, user.id, "password.reset", "administrator");
  });
  console.log(
    "Password reset; all existing sessions revoked. Remove RESET_PASSWORD from your environment.",
  );
} finally {
  await db.close();
}
