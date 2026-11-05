"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { canAccessView } from "@/app/utils/view";
import { frontDeskNavigation, managementNavigation } from "@/app/constants/navigation";
import { roleLabel as sharedRoleLabel } from "@/app/constants/roles";
import { IconButton, Logo } from "@/app/components/ui";
import { AccountMenu } from "@/app/components/layout/AccountMenu";
import { ThemeToggle } from "@/app/components/ui/ThemeToggle";
import { Icon } from "@/app/components/ui/icons";
import { apiRequest, readApiBody, type ApiLowStockAlert, type ApiUser } from "@/app/lib/api";
import type { ShellArea, ViewId } from "@/app/types/domain";
import { BranchContextProvider, useBranchContext } from "@/app/utils/use-branch-context";

type AppShellProps = {
  area: ShellArea;
  active: ViewId;
  go: (view: ViewId) => void;
  onToast: (message: string) => void;
  currentUser: ApiUser;
  onSignOut: () => void;
  children: ReactNode;
};

function displayName(user: ApiUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || "Account";
}

function roleLabel(user: ApiUser): string {
  return sharedRoleLabel(user.role);
}

function dashboardForArea(area: ShellArea): ViewId {
  return area === "admin" ? "admin-dashboard" : "staff-dashboard";
}

