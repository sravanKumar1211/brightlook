import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// Minimal valid ISO-BMFF ftyp box recognized as video/mp4 by file-type
const MP4 = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70, // 'ftyp'
  0x6d, 0x70, 0x34, 0x32, // 'mp42'
  0x00, 0x00, 0x00, 0x00,
  0x6d, 0x70, 0x34, 0x32, // 'mp42'
  0x69, 0x73, 0x6f, 0x6d, // 'isom'
]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

function createMockCloudinary() {
  const uploads = [];
  const destroyed = [];
  const makeStream = (opts, cb) => {
    const chunks = [];
    const s = new PassThrough();
    s.on('data', (c) => chunks.push(c));
    s.on('finish', () => {
      const buf = Buffer.concat(chunks);
      const publicId = `${opts.folder}/${opts.public_id}`;
      const resourceType = opts.resource_type || 'image';
      const secureUrl = `https://res.cloudinary.com/dzdurdxzw/${resourceType}/upload/v1/${publicId}.${resourceType === 'video' ? 'mp4' : 'png'}`;
      uploads.push({ opts, size: buf.length, publicId, resourceType, secureUrl });
      cb(null, { public_id: publicId, secure_url: secureUrl, resource_type: resourceType });
    });
    return s;
  };
  return {
    uploads,
    destroyed,
    client: {
      config: () => {},
      uploader: {
        upload_stream: (opts, cb) => makeStream(opts, cb),
        upload_chunked_stream: (opts, cb) => makeStream(opts, cb),
        destroy: async (publicId, opts) => {
          destroyed.push({ publicId, opts });
          return { result: 'ok' };
        },
      },
    },
  };
}

let tempDir;
let db;
let entities;
let storageMod;
let projectsSvc;
let updatesSvc;
let decisionsSvc;
let billsSvc;
let purgeSvc;
let usersSvc;
let filesMod;
let adminCtx;
let pmCtx;
let mock;
let originalAdapter;

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brightlook-cld-test-'));
  process.env.PGLITE_DIR = 'memory';
  process.env.UPLOAD_DIR = tempDir;

  db = await import('../src/config/database.js');
  entities = await import('../src/entities/index.js');
  const { runMigrations } = await import('../src/migrate.js');
  const { seed } = await import('../seeds/seed.js');
  storageMod = await import('../src/services/fileStorage.service.js');
  projectsSvc = await import('../src/modules/projects/projects.service.js');
  updatesSvc = await import('../src/modules/updates/updates.service.js');
  decisionsSvc = await import('../src/modules/decisions/decisions.service.js');
  billsSvc = await import('../src/modules/bills/bills.service.js');
  purgeSvc = await import('../src/modules/purge/purge.service.js');
  usersSvc = await import('../src/modules/users/users.service.js');
  filesMod = await import('../src/modules/files/files.routes.js');

  originalAdapter = storageMod.storage.cloudinary;

  await db.initDb();
  await runMigrations();
  await seed();

  const adminUser = await db.getRepo(entities.UserEntity).findOneBy({ username: 'admin' });
  adminCtx = { user: adminUser, ip: '127.0.0.1', ua: 'vitest', requestId: 'test-req' };

  const pm = await usersSvc.createUser(adminCtx, {
    username: 'pm_cld',
    fullName: 'PM Cloudinary',
    role: 'PROJECT_MANAGER',
    password: 'Password@123',
    email: 'pm_cld@test.in',
  });
  pmCtx = { user: pm, ip: '127.0.0.1', ua: 'vitest', requestId: 'test-req-pm' };
});

beforeEach(() => {
  mock = createMockCloudinary();
  storageMod.storage.setCloudinaryAdapter(
    new storageMod.CloudinaryStorageAdapter(mock.client, { forceEnabled: true }),
  );
});

