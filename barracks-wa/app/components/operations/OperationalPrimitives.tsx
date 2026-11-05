"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, SearchInput } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import { useBodyScrollLock } from "@/app/hooks/useBodyScrollLock";
import { useDrawerPresence } from "@/app/hooks/useDrawerPresence";

export type OperationalViewMode = "cards" | "table";

export function ViewToggle({
  view,
  onChange,
  label = "Choose view",
}: {
  view: OperationalViewMode;
  onChange: (view: OperationalViewMode) => void;
  label?: string;
}) {
  return (
    <div className="inventory-view-toggle operational-view-toggle" role="group" aria-label={label}>
      <button
        type="button"
        className={view === "cards" ? "is-active" : ""}
        aria-pressed={view === "cards"}
        onClick={() => onChange("cards")}
      >
        <Icon name="box" size={15} />
        <span>Cards</span>
      </button>
      <button
        type="button"
        className={view === "table" ? "is-active" : ""}
        aria-pressed={view === "table"}
        onClick={() => onChange("table")}
      >
        <Icon name="menu" size={15} />
        <span>List</span>
      </button>
    </div>
  );
}

export function FilterToolbar({
  search,
  onSearchChange,
  placeholder,
  filters,
  resultCount,
  onReset,
  children,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  resultCount?: number;
  onReset?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="operational-toolbar">
      <div className="operational-toolbar__inputs">
        {typeof search === "string" && onSearchChange && (
          <SearchInput
            className="operational-toolbar__search"
            value={search}
            onChange={onSearchChange}
            placeholder={placeholder}
          />
        )}
        {filters}
        {children}
        {onReset && (
          <Button type="button" variant="ghost" onClick={onReset}>
            Reset filters
          </Button>
        )}
      </div>
      <div className="operational-toolbar__meta">
        {typeof resultCount === "number" && (
          <span>
            {resultCount} {resultCount === 1 ? "record" : "records"}
          </span>
        )}
      </div>
    </div>
  );
}

export function FreshnessBar({
  updatedAt,
  loading,
  error,
  onRefresh,
}: {
  updatedAt: number | null;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
}) {
  return (
    <div className="operational-freshness">
      <span role="status">
        {loading ? (
          "Updating…"
        ) : updatedAt ? (
          <>
            Updated{" "}
            <time dateTime={new Date(updatedAt).toISOString()}>
              {new Date(updatedAt).toLocaleTimeString("en-PH", {
                timeZone: "Asia/Manila",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </>
        ) : (
          "Not updated yet"
        )}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon="refresh"
        disabled={loading}
        onClick={onRefresh}
      >
        Refresh
      </Button>
      {error && (
        <p role="alert">
          Refresh failed: {error}
          {updatedAt ? ". Displayed data is from the last successful update." : ""}
        </p>
      )}
    </div>
  );
}

export function RecordCard({
  children,
  onOpen,
  className = "",
  ariaLabel,
  actions,
}: {
  children: ReactNode;
  onOpen?: () => void;
  className?: string;
  ariaLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <article className={`operational-card ${className}`}>
      {onOpen ? (
        <button
          className="operational-card__main"
          type="button"
          onClick={onOpen}
          aria-label={ariaLabel}
        >
          {children}
        </button>
      ) : (
        children
      )}
      {actions && <div className="operational-card__actions">{actions}</div>}
    </article>
  );
}

export function ResponsiveTable({
  headers,
  children,
  className = "",
  empty,
}: {
  headers: string[];
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
}) {
  return (
    <div className={`operational-table-wrap ${className}`}>
      <table className="operational-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function DrawerSection({
  eyebrow,
  title,
  action,
  children,
  className = "",
}: {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`operational-drawer__section ${className}`}>
      <div className="operational-drawer__section-heading">
        <div>
          {eyebrow && <span className="inventory-kicker">{eyebrow}</span>}
          {title && <h3>{title}</h3>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DetailDrawer({
  open,
  title,
  subtitle,
  eyebrow = "Record detail",
  onClose,
  children,
  footer,
  dirty = false,
  onDiscard,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dirty?: boolean;
  onDiscard?: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(dirty);
  const openRef = useRef(open);
  const titleId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { mounted, phase } = useDrawerPresence(open);

  useBodyScrollLock(mounted);

  // Every consumer clears its selected record the moment the drawer closes, so
  // hold the last populated content to give the exit transition something to
  // animate out instead of emptying first.
  const lastContent = useRef({ title, subtitle, eyebrow, children, footer });
  useEffect(() => {
    if (open) lastContent.current = { title, subtitle, eyebrow, children, footer };
  });
  // Reading the cache during render is deliberate: it is the only way a drawer
  // that every consumer empties on close can still animate out with its content.
  // eslint-disable-next-line react-hooks/refs
  const cached = lastContent.current;
  const content =
    !open || phase === "exiting" ? cached : { title, subtitle, eyebrow, children, footer };
  const closeLabel = content.title.toLowerCase().endsWith("details")
    ? `Close ${content.title}`
    : `Close ${content.title} details`;

  useEffect(() => {
    onCloseRef.current = onClose;
    dirtyRef.current = dirty;
    openRef.current = open;
  }, [onClose, dirty, open]);

  useEffect(() => {
    if (!mounted) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // A confirmation or edit modal above this drawer owns keyboard input.
      if (document.querySelector(".modal-backdrop")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!openRef.current) return;
        if (dirtyRef.current) setConfirmDiscard(true);
        else onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = window.requestAnimationFrame(() =>
      closeRef.current?.focus({ preventScroll: true }),
    );
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
      setConfirmDiscard(false);
    };
    // dirty changes rerender the drawer many times per keystroke; reading it
    // through a ref instead of the dependency array keeps this effect mounted
    // for the whole drawer session so focus capture and the body scroll lock
    // are not torn down and reapplied while the user edits.
  }, [mounted]);

  if (!mounted) return null;

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function discardChanges() {
    setConfirmDiscard(false);
    onDiscard?.();
    onClose();
  }

  return (
    <div className="operational-drawer-layer" role="presentation" data-state={phase}>
      <button
        className="operational-drawer-scrim"
        type="button"
        aria-label={closeLabel}
        onClick={requestClose}
      />
      <aside
        ref={drawerRef}
        className="operational-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="operational-drawer__header">
          <div>
            <span className="inventory-kicker">{content.eyebrow}</span>
            <h2 id={titleId}>{content.title}</h2>
            {content.subtitle && <p>{content.subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label={closeLabel}
            title="Close details"
            onClick={requestClose}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="operational-drawer__body">{content.children}</div>
        {confirmDiscard && (
          <div className="operational-drawer__unsaved" role="alert">
            <div>
              <strong>Discard unsaved changes?</strong>
              <span>Your edits will be lost.</span>
            </div>
            <div>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => setConfirmDiscard(false)}
              >
                Keep editing
              </Button>
              <Button size="sm" variant="danger" type="button" onClick={discardChanges}>
                Discard
              </Button>
            </div>
          </div>
        )}
        {content.footer && <footer className="operational-drawer__footer">{content.footer}</footer>}
      </aside>
    </div>
  );
}
