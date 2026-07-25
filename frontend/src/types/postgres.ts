export interface PostgresContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string[];
  labels?: Record<string, string>;
  created: string;
  server_id: string;
}

export interface PostgresDatabase {
  name: string;
  owner: string;
  encoding: string;
  size?: string;
}

export interface PostgresDumpRequest {
  server_id: string;
  container_id: string;
  database: string;
  /** Resolves stored credentials (keyed by name) for explicit-user dumps. */
  container_name?: string;
}

/** Admin-configured PostgreSQL credentials for a container (password never returned). */
export interface PostgresCredential {
  containerName: string;
  dbUser: string;
  dbName: string;
  hasPassword: boolean;
}

/** Payload to create/update a credential. dbPassword blank on update keeps the stored secret. */
export interface PostgresCredentialInput {
  containerName: string;
  dbUser: string;
  dbName: string;
  dbPassword?: string;
}

/** One non-postgres sibling in the same compose project as a postgres container. */
export interface PostgresConsumer {
  id: string;
  name: string;
  image: string;
  kind: 'frontend' | 'backend' | 'service';
  ports: number[];
  domain?: string;
  databases: string[];           // DB names inferred from this consumer's env vars
  envSource?: string;            // comma-separated env keys that produced them
}

/** One database's live usage, read from the server's own statistics views. */
export interface DatabaseActivity {
  name: string;
  backends: number;              // connections open right now
  txns: number;                  // commits + rollbacks since the last stats reset
}

/** Compose-project context for a postgres container — answers "what uses this DB?". */
export interface PostgresContainerContext {
  hasProject: boolean;
  project?: string;
  workingDir?: string;
  consumers: PostgresConsumer[];
  activeDatabases: string[];     // databases actually in use
  agentMissing: boolean;
  /**
   * How activeDatabases was determined. "pg_stat" means the server itself
   * reported the connections; "compose"/"env" are configured values used only
   * when the server reported nothing, so they may be stale.
   */
  activeSource?: 'pg_stat' | 'compose' | 'env';
  /** Per-database breakdown behind a "pg_stat" answer. */
  activity?: DatabaseActivity[];
}
