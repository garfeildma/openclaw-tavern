import { DatabaseSync } from "node:sqlite";

class StatementCompat {
  constructor(stmt) {
    this.stmt = stmt;
  }

  run(...args) {
    return this.stmt.run(...args);
  }

  get(...args) {
    return this.stmt.get(...args);
  }

  all(...args) {
    return this.stmt.all(...args);
  }
}

export class NodeSqliteCompat {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    return new StatementCompat(this.db.prepare(sql));
  }

  enableLoadExtension(allow) {
    if (typeof this.db.enableLoadExtension === "function") {
      this.db.enableLoadExtension(Boolean(allow));
    }
  }

  loadExtension(path) {
    if (typeof this.db.loadExtension !== "function") {
      throw new Error("SQLite driver does not support loadExtension()");
    }
    return this.db.loadExtension(path);
  }

  close() {
    this.db.close();
  }
}
