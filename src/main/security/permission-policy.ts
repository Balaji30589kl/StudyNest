/**
 * Site permission policy (pure). Electron grants every permission by default;
 * StudyNest instead allows a few harmless ones, asks for sensitive ones, and
 * denies device-level access outright.
 */

export type PermissionVerdict = 'allow' | 'ask' | 'deny';
export type StoredDecision = 'allow' | 'deny';

const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write']);

const ASK = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'display-capture',
  'pointerLock',
  'keyboardLock',
  'idle-detection',
  'window-management',
  'midi',
  'storage-access',
  'top-level-storage-access',
  'speaker-selection',
  'openExternal'
]);

export function classifyPermission(permission: string): PermissionVerdict {
  if (ALWAYS_ALLOW.has(permission)) return 'allow';
  if (ASK.has(permission)) return 'ask';
  // midiSysex, hid, serial, usb, unknown, and anything new default to deny.
  return 'deny';
}

export type PermissionDetails = {
  mediaTypes?: string[];
  externalURL?: string;
};

/** Key used to remember a decision. Media is split by device type. */
export function permissionKey(permission: string, details: PermissionDetails = {}): string {
  if (permission === 'media') {
    const types = [...new Set(details.mediaTypes ?? [])].filter(Boolean).sort();
    return `media:${types.length > 0 ? types.join(',') : 'any'}`;
  }
  if (permission === 'openExternal' && details.externalURL) {
    try {
      return `openExternal:${new URL(details.externalURL).protocol.replace(':', '')}`;
    } catch {
      return 'openExternal:unknown';
    }
  }
  return permission;
}

export function describePermission(permission: string, details: PermissionDetails = {}): string {
  switch (permission) {
    case 'media': {
      const types = details.mediaTypes ?? [];
      if (types.includes('video') && types.includes('audio')) return 'use your camera and microphone';
      if (types.includes('video')) return 'use your camera';
      if (types.includes('audio')) return 'use your microphone';
      return 'use your camera or microphone';
    }
    case 'geolocation':
      return 'know your location';
    case 'notifications':
      return 'show notifications';
    case 'clipboard-read':
      return 'see text and images copied to your clipboard';
    case 'display-capture':
      return 'see your screen';
    case 'pointerLock':
      return 'hide and lock your mouse pointer';
    case 'keyboardLock':
      return 'capture all keyboard shortcuts';
    case 'idle-detection':
      return 'know when you are using this device';
    case 'window-management':
      return 'manage windows on your displays';
    case 'midi':
      return 'use your MIDI devices';
    case 'storage-access':
    case 'top-level-storage-access':
      return 'use cookies and site data from another site';
    case 'speaker-selection':
      return 'choose your audio output';
    case 'openExternal': {
      let protocol = 'another application';
      try {
        if (details.externalURL) protocol = `a "${new URL(details.externalURL).protocol.replace(':', '')}" link in another app`;
      } catch {
        // Keep the generic wording.
      }
      return `open ${protocol}`;
    }
    default:
      return `use "${permission}"`;
  }
}

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

export type SitePermissionEntry = { origin: string; key: string; decision: StoredDecision; decidedAt: number };

export function parseSitePermissions(raw: unknown): SitePermissionEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter(
      (entry): entry is SitePermissionEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SitePermissionEntry).origin === 'string' &&
        typeof (entry as SitePermissionEntry).key === 'string' &&
        ((entry as SitePermissionEntry).decision === 'allow' || (entry as SitePermissionEntry).decision === 'deny') &&
        typeof (entry as SitePermissionEntry).decidedAt === 'number'
    )
    .slice(-500);
}

/**
 * Synchronous permission checks (navigator.permissions.query, some media
 * checks) only know the permission name, so answer from stored decisions:
 * a media check passes if any media decision for the origin is "allow".
 */
export function answerPermissionCheck(entries: readonly SitePermissionEntry[], origin: string, permission: string): boolean {
  const verdict = classifyPermission(permission);
  if (verdict === 'allow') return true;
  if (verdict === 'deny') return false;
  return entries.some(
    (entry) =>
      entry.origin === origin &&
      entry.decision === 'allow' &&
      (entry.key === permission || (permission === 'media' && entry.key.startsWith('media:')))
  );
}
