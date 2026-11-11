// Usage: npm run seed            -> creates the admin account only
//        npm run seed -- --demo  -> also creates a demo PM, customer and project
import bcrypt from 'bcryptjs';
import { config } from '../src/config/environment.js';
import { initDb, getManager, closeDb } from '../src/config/database.js';
import { UserEntity, ProjectEntity, ProjectAssignmentEntity } from '../src/entities/index.js';
import { runMigrations } from '../src/migrate.js';

export async function seed({ demo = false } = {}) {
  const exec = getManager();
  const userRepo = exec.getRepository(UserEntity);

  const upsertUser = async (username, fullName, role, password, email) => {
    const found = await userRepo.createQueryBuilder('u')
      .select('u.id')
      .where('lower(u.username) = lower(:username)', { username })
      .getOne();
    if (found) return found.id;
    const hash = await bcrypt.hash(password, 11);
    const saved = await userRepo.save(userRepo.create({
      username,
      fullName,
      email,
      role,
      passwordHash: hash,
    }));
    return saved.id;
  };

  const adminId = await upsertUser('admin', 'Builder Admin', 'ADMIN', config.seedAdminPassword, 'admin@brightlookhomes.in');
  if (demo) {
    const pm = await upsertUser('mahendar', 'Mahendar', 'PROJECT_MANAGER', 'app@123', 'mahendar@brightlookhomes.in');
    const cust = await upsertUser('customer1', 'Ravi Kumar', 'CUSTOMER', 'app@123', 'ravi@example.com');
    const projRepo = exec.getRepository(ProjectEntity);
    const exists = await projRepo.findOne({ select: { id: true }, where: { name: 'Ravi Residence' } });
    if (!exists) {
      const seqRow = await exec.createQueryBuilder()
        .select("nextval('project_code_seq')", 'n')
        .from('pg_database', 'd')
        .where('d.datname = current_database()')
        .getRawOne();
      const code = `BLH-${new Date().getFullYear()}-${seqRow.n}`;
      const today = new Date();
      const startDate = today.toISOString().slice(0, 10);
      const expectedCompletionDate = new Date(today.getTime() + 365 * 86400_000).toISOString().slice(0, 10);
      const p = await projRepo.save(projRepo.create({
        projectCode: code,
        name: 'Ravi Residence',
        description: 'G+1 independent villa',
        location: 'Hyderabad, Telangana',
        projectType: 'Villa',
        contractAmount: 5000000,
        startDate,
        expectedCompletionDate,
        status: 'IN_PROGRESS',
        createdBy: adminId,
      }));
      await exec.getRepository(ProjectAssignmentEntity).insert([
        { projectId: p.id, userId: pm, assignmentRole: 'PROJECT_MANAGER', assignedBy: adminId },
        { projectId: p.id, userId: cust, assignmentRole: 'CUSTOMER', assignedBy: adminId },
      ]);
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed.js')) {
  await initDb();
  await runMigrations();
  await seed({ demo: process.argv.includes('--demo') });
  console.log('Seed complete.');
  await closeDb();
}
