import type {
  RevealField,
  RevealPurpose,
  VaultAdmin,
  VaultApp,
  VaultAppInput,
  VaultAuditEvent,
  VaultConfirmResult,
  VaultCredential,
  VaultCredentialInput,
  VaultEnrollment,
  VaultGrant,
  VaultGrantInput,
  VaultErrorCode,
  VaultProject,
  VaultStatus,
  VaultUnlockResult,
} from '../types/vault';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

/** Error carrying the backend's machine-readable code, so callers can react
 *  to VAULT_LOCKED (open the MFA prompt) without parsing messages. */
export class VaultApiError extends Error {
  status: number;
  code: VaultErrorCode;
  lockedOutUntil?: string;
  constructor(status: number, code: VaultErrorCode, message: string, lockedOutUntil?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.lockedOutUntil = lockedOutUntil;
  }
}

// Listeners told whenever any call comes back VAULT_LOCKED (expiry, lock in
// another tab, logout elsewhere), so the page can drop revealed values and
// show the MFA gate from one place.
type LockedListener = () => void;
const lockedListeners = new Set<LockedListener>();
export function onVaultLocked(fn: LockedListener): () => void {
  lockedListeners.add(fn);
  return () => lockedListeners.delete(fn);
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const raw = localStorage.getItem('devops-dashboard-auth');
    if (raw) headers.Authorization = `Bearer ${JSON.parse(raw).token}`;
  } catch {
    /* no session */
  }
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/vault${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    // Never let the browser HTTP cache keep a vault response.
    cache: 'no-store',
    credentials: 'omit',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data.code as VaultErrorCode) || 'UNKNOWN';
    if (code === 'VAULT_LOCKED') lockedListeners.forEach((l) => l());
    throw new VaultApiError(res.status, code, data.error || `HTTP ${res.status}`, data.lockedOutUntil);
  }
  return data as T;
}

/** Portal users an admin can share with (the admin-only GET /api/users). */
export async function listPortalUsers(): Promise<{ id: string; username: string; fullName: string; role: string; isActive: boolean }[]> {
  const res = await fetch(`${API_BASE}/users`, { headers: authHeaders(), cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(`Could not load people (HTTP ${res.status})`);
  return res.json();
}

export const vaultApi = {
  status: () => request<VaultStatus>('GET', '/status'),
  startEnrollment: () => request<VaultEnrollment>('POST', '/mfa/enroll'),
  confirmEnrollment: (code: string) => request<VaultConfirmResult>('POST', '/mfa/enroll/confirm', { code }),
  unlock: (code: string) => request<VaultUnlockResult>('POST', '/unlock', { code }),
  unlockWithRecoveryCode: (recoveryCode: string) => request<VaultUnlockResult>('POST', '/unlock', { recoveryCode }),
  lock: () => request<void>('POST', '/lock'),

  listProjects: (q = '') => request<VaultProject[]>('GET', `/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createProject: (p: { name: string; description: string }) => request<VaultProject>('POST', '/projects', p),
  updateProject: (id: string, p: { name: string; description: string }) => request<VaultProject>('PUT', `/projects/${id}`, p),
  deleteProject: (id: string) => request<void>('DELETE', `/projects/${id}`),

  listApps: (projectId: string) => request<VaultApp[]>('GET', `/projects/${projectId}/apps`),
  createApp: (projectId: string, a: VaultAppInput) => request<VaultApp>('POST', `/projects/${projectId}/apps`, a),
  updateApp: (id: string, a: VaultAppInput) => request<VaultApp>('PUT', `/apps/${id}`, a),
  deleteApp: (id: string) => request<void>('DELETE', `/apps/${id}`),

  createCredential: (appId: string, c: VaultCredentialInput) =>
    request<VaultCredential>('POST', `/apps/${appId}/credentials`, c),
  updateCredential: (id: string, c: VaultCredentialInput) => request<VaultCredential>('PUT', `/credentials/${id}`, c),
  deleteCredential: (id: string) => request<void>('DELETE', `/credentials/${id}`),
  reveal: (id: string, field: RevealField, purpose: RevealPurpose) =>
    request<{ field: RevealField; value: string }>('POST', `/credentials/${id}/reveal`, { field, purpose }),

  audit: (params: { credentialId?: string; appId?: string; projectId?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    return request<{ events: VaultAuditEvent[]; total: number }>('GET', `/audit?${q.toString()}`);
  },
  members: () => request<VaultAdmin[]>('GET', '/members'),
  resetMemberMfa: (userId: string) => request<void>('POST', `/members/${userId}/mfa/reset`),

  listGrants: (projectId: string) => request<VaultGrant[]>('GET', `/projects/${projectId}/grants`),
  setGrant: (projectId: string, g: VaultGrantInput) => request<VaultGrant>('POST', `/projects/${projectId}/grants`, g),
  revokeGrant: (id: string) => request<void>('DELETE', `/grants/${id}`),
};