afterAll(async () => {
  if (storageMod && originalAdapter) storageMod.storage.setCloudinaryAdapter(originalAdapter);
  if (db) await db.closeDb();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Cloudinary media & video storage', () => {
  it('stores images and videos on Cloudinary with direct URLs, streams Range requests, keeps PDFs local, and cleans up on purge', async () => {
    const project = await projectsSvc.createProject(adminCtx, {
      name: 'Cloud Villa',
      location: 'Hyderabad',
      projectType: 'Villa',
      contractAmount: 1000000,
      projectManagerIds: [pmCtx.user.id],
    }, { originalname: 'cover.png', buffer: PNG, size: PNG.length });

    expect(project.coverImageFileId).toBeTruthy();
    expect(project.coverImageUrl).toMatch(/^https:\/\/res\.cloudinary\.com\/dzdurdxzw\/image\/upload\//);

    const update = await updatesSvc.createUpdate(pmCtx, project.id, {
      type: 'PROGRESS',
      progressPercentage: 25,
      description: 'Slab pouring clip',
    }, {
      photos: [
        { originalname: 'photo.png', buffer: PNG, size: PNG.length },
        { originalname: 'site-walkthrough.mp4', buffer: MP4, size: MP4.length },
      ],
      documents: [
        { originalname: 'spec.pdf', buffer: PDF, size: PDF.length },
      ],
    });

    expect(update.files).toHaveLength(3);
    const photoFile = update.files.find((f) => f.name === 'photo.png');
    const videoFile = update.files.find((f) => f.name === 'site-walkthrough.mp4');
    const pdfFile = update.files.find((f) => f.name === 'spec.pdf');

    expect(photoFile.kind).toBe('PHOTO');
    expect(photoFile.url).toMatch(/^https:\/\/res\.cloudinary\.com\/dzdurdxzw\/image\/upload\//);

    expect(videoFile.kind).toBe('VIDEO');
    expect(videoFile.mimeType).toBe('video/mp4');
    expect(videoFile.url).toMatch(/^https:\/\/res\.cloudinary\.com\/dzdurdxzw\/video\/upload\//);

    expect(pdfFile.kind).toBe('DOCUMENT');
    expect(pdfFile.url).toBeNull();

    const dbFiles = await db.getRepo(entities.FileEntity).findBy({ projectId: project.id });
    const dbVideo = dbFiles.find((f) => f.id === videoFile.id);
    const dbPdf = dbFiles.find((f) => f.id === pdfFile.id);
    expect(dbVideo.storageProvider).toBe('cloudinary');
    expect(dbVideo.resourceType).toBe('video');
    expect(dbPdf.storageProvider).toBe('local');
    expect(dbPdf.externalUrl).toBeNull();

    // Verify authenticated Range streaming endpoint for Cloudinary video
    const origFetch = globalThis.fetch;
    try {
      const slice = MP4.subarray(0, 8);
      let forwardedRange = null;
      globalThis.fetch = async (_url, opts) => {
        forwardedRange = opts?.headers?.Range ?? null;
        return new Response(slice, {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': String(slice.length),
            'content-range': `bytes 0-7/${MP4.length}`,
            'accept-ranges': 'bytes',
          },
        });
      };

      const headers = {};
      const chunks = [];
      let statusCode = 200;
      const mockRes = new Writable({
        write(c, _enc, cb) { chunks.push(c); cb(); },
      });
      mockRes.status = (s) => { statusCode = s; return mockRes; };
      mockRes.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };
      const donePromise = new Promise((resolve) => mockRes.on('finish', resolve));

      await filesMod.serveFile({
        valid: { params: { id: videoFile.id } },
        query: {},
        headers: { range: 'bytes=0-7' },
        user: pmCtx.user,
      }, mockRes);
      await donePromise;

      expect(forwardedRange).toBe('bytes=0-7');
      expect(statusCode).toBe(206);
      expect(headers['content-range']).toBe(`bytes 0-7/${MP4.length}`);
      expect(headers['accept-ranges']).toBe('bytes');
      expect(Buffer.concat(chunks)).toEqual(slice);
    } finally {
      globalThis.fetch = origFetch;
    }

    // Bills keep PDF/image restrictions and never leak externalUrl in DTOs
    const bill = await billsSvc.createBill(pmCtx, {
      projectId: project.id,
      vendorName: 'Concrete Co',
      invoiceNumber: 'INV-CLD-1',
      category: 'Cement',
      amount: 50000,
      billDate: '2026-03-01',
    }, {
      file: [{ originalname: 'bill.png', buffer: PNG, size: PNG.length }],
    });
    expect(bill.currentFileId).toBeTruthy();
    expect(bill.externalUrl).toBeUndefined();

    // Decision attachments also accept video and return Cloudinary URL
    const decision = await decisionsSvc.createDecision(pmCtx, project.id, {
      title: 'Tile finish demo',
      options: [{ label: 'Matte' }, { label: 'Gloss' }],
    }, [{ originalname: 'sample.mp4', buffer: MP4, size: MP4.length }]);
    const detail = await decisionsSvc.getDecision(adminCtx.user, decision.id);
    expect(detail.files).toHaveLength(1);
    expect(detail.files[0].mimeType).toBe('video/mp4');
    expect(detail.files[0].url).toMatch(/^https:\/\/res\.cloudinary\.com\/dzdurdxzw\/video\/upload\//);

    // Purge update deletes Cloudinary photo/video with exact resource_type and local PDF
    await purgeSvc.purgeUpdate(adminCtx, update.id);
    expect(await db.getRepo(entities.ProjectUpdateFileEntity).countBy({ updateId: update.id })).toBe(0);
    expect(mock.destroyed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ opts: { resource_type: 'image', invalidate: true } }),
        expect.objectContaining({ opts: { resource_type: 'video', invalidate: true } }),
      ]),
    );

    // Purge project removes remaining Cloudinary & DB rows (cover, bill image, decision video)
    const destroyedBeforeProjectPurge = mock.destroyed.length;
    await purgeSvc.purgeProject(adminCtx, project.id);
    expect(await db.getRepo(entities.ProjectEntity).countBy({ id: project.id })).toBe(0);
    expect(await db.getRepo(entities.FileEntity).countBy({ projectId: project.id })).toBe(0);
    expect(mock.destroyed.length).toBe(destroyedBeforeProjectPurge + 3);
  });

  it('rejects non-image project covers before uploading to Cloudinary and rolls back Cloudinary on DB failure', async () => {
    await expect(projectsSvc.createProject(adminCtx, {
      name: 'Invalid Cover Project',
      location: 'Hyderabad',
      projectType: 'Villa',
    }, { originalname: 'clip.mp4', buffer: MP4, size: MP4.length })).rejects.toThrow(/Cover must be an image/i);
    expect(mock.uploads).toHaveLength(0);

    // Simulate DB save failure to verify Cloudinary rollback
    const fakeExec = {
      getRepository: () => ({
        create: (x) => x,
        save: async () => { throw new Error('Simulated DB error'); },
      }),
    };
    await expect(storageMod.saveUploadedFile(fakeExec, {
      originalname: 'fail.mp4',
      buffer: MP4,
      size: MP4.length,
    }, { category: 'project-updates', uploadedBy: pmCtx.user.id })).rejects.toThrow('Simulated DB error');
    expect(mock.uploads).toHaveLength(1);
    expect(mock.destroyed).toHaveLength(1);
    expect(mock.destroyed[0]).toMatchObject({
      publicId: mock.uploads[0].publicId,
      opts: { resource_type: 'video', invalidate: true },
    });
  });

  it('switches to upload_chunked_stream for buffers > 20 MB', async () => {
    let chunkedCalled = false;
    const adapter = new storageMod.CloudinaryStorageAdapter({
      config: () => {},
      uploader: {
        upload_stream: () => { throw new Error('Should use upload_chunked_stream'); },
        upload_chunked_stream: (opts, cb) => {
          chunkedCalled = true;
          const s = new PassThrough();
          s.on('data', () => {});
          s.on('finish', () => cb(null, {
            public_id: `${opts.folder}/${opts.public_id}`,
            secure_url: 'https://res.cloudinary.com/dzdurdxzw/video/upload/v1/big.mp4',
            resource_type: 'video',
          }));
          return s;
        },
        destroy: async () => ({ result: 'ok' }),
      },
    }, { forceEnabled: true });

    const bigVideo = Buffer.concat([MP4, Buffer.alloc(21 * 1024 * 1024)]);
    const res = await adapter.put({
      buffer: bigVideo,
      folder: 'brightlook-crm/project-updates/2026/11',
      publicId: 'big-id',
      resourceType: 'video',
    });
    expect(chunkedCalled).toBe(true);
    expect(res.secureUrl).toBe('https://res.cloudinary.com/dzdurdxzw/video/upload/v1/big.mp4');
  });
});
