-- Store external media URLs & Cloudinary resource types; allow VIDEO kind on project_update_files.
alter table files add column if not exists external_url text;
alter table files add column if not exists resource_type text;

alter table project_update_files drop constraint if exists project_update_files_kind_check;
alter table project_update_files add constraint project_update_files_kind_check
  check (kind in ('PHOTO','VIDEO','DOCUMENT'));

