import { ArrowLeft, ArrowRight, Download, Home, MoreHorizontal, RotateCw, X } from 'lucide-react';
import { RefObject, useRef } from 'react';
import type { BrowserSettings } from '../../../shared/browser-settings.js';
import type { Bookmark, BrowserTabState, StudySessionState } from '../../../shared/ipc.js';
import { NEW_TAB_URL } from '../../../shared/internal-pages.js';
import { formatCountdown, formatElapsed } from '../study-format.js';
import { AddressBar } from './AddressBar.js';
import { bridge } from './common.js';

type Props = {
  activeTab: BrowserTabState | undefined;
  tabs: BrowserTabState[];
  activeTabId: string | null;
  bookmarks: Bookmark[];
  settings: BrowserSettings;
  addressInputRef: RefObject<HTMLInputElement | null>;
  studySession: StudySessionState | null;
  /** The AI gateway can't be reached, so Study Mode is using offline keyword rules. */
  aiOffline: boolean;
  now: number;
  activePanel: string | null;
  downloadsVisible: boolean;
  activeDownloads: number;
  onEditingChange: (editing: boolean) => void;
  onToggleBookmark: () => void;
  onToggleStudy: () => void;
  onTogglePanel: (panel: 'study' | 'downloads') => void;
};

export function Toolbar(props: Props) {
  const { activeTab, studySession, now } = props;
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabId = props.activeTabId ?? undefined;

  const openMenu = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (rect) void bridge?.showAppMenu({ x: rect.right - 260, y: rect.bottom + 4 });
  };

  const studyLabel = studySession
    ? studySession.endsAt !== null
      ? `Focus ${formatCountdown(studySession.endsAt - now)}`
      : `Studying ${formatElapsed(now - studySession.startedAt)}`
    : 'Study Mode';

  return (
    <div className="toolbar">
      <button
        type="button"
        className="tool-button"
        aria-label="Back"
        title="Back (Alt+Left)"
        disabled={!activeTab?.canGoBack}
        onClick={() => void bridge?.goBack(tabId)}
      >
        <ArrowLeft size={18} strokeWidth={1.9} />
      </button>
      <button
        type="button"
        className="tool-button"
        aria-label="Forward"
        title="Forward (Alt+Right)"
        disabled={!activeTab?.canGoForward}
        onClick={() => void bridge?.goForward(tabId)}
      >
        <ArrowRight size={18} strokeWidth={1.9} />
      </button>
      {activeTab?.isLoading && !activeTab.checking ? (
        <button type="button" className="tool-button" aria-label="Stop loading" title="Stop loading (Esc)" onClick={() => void bridge?.stop(tabId)}>
          <X size={18} strokeWidth={1.9} />
        </button>
      ) : (
        <button type="button" className="tool-button" aria-label="Reload" title="Reload (Ctrl+R)" onClick={() => void bridge?.refresh(tabId)}>
          <RotateCw size={17} strokeWidth={1.9} />
        </button>
      )}
      <button type="button" className="tool-button" aria-label="Home" title="Home (Alt+Home)" onClick={() => void bridge?.navigate(NEW_TAB_URL, tabId)}>
        <Home size={17} strokeWidth={1.9} />
      </button>

      <AddressBar
        activeTab={activeTab}
        tabs={props.tabs}
        activeTabId={props.activeTabId}
        bookmarks={props.bookmarks}
        settings={props.settings}
        inputRef={props.addressInputRef}
        onEditingChange={props.onEditingChange}
        onToggleBookmark={props.onToggleBookmark}
      />

      <div className={studySession ? 'study-control active' : 'study-control'}>
        <button
          type="button"
          role="switch"
          className="study-switch"
          aria-checked={studySession !== null}
          aria-label="Study Mode"
          title={studySession ? 'Turn Study Mode off' : 'Turn Study Mode on'}
          onClick={props.onToggleStudy}
        >
          <span className="study-switch-knob" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="study-button"
          onClick={() => props.onTogglePanel('study')}
          aria-pressed={props.activePanel === 'study'}
          aria-label="Open Study Mode panel"
          title="Study Mode details"
        >
          {studyLabel}
        </button>
        {studySession && props.aiOffline ? (
          <span className="study-warning" role="img" aria-label="AI checks offline" title="AI checks are offline, so basic keyword rules decide unlisted pages. Open the Study panel for details." />
        ) : null}
      </div>

      {props.downloadsVisible ? (
        <button
          type="button"
          className="tool-button"
          onClick={() => props.onTogglePanel('downloads')}
          aria-pressed={props.activePanel === 'downloads'}
          aria-label={`Downloads${props.activeDownloads > 0 ? `, ${props.activeDownloads} in progress` : ''}`}
          title="Downloads (Ctrl+J)"
        >
          <Download size={18} strokeWidth={1.9} />
          {props.activeDownloads > 0 ? <span className="badge">{props.activeDownloads}</span> : null}
        </button>
      ) : null}

      <button ref={menuButtonRef} type="button" className="tool-button" aria-label="Menu" title="Menu" onClick={openMenu}>
        <MoreHorizontal size={18} strokeWidth={1.9} />
      </button>
    </div>
  );
}
