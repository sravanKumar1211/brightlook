import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const FileEntity = new EntitySchema({
  name: 'File',
  tableName: 'files',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    originalName: { name: 'original_name', type: 'text' },
    storedName: { name: 'stored_name', type: 'text' },
    relativePath: { name: 'relative_path', type: 'text', unique: true },
    mimeType: { name: 'mime_type', type: 'text' },
    fileExtension: { name: 'file_extension', type: 'text' },
    fileSize: { name: 'file_size', type: 'bigint', transformer: numericTransformer },
    storageProvider: { name: 'storage_provider', type: 'text', default: 'local' },
    externalUrl: { name: 'external_url', type: 'text', nullable: true },
    resourceType: { name: 'resource_type', type: 'text', nullable: true },
    checksum: { type: 'text' },
    projectId: { name: 'project_id', type: 'uuid', nullable: true },
    visibility: { type: 'text', default: 'PROJECT' },
    uploadedBy: { name: 'uploaded_by', type: 'uuid', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    uploader: { target: 'User', type: 'many-to-one', joinColumn: { name: 'uploaded_by' } },
  },
});

