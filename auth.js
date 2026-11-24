import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);

export async function createAccount(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 10) throw new Error('Password must be at least 10 characters.');
  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, normalized, passwordHash);
  return { id, email: normalized };
}

export async function verifyAccount(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) throw new Error('Email or password is incorrect.');
  return { id: user.id, email: user.email };
}

export function tokenFor(user) {
  if (!process.env.JWT_SECRET) throw new Error('Set JWT_SECRET in .env before starting ReCast.');
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '14d' });
}

export function authenticate(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const claims = jwt.verify(token, process.env.JWT_SECRET || '');
    req.user = { id: claims.sub, email: claims.email };
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again to continue.' });
  }
}
