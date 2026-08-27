import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { ProjectModel } from "@/lib/finance/appraisal";
import type { NewsArticle } from "@/lib/news/gdelt";
import { newsItems, projects } from "./schema";

export interface StoredProject {
  id: string;
  model: ProjectModel;
  createdAt: string;
  updatedAt: string;
}

export interface StoredNewsItem {
  id: string;
  projectId: string;
  keyword: string;
  title: string;
  url: string;
  domain: string;
  language: string;
  publishedAt: string;
  fetchedAt: string;
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
    );
    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      language TEXT NOT NULL,
      published_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS news_items_project_url ON news_items (project_id, url);
    CREATE INDEX IF NOT EXISTS news_items_project_published ON news_items (project_id, published_at DESC);
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
      db.delete(newsItems).where(eq(newsItems.projectId, id)).run();
      return true;
    },
    list() {
      return db
        .select({ id: projects.id, name: projects.name, currency: projects.currency, updatedAt: projects.updatedAt })
        .from(projects)
        .orderBy(desc(projects.updatedAt))
        .all();
    },
    /** 追加新闻；按 (project_id, url) 去重，返回实际新增条数。 */
    addNewsItems(projectId: string, keyword: string, articles: NewsArticle[], fetchedAt = new Date().toISOString()): number {
      let inserted = 0;
      for (const article of articles) {
        const result = db
          .insert(newsItems)
          .values({
            id: crypto.randomUUID(),
            projectId,
            keyword,
            title: article.title,
            url: article.url,
            domain: article.domain,
            language: article.language,
            publishedAt: article.seenAt,
            fetchedAt,
          })
          .onConflictDoNothing()
          .run();
        inserted += result.changes;
      }
      return inserted;
    },
    listNewsItems(projectId: string, limit = 50): StoredNewsItem[] {
      return db
        .select()
        .from(newsItems)
        .where(eq(newsItems.projectId, projectId))
        .orderBy(desc(newsItems.publishedAt))
        .limit(limit)
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
