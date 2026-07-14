declare module "better-sqlite3-multiple-ciphers" {
  type BindValue = string | number | bigint | Buffer | null;
  type Row = Record<string, unknown>;

  class Statement {
    run(...params: BindValue[]): { changes: number; lastInsertRowid: number | bigint };
    get<T = Row>(...params: BindValue[]): T | undefined;
    all<T = Row>(...params: BindValue[]): T[];
  }

  class Database {
    constructor(path: string);
    pragma(command: string): unknown;
    exec(sql: string): void;
    prepare(sql: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    backup(path: string): Promise<void>;
    close(): void;
  }

  export = Database;
}
