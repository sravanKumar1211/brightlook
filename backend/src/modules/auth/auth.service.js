import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config/environment.js';
import { getManager, withTx } from '../../config/database.js';
import { AppError } from '../../utils/errors.js';
import { recordAudit } from '../../services/auditLog.service.js';
import * as repo from './auth.repository.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);
const DAY = 86_400_000;

export const publicUser = (u) => ({
  id: u.id, username: u.username, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, status: u.status,
});

const signAccess = (user) => jwt.sign({ role: user.role }, config.jwtSecret, { subject: user.id, expiresIn: config.accessTtl });

async function issueTokens(exec, user, remember) {
  const days = remember ? config.refreshTtlRememberDays : config.refreshTtlDays;
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + days * DAY);
  const row = await repo.insertRefreshToken(exec, { userId: user.id, tokenHash: sha256(refreshToken), expiresAt });
  return { accessToken: signAccess(user), refreshToken, refreshExpiresAt: expiresAt, refreshId: row.id };
}

export async function login(ctx, { username, password, remember }) {
  const mgr = getManager();
  const user = await repo.findByUsername(mgr, username);
  const fail = async (reason, actor) => {
    await recordAudit(mgr, ctx, {
      actor: actor ? { id: actor.id, role: actor.role } : null,
      action: 'LOGIN_FAILED', module: 'AUTH', entityType: 'user', entityId: actor?.id,
      description: `Failed login for "${username}" (${reason})`,
    });
    throw new AppError(401, 'Invalid username or password');
  };
  if (!user) { await bcrypt.compare(password, DUMMY_HASH); return fail('unknown user'); }
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw new AppError(423, 'Account temporarily locked after repeated failures. Try again later.');
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await repo.registerFailure(mgr, user.id);
    return fail('wrong password', user);
  }
  if (user.status !== 'ACTIVE') return fail('inactive account', user);

  const tokens = await withTx(async (tx) => {
    await repo.registerSuccess(tx, user.id);
    const t = await issueTokens(tx, user, remember);
    await recordAudit(tx, ctx, { actor: { id: user.id, role: user.role }, action: 'LOGIN', module: 'AUTH', entityType: 'user', entityId: user.id, description: `${user.username} logged in` });
    return t;
  });
  return { user: publicUser(user), ...tokens };
}

export async function refresh(rawToken) {
  if (!rawToken) throw new AppError(401, 'No refresh token');
  const mgr = getManager();
  const row = await repo.findRefreshToken(mgr, sha256(rawToken));
  if (!row) throw new AppError(401, 'Invalid refresh token');
  if (row.revokedAt) {
    // A rotated token being replayed means it may be stolen: kill every session for that user.
    await repo.revokeAllForUser(mgr, row.userId);
    throw new AppError(401, 'Session invalidated, please sign in again');
  }
  if (new Date(row.expiresAt) < new Date()) throw new AppError(401, 'Session expired');
  const user = await repo.findById(mgr, row.userId);
  if (!user || user.status !== 'ACTIVE') throw new AppError(401, 'Account is not active');
  const remember = new Date(row.expiresAt) - Date.now() > config.refreshTtlDays * DAY;
  const tokens = await withTx(async (tx) => {
    const t = await issueTokens(tx, user, remember);
    await repo.revokeRefreshToken(tx, row.id, t.refreshId);
    return t;
  });
  return { user: publicUser(user), ...tokens };
}

export async function logout(ctx, rawToken) {
  if (rawToken) {
    const mgr = getManager();
    const row = await repo.findRefreshToken(mgr, sha256(rawToken));
    if (row) {
      await repo.revokeRefreshToken(mgr, row.id);
      const user = await repo.findById(mgr, row.userId);
      await recordAudit(mgr, ctx, { actor: user && { id: user.id, role: user.role }, action: 'LOGOUT', module: 'AUTH', entityType: 'user', entityId: row.userId, description: 'User logged out' });
    }
  }
}

export async function me(userId) {
  const user = await repo.findById(getManager(), userId);
  return publicUser(user);
}
