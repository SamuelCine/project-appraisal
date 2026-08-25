import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { ProjectModel } from "@/lib/finance/appraisal";
import { projects } from "./schema";

export interface StoredProject {
  id: string;
  model: ProjectModel;
  createdAt: string;
  updatedAt: string;
}

export function createProjectRepository(filePath = process.env.PROJECT_DB_PATH ?? "project-appraisal.db") {
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      model_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const db = drizzle(sqlite);

  return {
    save(model: ProjectModel, id = crypto.randomUUID()): StoredProject {
      const existing = db.select().from(projects).where(eq(projects.id, id)).get();
      const now = new Date().toISOString();
      const createdAt = existing?.createdAt ?? now;
      db.insert(projects)
        .values({ id, name: model.name, currency: model.currency, modelJson: JSON.stringify(model), createdAt, updatedAt: now })
        .onConflictDoUpdate({
          target: projects.id,
          set: { name: model.name, currency: model.currency, modelJson: JSON.stringify(model), updatedAt: now },
        })
        .run();
      return { id, model, createdAt, updatedAt: now };
    },
    get(id: string): StoredProject | null {
      const row = db.select().from(projects).where(eq(projects.id, id)).get();
      return row ? { id: row.id, model: JSON.parse(row.modelJson) as ProjectModel, createdAt: row.createdAt, updatedAt: row.updatedAt } : null;
    },
    remove(id: string): boolean {
      const existing = db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
      if (!existing) return false;
      db.delete(projects).where(eq(projects.id, id)).run();
      return true;
    },
    list() {
      return db
        .select({ id: projects.id, name: projects.name, currency: projects.currency, updatedAt: projects.updatedAt })
        .from(projects)
        .orderBy(desc(projects.updatedAt))
        .all();
    },
    close() {
      sqlite.close();
    },
  };
}

let singleton: ReturnType<typeof createProjectRepository> | undefined;

export function getProjectRepository() {
  singleton ??= createProjectRepository();
  return singleton;
}
