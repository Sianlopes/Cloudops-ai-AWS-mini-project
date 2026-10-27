import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(rawScrypt);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function constantEqual(a, b) {
  const aa = Buffer.from(a || ""),
    bb = Buffer.from(b || "");
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password, stored) {
  const [salt, key] = stored.split(":");
  const actual = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return constantEqual(actual.toString("hex"), key);
}
export function credentials(body) {
  if (
    typeof body?.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(body.email) ||
    body.email.length > 254 ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128
  )
    throw Object.assign(
      Error("Use a valid email and a password of 12–128 characters."),
      { status: 400 },
    );
  return { email: body.email.trim().toLowerCase(), password: body.password };
}
export async function createAdmin(db, email, password) {
  const c = credentials({ email, password });
  const encoded = await passwordHash(c.password);
  return db.tx(async (tx) => {
    const existing = await tx.query("SELECT id FROM users LIMIT 1");
    if (existing.rows.length)
      throw Object.assign(Error("An administrator already exists."), {
        status: 409,
      });
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)",
      [id, c.email, encoded, new Date().toISOString()],
    );
    return { id, email: c.email };
  });
}
export async function bootstrapAdmin(db) {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (!(await db.query("SELECT id FROM users LIMIT 1")).rows.length)
      await createAdmin(
        db,
        process.env.ADMIN_EMAIL,
        process.env.ADMIN_PASSWORD,
      );
  }
}
export async function sessionFor(db, req) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("cloudops_session="))
    ?.slice(17);
  if (!cookie) return null;
  const { rows } = await db.query(
    "SELECT sessions.id,sessions.csrf,sessions.expires_at,users.email,users.id AS user_id FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=$1 AND sessions.expires_at>$2",
    [hash(cookie), new Date().toISOString()],
  );
  return rows[0] || null;
}
export async function newSession(db, userId) {
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(24).toString("hex");
  await db.tx((tx) =>
    tx.query(
      "INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)",
      [
        hash(token),
        userId,
        csrf,
        new Date(Date.now() + 8 * 3600000).toISOString(),
      ],
    ),
  );
  return { token, csrf };
}
export function setSessionCookie(res, token, production) {
  res.cookie("cloudops_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: production,
    path: "/",
    maxAge: 8 * 3600000,
  });
}
export async function audit(tx, userId, action, resource) {
  await tx.query(
    "INSERT INTO audit(id,user_id,action,resource,at) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), userId, action, resource, new Date().toISOString()],
  );
}
