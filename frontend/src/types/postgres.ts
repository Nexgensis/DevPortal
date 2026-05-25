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
