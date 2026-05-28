export interface ContainerURL {
  publicPort: number;
  url: string;
  domain?: string;
  viaNginx: boolean;
}

export interface ContainerView {
  id: string;
  name: string;
  image: string;
  status: string;
  urls: ContainerURL[] | null;
}

export interface ProjectGroup {
  project: string;
  workingDir: string;
  containers: ContainerView[];
}

export interface RunningAppsResponse {
  projects: ProjectGroup[];
  // Names of root-groups that an admin has pinned for this server. The frontend
  // sorts these to the top of the cards (visible to every viewer).
  pinned: string[];
  agentMissing: boolean;
}
