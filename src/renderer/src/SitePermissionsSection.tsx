import type { SitePermission } from '../../shared/ipc.js';

type SitePermissionsSectionProps = {
  permissions: SitePermission[];
  onReset(origin?: string, key?: string): void;
};

const LABELS: Record<string, string> = {
  geolocation: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  'display-capture': 'Screen sharing',
  pointerLock: 'Mouse lock',
  keyboardLock: 'Keyboard lock',
  'idle-detection': 'Idle detection',
  'window-management': 'Window management',
  midi: 'MIDI devices'
};

export function permissionLabel(key: string): string {
  if (key.startsWith('media:')) {
    const types = key.slice('media:'.length).split(',');
    if (types.includes('audio') && types.includes('video')) return 'Camera & microphone';
    if (types.includes('video')) return 'Camera';
    if (types.includes('audio')) return 'Microphone';
    return 'Camera or microphone';
  }
  if (key.startsWith('openExternal:')) {
    return `Open ${key.slice('openExternal:'.length)} links in another app`;
  }
  return LABELS[key] ?? key;
}

export function SitePermissionsSection({ permissions, onReset }: SitePermissionsSectionProps) {
  return (
    <section className="side-section" aria-label="Site permissions">
      <div className="side-section-header">
        <h3>Site permissions</h3>
        <button type="button" className="link-button" onClick={() => onReset()} disabled={permissions.length === 0}>
          Reset all
        </button>
      </div>
      <p className="muted small">
        Sites must ask before using your camera, microphone, location, or notifications. Device access (USB, serial, HID) is always
        blocked.
      </p>
      {permissions.length === 0 ? (
        <p className="muted small">No saved choices yet.</p>
      ) : (
        <ul className="permission-list">
          {permissions.map((entry) => (
            <li key={`${entry.origin}|${entry.key}`}>
              <div>
                <strong>{new URL(entry.origin).host}</strong>
                <span className="muted small">{permissionLabel(entry.key)}</span>
              </div>
              <span className={entry.decision === 'allow' ? 'permission-pill allowed' : 'permission-pill blocked'}>
                {entry.decision === 'allow' ? 'Allowed' : 'Blocked'}
              </span>
              <button
                type="button"
                className="link-button"
                onClick={() => onReset(entry.origin, entry.key)}
                aria-label={`Reset ${permissionLabel(entry.key)} for ${entry.origin}`}
              >
                Reset
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
