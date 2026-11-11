import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const VendorBillEntity = new EntitySchema({
  name: 'VendorBill',
  tableName: 'vendor_bills',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    submittedBy: { name: 'submitted_by', type: 'uuid' },
    vendorName: { name: 'vendor_name', type: 'text' },
    invoiceNumber: { name: 'invoice_number', type: 'text' },
    amount: { type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer },
    taxAmount: { name: 'tax_amount', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer },
    billDate: { name: 'bill_date', type: 'date' },
    dueDate: { name: 'due_date', type: 'date', nullable: true },
    description: { type: 'text', nullable: true },
    category: { type: 'text', nullable: true },
    status: { type: 'text', default: 'PENDING_ADMIN_REVIEW' },
    currentVersion: { name: 'current_version', type: 'int', default: 1 },
    approvedAt: { name: 'approved_at', type: 'timestamptz', nullable: true },
    paidAt: { name: 'paid_at', type: 'timestamptz', nullable: true },
    paymentMode: { name: 'payment_mode', type: 'text', nullable: true },
    paymentReference: { name: 'payment_reference', type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    submittedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'submitted_by' } },
    versions: { target: 'VendorBillVersion', type: 'one-to-many', inverseSide: 'bill' },
    attachments: { target: 'VendorBillAttachment', type: 'one-to-many', inverseSide: 'bill' },
    reviews: { target: 'VendorBillReview', type: 'one-to-many', inverseSide: 'bill' },
  },
});

export const VendorBillVersionEntity = new EntitySchema({
  name: 'VendorBillVersion',
  tableName: 'vendor_bill_versions',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    billId: { name: 'bill_id', type: 'uuid' },
    versionNo: { name: 'version_no', type: 'int' },
    fileId: { name: 'file_id', type: 'uuid' },
    amount: { type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer },
    note: { type: 'text', nullable: true },
    submittedBy: { name: 'submitted_by', type: 'uuid' },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    bill: { target: 'VendorBill', type: 'many-to-one', joinColumn: { name: 'bill_id' } },
    file: { target: 'File', type: 'many-to-one', joinColumn: { name: 'file_id' } },
    submittedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'submitted_by' } },
  },
});

export const VendorBillAttachmentEntity = new EntitySchema({
  name: 'VendorBillAttachment',
  tableName: 'vendor_bill_attachments',
  columns: {
    billId: { name: 'bill_id', type: 'uuid', primary: true },
    fileId: { name: 'file_id', type: 'uuid', primary: true },
    versionNo: { name: 'version_no', type: 'int' },
  },
  relations: {
    bill: { target: 'VendorBill', type: 'many-to-one', joinColumn: { name: 'bill_id' } },
    file: { target: 'File', type: 'many-to-one', joinColumn: { name: 'file_id' } },
  },
});

export const VendorBillReviewEntity = new EntitySchema({
  name: 'VendorBillReview',
  tableName: 'vendor_bill_reviews',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    billId: { name: 'bill_id', type: 'uuid' },
    versionNo: { name: 'version_no', type: 'int' },
    actorId: { name: 'actor_id', type: 'uuid', nullable: true },
    action: { type: 'text' },
    comment: { type: 'text', nullable: true },
    previousStatus: { name: 'previous_status', type: 'text', nullable: true },
    newStatus: { name: 'new_status', type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    bill: { target: 'VendorBill', type: 'many-to-one', joinColumn: { name: 'bill_id' } },
    actorUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'actor_id' } },
  },
});

