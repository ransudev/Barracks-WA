import type { CSSProperties } from "react";

// Placeholders shaped like the screen that is loading, so the layout appears at
// once and real content drops into the same places instead of popping in.

export function Skeleton({
  width,
  height = 12,
  radius,
  className = "",
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

function Header({ actions = 2 }: { actions?: number }) {
  return (
    <div className="skeleton-header">
      <Skeleton width={220} height={34} radius={8} />
      <div className="skeleton-row">
        {Array.from({ length: actions }, (_, index) => (
          <Skeleton key={index} width={index ? 150 : 110} height={40} radius={8} />
        ))}
      </div>
    </div>
  );
}

function Metrics({ count = 4 }: { count?: number }) {
  return (
    <div
      className="skeleton-metrics"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-panel skeleton-metric" key={index}>
          <Skeleton width="55%" height={11} />
          <Skeleton width="38%" height={28} radius={6} />
        </div>
      ))}
    </div>
  );
}

function Toolbar() {
  return (
    <div className="skeleton-row skeleton-toolbar">
      <Skeleton width={260} height={38} radius={8} />
      <Skeleton width={140} height={38} radius={8} />
      <Skeleton width={140} height={38} radius={8} />
    </div>
  );
}

function Rows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-list-row" key={index}>
          <Skeleton width={36} height={36} radius={18} />
          <div className="skeleton-stack">
            <Skeleton width={`${46 - (index % 3) * 8}%`} height={13} />
            <Skeleton width={`${30 + (index % 2) * 10}%`} height={10} />
          </div>
          <Skeleton width={72} height={22} radius={11} />
        </div>
      ))}
    </div>
  );
}

