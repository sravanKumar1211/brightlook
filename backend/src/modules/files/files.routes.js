import { Readable } from 'node:stream';
import { Router } from 'express';
import { getRepo } from '../../config/database.js';
import { FileEntity, ProjectAssignmentEntity } from '../../entities/index.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { idParam } from '../../validators/common.js';
import { asyncHandler } from '../../utils/helpers.js';
import { AppError, forbidden, notFound } from '../../utils/errors.js';
import { storage } from '../../services/fileStorage.service.js';

const router = Router();
router.use(authenticate);

/** Authenticated file access: admin, uploader, or a user assigned to the file's project (customers: PROJECT visibility only). */
async function canAccess(user, file) {
  if (user.role === 'ADMIN' || file.uploadedBy === user.id) return true;
  if (!file.projectId) return false;
  if (user.role === 'CUSTOMER' && file.visibility !== 'PROJECT') return false;
  return getRepo(ProjectAssignmentEntity).existsBy({
    projectId: file.projectId,
    userId: user.id,
    assignmentRole: user.role,
    isActive: true,
  });
}

export async function serveFile(req, res) {
  const file = await getRepo(FileEntity).findOneBy({ id: req.valid.params.id });
  if (!file) throw notFound('File');
  if (!(await canAccess(req.user, file))) throw forbidden('You do not have access to this file');

  const safeName = encodeURIComponent(file.originalName);
  const disposition = `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${safeName}`;

  if (file.storageProvider === 'cloudinary' && file.externalUrl) {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    let upstream;
    try {
      upstream = await fetch(file.externalUrl, {
        headers: req.headers.range ? { Range: req.headers.range } : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') return;
      throw new AppError(502, 'Unable to reach media storage provider');
    }
    if (!upstream.ok && upstream.status !== 206) {
      throw new AppError(502, 'Unable to stream media from storage provider');
    }
    res.status(upstream.status);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || file.mimeType);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    if (!upstream.body) return res.end();
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => { if (!res.destroyed) res.destroy(); });
    return nodeStream.pipe(res);
  }

  if (!(await storage.exists(file.relativePath))) throw notFound('File');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.fileSize));
  storage.stream(file.relativePath).on('error', () => res.destroy()).pipe(res);
}

router.get('/:id', validate({ params: idParam }), asyncHandler(serveFile));

export default router;
