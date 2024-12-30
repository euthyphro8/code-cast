export interface UpdateConfig {
  serveDirectory?: string;
  listeners: UpdateListener[];
}

export interface UpdateListener {
  filters?: {
    name?: string;
    email?: string;
    username?: string;
  };
  repository: string;
  branch?: string;
  commitFlag?: string;
  dist: {
    in: string;
    out: string;
  };
  strategy: {
    type: 'default' | 'custom';
    script?: string;
  };
}

export interface PushEventPayload {
  ref: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  base_ref?: any;
  compare: string;
  commits: Commit[];
  head_commit: Commit;
  repository: PushRepository;
  pusher: GithubUser;
  sender: Sender;
}

export interface GithubUser {
  name: string;
  email: string;
  username: string;
}

export interface Commit {
  id: string;
  tree_id: string;
  distinct: boolean;
  message: string;
  timestamp: string;
  url: string;
  author: GithubUser;
  committer: GithubUser;
  added: any[];
  removed: any[];
  modified: string[];
}

export interface PushRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GithubUser;
  private: boolean;
  html_url: string;
  description: string;
  fork: boolean;
  url: string;
  commits_url: string;
  created_at: number;
  updated_at: string;
  pushed_at: number;
  git_url: string;
  ssh_url: string;
  size: number;
  default_branch: string;
}

export interface Sender {
  login: string;
  id: number;
  avatar_url: string;
  gravatar_id: string;
  url: string;
  html_url: string;
  repos_url: string;
  events_url: string;
  received_events_url: string;
  type: string;
  site_admin: boolean;
}
