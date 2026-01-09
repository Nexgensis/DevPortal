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
  data_only?: boolean;
  schema_only?: boolean;
  tables?: string[];
}
