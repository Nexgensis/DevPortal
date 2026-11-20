// Password vault DTOs — mirror backend/vault/*.go. None of these ever carry a
// secret except RevealResponse, which is held in component state only.

export interface VaultStatus {
  enrolled: boolean;
  pendingEnrollment: boolean;
  unlocked: boolean;
  unlockExpiresAt: string | null;
  lockedOutUntil: string | null;
  recoveryCodesRemaining: number;
  sessionUpgradeRequired: boolean;
  /** admin = everything; member = only clients/apps shared with them. */
  role: 'admin' | 'member';
  /** How this portal session signed in. */
  loginMethod: 'pwd' | 'sso' | '';
  /** Ways this session may unlock: Microsoft sign-in and/or authenticator app. */
  methods: { microsoft: boolean; totp: boolean };
}

/** Caller's level on a client/app. "limited" = only some apps of the client
 *  were shared with them. */
export type VaultAccess = 'admin' | 'edit' | 'view' | 'limited';

export interface VaultGrant {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  projectId: string;
  appId: string | null; // null = the whole client
  appName: string;
  level: 'view' | 'edit';
  expiresAt: string | null;
  expired: boolean;
  grantedBy: string;
  updatedAt: string;
}

export interface VaultGrantInput {
  userId: string;
  appId: string; // "" = whole client
  level: 'view' | 'edit';
  expiresAt: string | null;
}

export interface VaultEnrollment {
  secret: string;
  otpauthUrl: string;
  qrCodePng: string; // data: URL
  expiresAt: string;
}

export interface VaultConfirmResult {
  recoveryCodes: string[];
  unlockExpiresAt: string;
}

export interface VaultUnlockResult {
  unlockExpiresAt: string;
  recoveryCodesRemaining?: number;
}

export interface VaultProject {
  id: string;
  name: string;
  description: string;
  appCount: number;
  credentialCount: number;
  access: VaultAccess;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** An app or service inside a client (AWS Console, Prod DB). Holds the login
 *  URL; its accounts carry the usernames and encrypted passwords. */
export interface VaultApp {
  id: string;
  projectId: string;
  name: string;
  loginUrl: string;
  description: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  access: VaultAccess;
  accounts: VaultCredential[];
}

export interface VaultAppInput {
  name: string;
  loginUrl: string;
  description: string;
}

/** One account (username + password) for an app. */
export interface VaultCredential {
  id: string;
  appId: string;
  label: string;
  username: string;
  hasNotes: boolean;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultCredentialInput {
  label: string;
  username: string;
  // Create: required. Update: omit/empty to keep the stored password.
  password?: string;
  // Omit to keep stored notes; "" clears them.
  notes?: string;
}

export type RevealField = 'password' | 'notes';
export type RevealPurpose = 'view' | 'copy';

export interface VaultAuditEvent {
  id: number;
  occurredAt: string;
  actorUserId: string | null;
  actorUsername: string;
  action: string;
  projectId: string | null;
  appId: string | null;
  credentialId: string | null;
  targetUserId: string | null;
  ip: string;
  userAgent: string;
  details: Record<string, unknown>;
}

export interface VaultAdmin {
  userId: string;
  username: string;
  fullName: string;
  isActive: boolean;
  mfaStatus: 'none' | 'pending' | 'active';
  enrolledAt: string | null;
  role: 'admin' | 'member';
}

// Error codes the backend returns in { code }. The UI keys behaviour on these,
// never on message text.
export type VaultErrorCode =
  | 'VAULT_LOCKED'
  | 'VAULT_NOT_CONFIGURED'
  | 'SESSION_UPGRADE_REQUIRED'
  | 'MFA_INVALID'
  | 'MFA_LOCKED_OUT'
  | 'MFA_NOT_ENROLLED'
  | 'MFA_ALREADY_ENROLLED'
  | 'MFA_NO_PENDING_ENROLLMENT'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'USE_MICROSOFT'
  | 'MICROSOFT_UNAVAILABLE'
  | 'UNKNOWN';
