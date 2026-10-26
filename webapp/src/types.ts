export const ID = 'com.nito.viewport-read-receipts';
export interface Post {id: string; user_id: string; channel_id: string; create_at: number; delete_at?: number; type?: string; message?: string}
export interface State {entities: {general?: {config?: {SiteURL?: string}}; users: {currentUserId: string}; posts: {posts: Record<string, Post>}}}
export interface Store {getState(): State; subscribe(fn: () => void): () => void}
export interface Registry {
 registerPostMessageAttachmentComponent(component: unknown): string;
 unregisterComponent(id: string): void;
}
export interface Config {enabled: boolean; dwell_ms: number; retention_days: number; channel_ids: string[]}
export interface Count {count: number; can_list: boolean}
export interface Reader {user_id: string; username: string; display_name: string}
export interface Batch {posts: Record<string, Count>; rejected: Record<string, number>}
declare global {interface Window {registerPlugin(id: string, plugin: unknown): void}}
