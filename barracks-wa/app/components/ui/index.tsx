import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import type { Tone } from "@/app/types/domain";
import { useBodyScrollLock } from "@/app/hooks/useBodyScrollLock";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "link";

export function Logo({ onClick, compact = false }: { onClick?: () => void; compact?: boolean }) {
  const content = (
    <span className={`logo-lockup ${compact ? "logo-lockup--compact" : ""}`}>
      <Image
        className="logo-image"
        src="/barracks/logo-transparent.png"
        alt={onClick ? "" : "Barracks Barbers & Shaves"}
        width={994}
        height={444}
        priority
        sizes={compact ? "92px" : "120px"}
      />
    </span>
  );

  if (onClick) {
    return (
      <button
        className="logo-button"
        type="button"
        onClick={onClick}
        aria-label="Back to Barracks home"
      >
        {content}
      </button>
    );
  }

  return content;
}

export function Avatar({
  initials,
  tone = "slate",
  size = "md",
  className = "",
}: {
  initials: string;
  tone?: Tone;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return <span className={`avatar avatar--${tone} avatar--${size} ${className}`}>{initials}</span>;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
}) {
  return (
    <button className={`button button--${variant} button--${size} ${className}`} {...props}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      <span>{children}</span>
      {iconAfter && <Icon name={iconAfter} size={size === "sm" ? 15 : 17} />}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      type="button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "purple";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function MetricCard({
  label,
  value,
  change,
  changeTone = "positive",
  icon,
  accent = "blue",
  className,
}: {
  label: string;
  value: string;
  change?: string;
  changeTone?: "positive" | "warning" | "negative";
  icon?: IconName;
  accent?: Tone;
  className?: string;
}) {
  return (
    <section className={`metric-card metric-card--${accent}${className ? ` ${className}` : ""}`}>
      <div className="metric-card__top">
        <span className="metric-card__label">{label}</span>
        {icon && (
          <span className="metric-card__icon">
            <Icon name={icon} size={17} />
          </span>
        )}
      </div>
      <strong className="metric-card__value">{value}</strong>
      {change && (
        <div className="metric-card__meta">
          <span className={`metric-change metric-change--${changeTone}`}>
            {changeTone === "positive" ? (
              <Icon name="arrowUp" size={12} />
            ) : changeTone === "negative" ? (
              <Icon name="arrowDown" size={12} />
            ) : (
              <Icon name="info" size={12} />
            )}
            {change}
          </span>
        </div>
      )}
    </section>
  );
}

export function PageHeader({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {action || children ? (
        <div className="page-header__actions">
          {action}
          {children}
        </div>
      ) : null}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  children,
  className = "",
  flush = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`panel ${flush ? "panel--flush" : ""} ${className}`}>
      {children}
    </section>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`search-input ${className}`}>
      <Icon name="search" size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </label>
  );
}

export function SelectField({
  label,
  id,
  required = false,
  value,
  onChange,
  children,
  className = "",
  ...props
}: {
  label?: string;
  id?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children">) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <label className={`field ${className}`}>
      {label && (
        <span className="field__label">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </span>
      )}
      <span className="select-wrap">
        <select
          id={fieldId}
          value={value}
          onChange={onChange}
          required={required}
          aria-label={label ? undefined : props["aria-label"]}
          {...props}
        >
          {children}
        </select>
        <Icon name="chevronDown" size={15} />
      </span>
    </label>
  );
}

export function TextField({
  label,
  id,
  required = false,
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  className = "",
  min,
  max,
  step,
  error,
  ...props
}: {
  label?: string;
  id?: string;
  required?: boolean;
  error?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  icon?: IconName;
  className?: string;
  min?: string;
  max?: string;
  step?: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "value" | "onChange" | "type" | "min" | "max" | "step"
>) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <label className={`field ${className}`}>
      {label && (
        <span className="field__label">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </span>
      )}
      <span className="input-wrap">
        {icon && <Icon name={icon} size={16} />}
        <input
          id={fieldId}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          {...props}
        />
      </span>
      {error && (
        <span className="field__error" id={`${fieldId}-error`} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function EmptyState({
  icon = "search",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  width = "md",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  if (!open) return null;

  return (
    <OpenModal title={title} description={description} onClose={onClose} width={width}>
      {children}
    </OpenModal>
  );
}

function OpenModal({
  title,
  description,
  onClose,
  children,
  width,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  width: "sm" | "md" | "lg";
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useBodyScrollLock(true);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const focusFirstControl = () => {
      const firstControl = modal.querySelector<HTMLElement>(focusableSelector);
      firstControl?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector));
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

    const frame = window.requestAnimationFrame(focusFirstControl);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className={`modal modal--${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <IconButton label="Close dialog" icon="x" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          className={active === item.id ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {typeof item.count === "number" && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;

  return (
    <div className="toast" role="status">
      <span className="toast__icon">
        <Icon name="check" size={15} />
      </span>
      <span>{message}</span>
      <IconButton label="Dismiss notification" icon="x" onClick={onClose} />
    </div>
  );
}

export { ConfirmDialog } from "./ConfirmDialog";

export function Pagination({
  page,
  pageCount,
  onPageChange,
  summary,
  className = "",
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary?: ReactNode;
  className?: string;
}) {
  if (pageCount <= 1 && !summary) return null;
  return (
    <nav className={`pagination ${className}`} aria-label="Pagination">
      {summary ? <span className="pagination__summary">{summary}</span> : null}
      {pageCount > 1 && (
        <span className="pagination__controls">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon="chevronLeft"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="pagination__page">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            iconAfter="chevronRight"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </span>
      )}
    </nav>
  );
}
