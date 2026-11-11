import { ProjectEntity, ProjectAssignmentEntity } from '../entities/index.js';
import { notFound, forbidden } from '../utils/errors.js';

/**
 * Resource-level authorization. ADMIN can access everything; PMs and customers only
 * projects they are actively assigned to in their own role. Returns the project entity.
 */
export async function requireProjectAccess(exec, user, projectId, { roles } = {}) {
  if (roles && !roles.includes(user.role)) throw forbidden('Your role cannot perform this action');
  const project = await exec.getRepository(ProjectEntity).findOne({
    where: { id: projectId },
    withDeleted: true,
  });
  if (!project || (project.deletedAt && user.role !== 'ADMIN')) throw notFound('Project');
  if (user.role === 'ADMIN') return project;
  const assigned = await exec.getRepository(ProjectAssignmentEntity).existsBy({
    projectId,
    userId: user.id,
    assignmentRole: user.role,
    isActive: true,
  });
  if (!assigned) throw forbidden('You are not assigned to this project');
  return project;
}
