import { EntitySchema } from 'typeorm';
import { numericTransformer } from './transformers.js';

export const CustomerPaymentEntity = new EntitySchema({
  name: 'CustomerPayment',
  tableName: 'customer_payments',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    projectId: { name: 'project_id', type: 'uuid' },
    entryType: { name: 'entry_type', type: 'text', default: 'PAYMENT' },
    paymentType: { name: 'payment_type', type: 'text', nullable: true },
    amount: { type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer },
    paymentMethod: { name: 'payment_method', type: 'text' },
    paymentDate: { name: 'payment_date', type: 'date' },
    referenceNumber: { name: 'reference_number', type: 'text' },
    receiptFileId: { name: 'receipt_file_id', type: 'uuid', nullable: true },
    reversesPaymentId: { name: 'reverses_payment_id', type: 'uuid', nullable: true },
    notes: { type: 'text', nullable: true },
    recordedBy: { name: 'recorded_by', type: 'uuid' },
    invoiceNumber: { name: 'invoice_number', type: 'text', nullable: true },
    invoiceDescription: { name: 'invoice_description', type: 'text', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  relations: {
    project: { target: 'Project', type: 'many-to-one', joinColumn: { name: 'project_id' } },
    recordedByUser: { target: 'User', type: 'many-to-one', joinColumn: { name: 'recorded_by' } },
    receiptFile: { target: 'File', type: 'many-to-one', joinColumn: { name: 'receipt_file_id' } },
  },
});

