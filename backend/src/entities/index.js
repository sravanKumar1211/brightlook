import { SchemaMigrationEntity } from './schemaMigration.entity.js';
import { UserEntity, RefreshTokenEntity } from './user.entity.js';
import { FileEntity } from './file.entity.js';
import { ProjectEntity, ProjectAssignmentEntity, ProjectProgressHistoryEntity } from './project.entity.js';
import { ProjectStageEntity, ProjectEventEntity, ProjectStageDelayEntity } from './stage.entity.js';
import { ProjectUpdateEntity, ProjectUpdateFileEntity } from './update.entity.js';
import {
  DecisionRequestEntity,
  DecisionOptionEntity,
  DecisionResponseEntity,
  DecisionFileEntity,
  DecisionHistoryEntity,
} from './decision.entity.js';
import { ApprovalRequestEntity, ApprovalActionEntity } from './approval.entity.js';
import {
  VendorBillEntity,
  VendorBillVersionEntity,
  VendorBillAttachmentEntity,
  VendorBillReviewEntity,
} from './bill.entity.js';
import { CustomerPaymentEntity } from './payment.entity.js';
import { NotificationEntity, AuditLogEntity } from './system.entity.js';

export const ALL_ENTITIES = [
  SchemaMigrationEntity,
  UserEntity,
  RefreshTokenEntity,
  FileEntity,
  ProjectEntity,
  ProjectAssignmentEntity,
  ProjectProgressHistoryEntity,
  ProjectStageEntity,
  ProjectEventEntity,
  ProjectStageDelayEntity,
  ProjectUpdateEntity,
  ProjectUpdateFileEntity,
  DecisionRequestEntity,
  DecisionOptionEntity,
  DecisionResponseEntity,
  DecisionFileEntity,
  DecisionHistoryEntity,
  ApprovalRequestEntity,
  ApprovalActionEntity,
  VendorBillEntity,
  VendorBillVersionEntity,
  VendorBillAttachmentEntity,
  VendorBillReviewEntity,
  CustomerPaymentEntity,
  NotificationEntity,
  AuditLogEntity,
];

export {
  SchemaMigrationEntity,
  UserEntity,
  RefreshTokenEntity,
  FileEntity,
  ProjectEntity,
  ProjectAssignmentEntity,
  ProjectProgressHistoryEntity,
  ProjectStageEntity,
  ProjectEventEntity,
  ProjectStageDelayEntity,
  ProjectUpdateEntity,
  ProjectUpdateFileEntity,
  DecisionRequestEntity,
  DecisionOptionEntity,
  DecisionResponseEntity,
  DecisionFileEntity,
  DecisionHistoryEntity,
  ApprovalRequestEntity,
  ApprovalActionEntity,
  VendorBillEntity,
  VendorBillVersionEntity,
  VendorBillAttachmentEntity,
  VendorBillReviewEntity,
  CustomerPaymentEntity,
  NotificationEntity,
  AuditLogEntity,
};