function Sidebar({
  area,
  active,
  go,
  currentUser,
  onSignOut,
  collapsed,
  onToggle,
  mobileOpen,
  onMobileClose,
}: Omit<AppShellProps, "children"> & {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const isManagement = area === "admin";
  const navigation = (isManagement ? managementNavigation : frontDeskNavigation).filter((item) =>
    canAccessView(item.id, currentUser.role),
  );
  const homeView = dashboardForArea(area);
  const navigate = (view: ViewId) => {
    onMobileClose();
    go(view);
  };

  return (
    <aside
      id="app-sidebar"
      className={`sidebar ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-mobile-open" : ""}`}
    >
      <div className="sidebar__brand">
        <Logo onClick={() => navigate(homeView)} />
        <IconButton
          className="sidebar__toggle"
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          icon={collapsed ? "chevronRight" : "chevronLeft"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          onClick={onToggle}
        />
      </div>

      <nav
        className="sidebar__nav"
        aria-label={`${isManagement ? "Management" : "Front Desk"} navigation`}
      >
        {[
          {
            name: "Today",
            ids: ["admin-dashboard", "staff-dashboard", "bookings", "queue", "payments"],
          },
          {
            name: "People",
            ids: [
              "admin-customers",
              "customers",
              "staff-management",
              "admin-barbers",
              "barbers",
              "admin-attendance",
              "admin-payroll",
            ],
          },
          { name: "Business", ids: ["admin-services", "admin-reports", "admin-branches"] },
          { name: "Stock", ids: ["admin-inventory", "admin-suppliers", "admin-restocks"] },
        ].map((group) => (
          <div className="sidebar__group" key={group.name}>
            {navigation.some((item) => group.ids.includes(item.id)) && (
              <span className="sidebar__label">{group.name}</span>
            )}
            {navigation
              .filter((item) => group.ids.includes(item.id))
              .map((item) => (
                <button
                  className={`sidebar__link ${active === item.id ? "is-active" : ""}`}
                  type="button"
                  aria-current={active === item.id ? "page" : undefined}
                  aria-label={item.label}
                  title={item.label}
                  key={item.id}
                  onClick={() => navigate(item.id)}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <button
          className="sidebar__signout"
          type="button"
          aria-label="Sign out"
          title="Sign out"
          onClick={() => {
            onMobileClose();
            void onSignOut();
          }}
        >
          <Icon name="logOut" size={17} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  area,
  active,
  go,
  onToast,
  currentUser,
  onSignOut,
  mobileNavOpen,
  onToggleMobileNav,
}: Omit<AppShellProps, "children"> & {
  mobileNavOpen: boolean;
  onToggleMobileNav: () => void;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [lowStock, setLowStock] = useState<ApiLowStockAlert[]>([]);
  const [lowStockBranchId, setLowStockBranchId] = useState(0);
  const [acknowledging, setAcknowledging] = useState(false);
  const { branchId } = useBranchContext();
  const branchRef = useRef(branchId);
  const lowStockRequest = useRef(0);
  const isManagement = area === "admin";
  const name = displayName(currentUser);
  const role = roleLabel(currentUser);
  const homeView = dashboardForArea(area);
  const visibleLowStock = lowStockBranchId === branchId ? lowStock : [];

  const refreshLowStock = useCallback(async () => {
    const selectedBranchId = branchId;
    const requestId = ++lowStockRequest.current;
    if (!selectedBranchId) {
      setLowStock([]);
      setLowStockBranchId(0);
      return;
    }
    try {
      const response = await apiRequest(`/api/inventory/alerts?branchId=${selectedBranchId}`, {
        cache: "no-store",
      });
      const body = await readApiBody<{ success: boolean; alerts?: ApiLowStockAlert[] }>(response);
      if (!response.ok || !body?.success) return;
      if (requestId === lowStockRequest.current && branchRef.current === selectedBranchId) {
        setLowStock(body.alerts ?? []);
        setLowStockBranchId(selectedBranchId);
      }
    } catch {
      // Notifications should not block the rest of the workspace.
    }
  }, [branchId]);

  useEffect(() => {
    branchRef.current = branchId;
  }, [branchId]);

  useEffect(() => {
    // The request updates notification state after the external API resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLowStock([]);
    setLowStockBranchId(0);
    setAcknowledging(false);
    ++lowStockRequest.current;
    if (isManagement) void refreshLowStock();
    // A signed-in staff/admin account is required to render AppShell.
  }, [currentUser.id, isManagement, branchId, refreshLowStock]);

  return (
    <header className="topbar">
      <div className="topbar__mobile-start">
        <IconButton
          className="topbar__mobile-menu"
          label={mobileNavOpen ? "Close navigation" : "Open navigation"}
          icon={mobileNavOpen ? "x" : "menu"}
          active={mobileNavOpen}
          onClick={onToggleMobileNav}
        />
        <div className="topbar__mobile-logo">
          <Logo compact onClick={() => go(homeView)} />
        </div>
      </div>
      <div className="topbar__context">
        <span>{isManagement ? "Management" : "Front Desk"}</span>
        <Icon name="chevronRight" size={13} />
        <strong>
          {(isManagement ? managementNavigation : frontDeskNavigation).find(
            (item) => item.id === active,
          )?.label ?? "Dashboard"}
        </strong>
      </div>

      <div className="topbar__actions">
        <ThemeToggle />

        {isManagement && (
          <div className="topbar__popover-wrap">
            <IconButton
              label={`View notifications${visibleLowStock.length ? ` (${visibleLowStock.length})` : ""}`}
              icon="bell"
              active={notificationsOpen}
              onClick={() => {
                setNotificationsOpen(!notificationsOpen);
                setProfileOpen(false);
                if (!notificationsOpen) void refreshLowStock();
              }}
            />
            {notificationsOpen && (
              <div className="popover notification-popover">
                <div className="popover__header">
                  <strong>Notifications</strong>
                </div>
                {visibleLowStock.length ? (
                  visibleLowStock.map((item) => (
                    <div className="notification-item" key={item.id}>
                      <span>
                        <strong>
                          {item.currentQuantity === 0 ? "Out of stock" : "Low stock"}:{" "}
                          {item.itemName}
                        </strong>
                        <small>
                          {item.branch} · {item.currentQuantity} {item.unit} remaining · threshold{" "}
                          {item.threshold}
                        </small>
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="notification-item">
                    <span>No active stock alerts.</span>
                  </div>
                )}
                {visibleLowStock.length > 0 && (
                  <button
                    className="popover__footer"
                    type="button"
                    disabled={acknowledging}
                    onClick={() => {
                      const selectedBranchId = branchId;
                      const requestId = lowStockRequest.current;
                      setAcknowledging(true);
                      void Promise.all(
                        visibleLowStock.map(async (item) => {
                          const response = await apiRequest(
                            `/api/inventory/alerts/${item.itemId}/acknowledge?branchId=${selectedBranchId}`,
                            { method: "POST" },
                          );
                          if (!response.ok) throw new Error("Unable to acknowledge stock alerts");
                        }),
                      )
                        .then(() => {
                          if (
                            requestId !== lowStockRequest.current ||
                            branchRef.current !== selectedBranchId
                          )
                            return;
                          setLowStock([]);
                          setNotificationsOpen(false);
                          onToast("Low stock alerts acknowledged");
                        })
                        .catch((error: unknown) => {
                          if (
                            requestId !== lowStockRequest.current ||
                            branchRef.current !== selectedBranchId
                          )
                            return;
                          onToast(
                            error instanceof Error
                              ? error.message
                              : "Unable to acknowledge stock alerts",
                          );
                          void refreshLowStock();
                        })
                        .finally(() => {
                          if (branchRef.current === selectedBranchId) setAcknowledging(false);
                        });
                    }}
                  >
                    {acknowledging ? "Acknowledging…" : "Acknowledge stock alerts"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <AccountMenu
          name={name}
          role={role}
          tone={isManagement ? "violet" : "blue"}
          open={profileOpen}
          onOpenChange={(open) => {
            setProfileOpen(open);
            if (open) setNotificationsOpen(false);
          }}
          onSignOut={onSignOut}
        ></AccountMenu>
      </div>
    </header>
  );
}

export function AppShell({
  area,
  active,
  go,
  onToast,
  currentUser,
  onSignOut,
  children,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <BranchContextProvider>
      <div className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
        <Sidebar
          area={area}
          active={active}
          go={go}
          onToast={onToast}
          currentUser={currentUser}
          onSignOut={onSignOut}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />
        <button
          className={`mobile-nav-backdrop ${mobileNavOpen ? "is-open" : ""}`}
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
        <div className="app-main">
          <Topbar
            area={area}
            active={active}
            go={go}
            onToast={onToast}
            currentUser={currentUser}
            onSignOut={onSignOut}
            mobileNavOpen={mobileNavOpen}
            onToggleMobileNav={() => setMobileNavOpen((value) => !value)}
          />
          <main className="app-content">{children}</main>
        </div>
      </div>
    </BranchContextProvider>
  );
}