function Cards({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-panel skeleton-card" key={index}>
          <div className="skeleton-row skeleton-row--between">
            <Skeleton width="40%" height={15} />
            <Skeleton width={70} height={20} radius={10} />
          </div>
          <div className="skeleton-row">
            <Skeleton width={28} height={28} radius={14} />
            <Skeleton width="50%" height={13} />
          </div>
          <Skeleton width="70%" height={11} />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton({ label = "Loading dashboard" }: { label?: string }) {
  return (
    <div className="skeleton-page" role="status" aria-label={label}>
      <Header />
      <Metrics />
      <div className="skeleton-split">
        <div className="skeleton-panel">
          <Skeleton width={160} height={16} />
          <Rows count={4} />
        </div>
        <div className="skeleton-panel">
          <Skeleton width={140} height={16} />
          <Rows count={4} />
        </div>
      </div>
    </div>
  );
}

export function ListPageSkeleton({
  label = "Loading",
  metrics = false,
  cards = true,
}: {
  label?: string;
  metrics?: boolean;
  cards?: boolean;
}) {
  return (
    <div className="skeleton-page" role="status" aria-label={label}>
      <Header />
      {metrics && <Metrics />}
      <div className="skeleton-panel">
        <Toolbar />
        {cards ? <Cards /> : <Rows count={8} />}
      </div>
    </div>
  );
}

// gridOnly renders just the day grid, for use inside the real bookings panel.
export function ScheduleSkeleton({
  label = "Loading bookings",
  gridOnly = false,
  columns = 4,
}: {
  label?: string;
  gridOnly?: boolean;
  columns?: number;
}) {
  const grid = <ScheduleGrid columns={columns} />;
  if (gridOnly)
    return (
      <div className="skeleton-schedule-wrap" role="status" aria-label={label}>
        {grid}
      </div>
    );
  return (
    <div className="skeleton-page" role="status" aria-label={label}>
      <Header actions={3} />
      <div className="skeleton-panel">
        <div className="skeleton-row skeleton-row--between">
          <div className="skeleton-row">
            <Skeleton width={36} height={36} radius={8} />
            <Skeleton width={150} height={36} radius={8} />
            <Skeleton width={36} height={36} radius={8} />
            <Skeleton width={180} height={18} />
          </div>
          <Skeleton width={150} height={34} radius={8} />
        </div>
        <Toolbar />
        {grid}
      </div>
    </div>
  );
}

function ScheduleGrid({ columns }: { columns: number }) {
  return (
    <div
      className="skeleton-schedule"
      style={{ gridTemplateColumns: `72px repeat(${columns}, minmax(120px, 1fr))` }}
    >
      <span />
      {Array.from({ length: columns }, (_, index) => (
        <div key={index} className="skeleton-stack">
          <Skeleton width="60%" height={13} />
          <Skeleton width="45%" height={10} />
        </div>
      ))}
      {Array.from({ length: 5 }, (_, row) => (
        <div
          key={row}
          className="skeleton-schedule__row"
          style={{ gridColumn: `1 / span ${columns + 1}` }}
        >
          <Skeleton width={46} height={10} />
          {Array.from({ length: columns }, (_, column) => (
            <div key={column}>
              {(row + column) % 3 === 0 && <Skeleton height={48} radius={6} width="92%" />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AppShellSkeleton() {
  return (
    <div className="skeleton-shell" role="status" aria-label="Restoring your workspace">
      <aside className="skeleton-shell__sidebar">
        <Skeleton width={120} height={34} radius={6} />
        <div className="skeleton-stack skeleton-shell__nav">
          {Array.from({ length: 9 }, (_, index) => (
            <div className="skeleton-row" key={index}>
              <Skeleton width={18} height={18} radius={5} />
              <Skeleton width={`${50 + (index % 4) * 10}%`} height={12} />
            </div>
          ))}
        </div>
      </aside>
      <div className="skeleton-shell__main">
        <div className="skeleton-shell__topbar">
          <Skeleton width={160} height={14} />
          <div className="skeleton-row">
            <Skeleton width={110} height={34} radius={8} />
            <Skeleton width={150} height={34} radius={17} />
          </div>
        </div>
        <DashboardSkeleton label="Loading workspace" />
      </div>
    </div>
  );
}

export function CustomerPageSkeleton() {
  return (
    <div className="skeleton-customer" role="status" aria-label="Loading your account">
      <div className="skeleton-shell__topbar">
        <Skeleton width={120} height={30} radius={6} />
        <div className="skeleton-row">
          <Skeleton width={90} height={14} />
          <Skeleton width={90} height={14} />
          <Skeleton width={34} height={34} radius={17} />
        </div>
      </div>
      <div className="skeleton-page skeleton-page--narrow">
        <Header actions={1} />
        <Metrics count={3} />
        <div className="skeleton-split">
          <div className="skeleton-panel">
            <Rows count={3} />
          </div>
          <div className="skeleton-panel">
            <Rows count={3} />
          </div>
        </div>
      </div>
    </div>
  );
}

// In-place placeholders for a panel whose data is still loading.
export function SkeletonRows({ count = 5, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div className="skeleton-inline" role="status" aria-label={label}>
      <Rows count={count} />
    </div>
  );
}

export function SkeletonCards({
  count = 6,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="skeleton-inline" role="status" aria-label={label}>
      <Cards count={count} />
    </div>
  );
}

export function SkeletonForm({
  fields = 4,
  label = "Loading",
}: {
  fields?: number;
  label?: string;
}) {
  return (
    <div className="skeleton-inline skeleton-form" role="status" aria-label={label}>
      {Array.from({ length: fields }, (_, index) => (
        <div className="skeleton-stack" key={index}>
          <Skeleton width={90} height={10} />
          <Skeleton width="100%" height={40} radius={7} />
        </div>
      ))}
      <div className="skeleton-row skeleton-row--end">
        <Skeleton width={90} height={40} radius={8} />
        <Skeleton width={150} height={40} radius={8} />
      </div>
    </div>
  );
}

export function CustomerDashboardSkeleton() {
  return (
    <div className="skeleton-page" role="status" aria-label="Loading your account">
      <Metrics count={3} />
      <div className="skeleton-split">
        <div className="skeleton-panel">
          <Rows count={3} />
        </div>
        <div className="skeleton-panel">
          <Rows count={3} />
        </div>
      </div>
    </div>
  );
}
