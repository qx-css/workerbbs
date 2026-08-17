export interface Bindings {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SITE_NAME?: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  pass_hash: string;
  role: 'user' | 'admin';
  exp: number;
  avatar: string;
  bio: string;
  bg_image: string;
  banned: number;
  created_at: number;
}

export interface PublicUser {
  id: number;
  username: string;
  role: string;
  level: number;
  exp: number;
  avatar: string;
  bio: string;
  bg_image: string;
  banned: number;
  created_at: number;
}

export interface Board {
  id: number;
  name: string;
  description: string;
  sort: number;
}

export interface Thread {
  id: number;
  board_id: number;
  user_id: number;
  title: string;
  body: string;
  views: number;
  pinned: number;
  deleted: number;
  created_at: number;
}

export interface Reply {
  id: number;
  thread_id: number;
  user_id: number;
  body: string;
  deleted: number;
  created_at: number;
}
