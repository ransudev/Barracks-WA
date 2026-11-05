"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/app/components/ui";
import { Icon } from "@/app/components/ui/icons";
import type { Tone } from "@/app/types/domain";
import { createInitials } from "@/app/utils/format";

// Shared account chip + popover so every signed-in area (workspace, customer,
// supplier) presents identity and sign out the same way.
export function AccountMenu({
  name,
  role,
  tone = "slate",
  open,
  onOpenChange,
  onSignOut,
  children,
}: {
  name: string;
  role: string;
  tone?: Tone;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSignOut: () => void;
  children?: ReactNode;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const wrapRef = useRef<HTMLDivElement>(null);
  const initials = createInitials(name);

  useEffect(() => {
    if (!isOpen) return;
    function close(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [isOpen, setOpen]);

  return (
    <div className="topbar__popover-wrap" ref={wrapRef}>
      <button
        className="topbar__account"
        type="button"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        <Avatar initials={initials} tone={tone} size="sm" />
        <span>
          <strong>{name}</strong>
          <small>{role}</small>
        </span>
        <Icon name="chevronDown" size={14} />
      </button>
      {isOpen && (
        <div className="popover profile-popover">
          <div className="profile-popover__identity">
            <Avatar initials={initials} tone={tone} size="md" />
            <span>
              <strong>{name}</strong>
              <small>{role}</small>
            </span>
          </div>
          {children}
          <button
            className="is-danger"
            type="button"
            onClick={() => {
              setOpen(false);
              void onSignOut();
            }}
          >
            <Icon name="logOut" size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
