import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config/environment.js';
import { FileEntity } from '../entities/index.js';
import { AppError } from '../utils/errors.js';

/** Storage adapter contract: put / stream / remove. Swap providers without touching callers. */
export class LocalStorageAdapter {
  constructor(root) { this.root = path.resolve(root); }

  resolve(rel) {
    const full = path.resolve(this.root, rel);
    if (!full.startsWith(this.root + path.sep)) throw new AppError(400, 'Invalid file path');
    return full;
  }

  async put(rel, buffer) {
    const full = this.resolve(rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer, { flag: 'wx' });
  }

  stream(rel) { return createReadStream(this.resolve(rel)); }

  async remove(rel) { await fs.rm(this.resolve(rel), { force: true }); }
}

const CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024;

export class CloudinaryStorageAdapter {
  constructor(client = cloudinary, options = {}) {
    this.client = client;
    this.forceEnabled = Boolean(options.forceEnabled);
    this.syncConfig();
  }

  syncConfig() {
    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    if (cloudName && apiKey && apiSecret && typeof this.client?.config === 'function') {
      this.client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    }
  }

  isEnabled() {
    if (this.forceEnabled) return true;
    const { cloudName, apiKey, apiSecret } = config.cloudinary;
    return Boolean(cloudName && apiKey && apiSecret) && !config.isTest;
  }

  async put({ buffer, folder, publicId, resourceType = 'image' }) {
    this.syncConfig();
    const uploadOpts = {
      folder,
      public_id: publicId,
      resource_type: resourceType,
      overwrite: false,
      unique_filename: false,
    };

    const result = await new Promise((resolve, reject) => {
      const done = (err, res) => {
        if (err) reject(new AppError(502, `Media upload failed: ${err.message || 'Cloudinary error'}`));
        else if (!res?.secure_url || !res?.public_id) reject(new AppError(502, 'Media upload did not return a valid asset URL'));
        else resolve(res);
      };
      const uploader = this.client.uploader;
      const stream = buffer.length > CHUNK_THRESHOLD_BYTES && typeof uploader.upload_chunked_stream === 'function'
        ? uploader.upload_chunked_stream(uploadOpts, done)
        : uploader.upload_stream(uploadOpts, done);
      stream.on('error', (err) => reject(new AppError(502, `Media upload stream failed: ${err.message || 'Cloudinary error'}`)));
      Readable.from(buffer).pipe(stream);
    });

    return {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      resourceType: result.resource_type || resourceType,
    };
  }

  async remove(publicId, resourceType = 'image') {
    if (!publicId) return;
    this.syncConfig();
    await this.client.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  }
}

const localAdapter = new LocalStorageAdapter(config.uploadDir);
let cloudinaryAdapter = new CloudinaryStorageAdapter();

export const storage = {
  get local() { return localAdapter; },
  get cloudinary() { return cloudinaryAdapter; },
  setCloudinaryAdapter(adapter) { cloudinaryAdapter = adapter; },
  put: (rel, buffer) => localAdapter.put(rel, buffer),
  stream: (rel) => localAdapter.stream(rel),
  remove: (relOrFile) => {
    if (relOrFile && typeof relOrFile === 'object') return storage.removeFile(relOrFile);
    return localAdapter.remove(relOrFile);
  },
  async removeFile(file) {
    if (!file) return;
    if (file.storageProvider === 'cloudinary') {
      const resourceType = file.resourceType || (file.mimeType?.startsWith('video/') ? 'video' : file.mimeType?.startsWith('image/') ? 'image' : 'raw');
      await cloudinaryAdapter.remove(file.storedName, resourceType);
      return;
    }
    if (file.relativePath) await localAdapter.remove(file.relativePath);
  },
};

const CATEGORIES = new Set(['projects', 'project-updates', 'vendor-bills', 'decisions', 'payments', 'profiles']);
// Allowed by *detected* content (magic bytes), not by client-supplied extension/MIME.
export const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'application/pdf': 'pdf',
};

export async function saveUploadedFile(exec, file, {
  category,
  uploadedBy,
  projectId = null,
  visibility = 'PROJECT',
  allowedPrefixes = null,
  invalidTypeMessage = null,
}) {
  if (!CATEGORIES.has(category)) throw new AppError(500, 'Invalid storage category');
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !ALLOWED[detected.mime]) {
    throw new AppError(400, `"${file.originalname}" is not an allowed file type (JPEG, PNG, WebP, MP4, WebM, MOV or PDF)`);
  }
  if (allowedPrefixes && !allowedPrefixes.some((p) => detected.mime.startsWith(p) || detected.mime === p)) {
    throw new AppError(400, invalidTypeMessage || `"${file.originalname}" is not an allowed file type for this field`);
  }

  const isVideo = detected.mime.startsWith('video/');
  const isImage = detected.mime.startsWith('image/');
  const size = file.size ?? file.buffer.length;
  const maxBytes = isVideo ? config.maxVideoUploadBytes : config.maxUploadBytes;
  if (size > maxBytes) {
    throw new AppError(400, `"${file.originalname}" is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`);
  }

  const ext = ALLOWED[detected.mime];
  const fileUuid = crypto.randomUUID();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const isMedia = isImage || isVideo;
  const useCloudinary = isMedia && cloudinaryAdapter.isEnabled();

  if (useCloudinary) {
    const folder = `${config.cloudinary.folder}/${category}/${yyyy}/${mm}`;
    const uploaded = await cloudinaryAdapter.put({
      buffer: file.buffer,
      folder,
      publicId: fileUuid,
      resourceType: isVideo ? 'video' : 'image',
    });
    try {
      const fileRepo = exec.getRepository(FileEntity);
      return await fileRepo.save(fileRepo.create({
        originalName: path.basename(file.originalname).slice(0, 255),
        storedName: uploaded.publicId,
        relativePath: `cloudinary/${uploaded.resourceType}/${uploaded.publicId}`,
        mimeType: detected.mime,
        fileExtension: ext,
        fileSize: size,
        storageProvider: 'cloudinary',
        externalUrl: uploaded.secureUrl,
        resourceType: uploaded.resourceType,
        checksum,
        projectId,
        visibility,
        uploadedBy,
      }));
    } catch (err) {
      await cloudinaryAdapter.remove(uploaded.publicId, uploaded.resourceType).catch(() => {});
      throw err;
    }
  }

  const storedName = `${fileUuid}.${ext}`;
  const relativePath = `${category}/${yyyy}/${mm}/${storedName}`;
  await localAdapter.put(relativePath, file.buffer);
  try {
    const fileRepo = exec.getRepository(FileEntity);
    return await fileRepo.save(fileRepo.create({
      originalName: path.basename(file.originalname).slice(0, 255),
      storedName,
      relativePath,
      mimeType: detected.mime,
      fileExtension: ext,
      fileSize: size,
      storageProvider: 'local',
      externalUrl: null,
      resourceType: null,
      checksum,
      projectId,
      visibility,
      uploadedBy,
    }));
  } catch (err) {
    await localAdapter.remove(relativePath).catch(() => {});
    throw err;
  }
}

export async function saveMany(exec, files = [], opts) {
  const saved = [];
  for (const f of files) saved.push(await saveUploadedFile(exec, f, opts)); // sequential: one tx connection
  return saved;
}
