import { AlertTriangle, Lock, Search, ShieldAlert, ShieldCheck, ShieldOff, Star } from 'lucide-react';
import { KeyboardEvent, ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adBlockingActiveFor, BrowserSettings } from '../../../shared/browser-settings.js';
import type { Bookmark, BrowserTabState } from '../../../shared/ipc.js';
import { internalPageOf, isInternalUrl } from '../../../shared/internal-pages.js';
import { displayUrl, normalizeNavigationInput } from '../../../shared/url.js';
import { inlineCompletion, OmniboxSuggestion } from '../omnibox.js';
import { BrandMark, bridge, SuggestionList, useOmniboxSuggestions } from './common.js';

type Props = {
  activeTab: BrowserTabState | undefined;
  tabs: BrowserTabState[];
  activeTabId: string | null;
  bookmarks: Bookmark[];
  settings: BrowserSettings;
  inputRef: RefObject<HTMLInputElement | null>;
  onEditingChange: (editing: boolean) => void;
  onToggleBookmark: () => void;
  /** During Study Mode ads are always blocked, whatever the per-site setting. */
  studyActive: boolean;
};

/** "https://www.example.com/a" → host "example.com", rest "/a" (what the bar shows when idle). */
function splitForDisplay(url: string): { prefix: string; host: string; rest: string } | null {
  if (isInternalUrl(url)) {
    const shown = displayUrl(url);
    return shown ? { prefix: 'studynest://', host: shown.slice('studynest://'.length), rest: '' } : null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.host.replace(/^www\./, '');
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`;
    return { prefix: parsed.protocol === 'http:' ? 'http://' : '', host, rest };
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.hostname : null;
  } catch {
    return null;
  }
}

export function AddressBar({ activeTab, tabs, activeTabId, bookmarks, settings, inputRef, onEditingChange, onToggleBookmark, studyActive }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [focused, setFocused] = useState(false);
  /** What the user typed; the input shows typed + completion with the completion selected. */
  const [typed, setTyped] = useState('');
  const [completion, setCompletion] = useState('');
  const [allowCompletion, setAllowCompletion] = useState(true);
  const [editing, setEditing] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const pageUrl = activeTab ? (activeTab.blocked?.url ?? activeTab.url) : '';
  const idleText = activeTab ? displayUrl(pageUrl) : '';

  const { suggestions, historyUrls } = useOmniboxSuggestions({
    input: typed,
    active: editing && typed.trim().length > 0,
    tabs,
    activeTabId,
    bookmarks,
    engine: settings.searchEngine,
    remoteEnabled: settings.searchSuggestions
  });

  // Inline autocompletion once history for the typed text has arrived.
  useEffect(() => {
    setCompletion(editing && allowCompletion ? (inlineCompletion(typed, historyUrls) ?? '') : '');
  }, [typed, historyUrls.join('\n'), allowCompletion, editing]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && completion && document.activeElement === input) {
      input.setSelectionRange(typed.length, typed.length + completion.length);
    }
  }, [completion, typed, inputRef]);

  useEffect(() => setHighlighted(0), [typed]);

  // Show the page address whenever the user is not typing.
  useEffect(() => {
    if (!editing) {
      setTyped(idleText);
      setCompletion('');
    }
  }, [idleText, editing, activeTabId]);

  useEffect(() => {
    onEditingChange(editing && suggestions.length > 0);
  }, [editing, suggestions.length > 0]);

  useLayoutEffect(() => {
    if (!editing) return;
    const measure = () => {
      const rect = formRef.current?.getBoundingClientRect();
      if (rect) setPanelRect({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [editing]);

  const stopEditing = () => {
    setEditing(false);
    setCompletion('');
    setTyped(idleText);
  };

  const go = async (suggestion: OmniboxSuggestion | null, raw: string) => {
    if (!bridge) return;
    if (suggestion?.kind === 'tab' && suggestion.tabId) {
      await bridge.switchTab(suggestion.tabId);
    } else {
      const target = suggestion ? suggestion.url : normalizeNavigationInput(raw, settings.searchEngine);
      if (!target.trim()) return;
      await bridge.navigate(target, activeTabId ?? undefined);
    }
    setEditing(false);
    setCompletion('');
    inputRef.current?.blur();
  };

  const submit = () => {
    const full = typed + completion;
    if (completion) {
      void go(null, full);
      return;
    }
    const choice = suggestions[highlighted] ?? null;
    if (choice) void go(choice, full);
    else if (full.trim()) void go(null, full);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setCompletion('');
      setAllowCompletion(false);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted((current) => (current + delta + suggestions.length) % suggestions.length);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (completion || (editing && typed !== idleText)) {
        stopEditing();
        requestAnimationFrame(() => inputRef.current?.select());
      } else {
        inputRef.current?.blur();
      }
    } else if (event.key === 'Tab' && completion) {
      event.preventDefault();
      setTyped(typed + completion);
      setCompletion('');
    } else if (event.key === 'Delete' && event.shiftKey) {
      // Shift+Delete removes a highlighted history entry, as in other browsers.
      const choice = suggestions[highlighted];
      if (choice?.kind === 'history') {
        event.preventDefault();
        void bridge?.queryHistory({ text: choice.url, limit: 50 }).then((entries) =>
          bridge?.deleteHistory(entries.filter((entry) => entry.url === choice.url).map((entry) => entry.id))
        );
      }
    }
  };

  // Site indicator ---------------------------------------------------------
  const internalPage = activeTab ? internalPageOf(activeTab.url) : null;
  const host = hostOf(pageUrl);
  let indicator: ReactNode;
  let indicatorClass = 'site-indicator';
  let indicatorTitle = '';
  if (focused || internalPage === 'newtab' || !activeTab) {
    indicator = <Search size={15} strokeWidth={2} />;
    indicatorTitle = 'Search or enter address';
  } else if (activeTab.blocked) {
    indicator = <ShieldAlert size={15} strokeWidth={2} />;
    indicatorClass += ' blocked';
    indicatorTitle = 'Blocked by Study Mode';
  } else if (internalPage) {
    indicator = <BrandMark className="favicon" />;
    indicatorClass += ' internal';
    indicatorTitle = 'StudyNest page';
  } else if (pageUrl.startsWith('http://')) {
    indicator = (
      <>
        <AlertTriangle size={14} strokeWidth={2} />
        <span>Not secure</span>
      </>
    );
    indicatorClass += ' insecure';
    indicatorTitle = 'Your connection to this site is not encrypted';
  } else {
    indicator = <Lock size={14} strokeWidth={2} />;
    indicatorTitle = 'Connection is secure';
  }

  const isWeb = host !== null && !internalPage;
  const bookmarked = bookmarks.some((bookmark) => bookmark.url === pageUrl);
  const adBlockActive = studyActive || adBlockingActiveFor(settings, host);
  const display = !editing && !focused ? splitForDisplay(pageUrl) : null;

  const toggleAdBlockForSite = async () => {
    if (!bridge || !host) return;
    const bare = host.replace(/^www\./, '');
    const exceptions = adBlockActive ? [...settings.adBlockExceptions, bare] : settings.adBlockExceptions.filter((entry) => !(bare === entry || bare.endsWith(`.${entry}`)));
    await bridge.updateSettings({ adBlockExceptions: exceptions });
    await bridge.refresh(activeTabId ?? undefined);
  };

  return (
    <form
      ref={formRef}
      className={focused ? 'address-form focused' : 'address-form'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <button
        type="button"
        className={indicatorClass}
        title={indicatorTitle}
        aria-label={indicatorTitle}
        tabIndex={-1}
        onClick={() => (host && !activeTab?.blocked && !focused ? void bridge?.newTab('studynest://settings#permissions') : inputRef.current?.focus())}
      >
        {indicator}
      </button>
      <div className="address-field">
        <input
          ref={inputRef}
          className={display ? 'has-display' : undefined}
          aria-label="Address and search bar"
          aria-autocomplete="both"
          value={typed + completion}
          placeholder="Search or enter address"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            const nativeEvent = event.nativeEvent as InputEvent;
            const value = event.target.value;
            setAllowCompletion(!nativeEvent.inputType?.startsWith('delete'));
            setTyped(value);
            setCompletion('');
            setEditing(true);
          }}
          onFocus={(event) => {
            setFocused(true);
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onBlur={() => {
            setFocused(false);
            stopEditing();
          }}
          onKeyDown={onKeyDown}
        />
        {display ? (
          <div className="address-display" aria-hidden="true">
            {display.prefix ? <span>{display.prefix}</span> : null}
            <span className="host">{display.host}</span>
            <span>{display.rest}</span>
          </div>
        ) : null}
      </div>

      {!focused && activeTab && activeTab.zoomPercent !== 100 && isWeb ? (
        <button type="button" className="address-chip" title="Reset zoom (Ctrl+0)" onClick={() => void bridge?.zoom(0)}>
          {activeTab.zoomPercent}%
        </button>
      ) : null}

      {!focused && isWeb && (settings.adBlocking || studyActive) && !activeTab?.blocked ? (
        <button
          type="button"
          className={adBlockActive ? 'address-chip shield' : 'address-chip shield off'}
          title={
            studyActive
              ? `${activeTab?.blockedAds ?? 0} ads and trackers blocked on this page. Ads are always blocked during Study Mode.`
              : adBlockActive
              ? `${activeTab?.blockedAds ?? 0} ads and trackers blocked on this page. Click to allow ads on ${host?.replace(/^www\./, '')}.`
              : `Ad blocking is off on ${host?.replace(/^www\./, '')}. Click to turn it back on.`
          }
          aria-label={adBlockActive ? 'Ad blocking on for this site' : 'Ad blocking off for this site'}
          onClick={() => !studyActive && void toggleAdBlockForSite()}
        >
          {adBlockActive ? <ShieldCheck size={15} strokeWidth={2} /> : <ShieldOff size={15} strokeWidth={2} />}
          {adBlockActive && (activeTab?.blockedAds ?? 0) > 0 ? <span>{activeTab!.blockedAds}</span> : null}
        </button>
      ) : null}

      {!focused && isWeb ? (
        <button
          type="button"
          className={bookmarked ? 'address-icon-button on' : 'address-icon-button'}
          aria-pressed={bookmarked}
          aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          title={bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
          onClick={onToggleBookmark}
        >
          <Star size={16} strokeWidth={1.9} fill={bookmarked ? 'currentColor' : 'none'} />
        </button>
      ) : null}

      {editing ? (
        <SuggestionList
          className="omnibox-panel"
          style={panelRect ? { top: panelRect.top, left: panelRect.left, width: panelRect.width } : undefined}
          suggestions={suggestions}
          query={typed}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onChoose={(choice) => void go(choice, typed)}
        />
      ) : null}
    </form>
  );
}
