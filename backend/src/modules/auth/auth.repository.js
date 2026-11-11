import { UserEntity, RefreshTokenEntity } from '../../entities/index.js';

export const findByUsername = (exec, username) =>
  exec.getRepository(UserEntity)
    .createQueryBuilder('u')
    .addSelect('u.passwordHash')
    .where('LOWER(u.username) = LOWER(:username)', { username })
    .getOne();

export const findById = (exec, id) =>
  exec.getRepository(UserEntity).findOneBy({ id });

export const registerFailure = (exec, id) =>
  exec.getRepository(UserEntity)
    .createQueryBuilder()
    .update()
    .set({
      failedAttempts: () => 'failed_attempts + 1',
      lockedUntil: () => "CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END",
    })
    .where('id = :id', { id })
    .execute();

export const registerSuccess = (exec, id) =>
  exec.getRepository(UserEntity).update(id, {
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: () => 'now()',
  });

export const insertRefreshToken = (exec, { userId, tokenHash, expiresAt }) => {
  const repo = exec.getRepository(RefreshTokenEntity);
  return repo.save(repo.create({ userId, tokenHash, expiresAt }));
};

export const findRefreshToken = (exec, tokenHash) =>
  exec.getRepository(RefreshTokenEntity).findOneBy({ tokenHash });

export const revokeRefreshToken = (exec, id, replacedBy = null) =>
  exec.getRepository(RefreshTokenEntity)
    .createQueryBuilder()
    .update()
    .set({ revokedAt: () => 'now()', replacedBy })
    .where('id = :id AND revoked_at IS NULL', { id })
    .execute();

export const revokeAllForUser = (exec, userId) =>
  exec.getRepository(RefreshTokenEntity)
    .createQueryBuilder()
    .update()
    .set({ revokedAt: () => 'now()' })
    .where('user_id = :userId AND revoked_at IS NULL', { userId })
    .execute();
