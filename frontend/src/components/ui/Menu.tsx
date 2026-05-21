/**
 * Menu — dropdown menu primitive built on Radix DropdownMenu.
 *
 * Radix handles: keyboard nav, focus management, portal, sub-menus.
 * You handle: zero styling guesswork — all spacing/colors from tokens.
 *
 * Usage:
 *   <Menu>
 *     <MenuTrigger asChild><button>Open</button></MenuTrigger>
 *     <MenuContent>
 *       <MenuItem onSelect={() => doSomething()}>Item</MenuItem>
 *       <MenuItem onSelect={() => doSomething()} icon={<MyIcon />}>With icon</MenuItem>
 *       <MenuSeparator />
 *       <MenuItem onSelect={() => del()} danger>Delete</MenuItem>
 *     </MenuContent>
 *   </Menu>
 */

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { RADIUS, SHADOW, Z } from '../../constants/layout';

// ── Re-exports (passthrough) ──────────────────────────────────────────────────
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuGroup = DropdownMenu.Group;

// ── MenuContent ───────────────────────────────────────────────────────────────
interface MenuContentProps {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  minWidth?: number;
}

export function MenuContent({
  children,
  align = 'start',
  side = 'bottom',
  sideOffset = 4,
  minWidth = 168,
}: MenuContentProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        style={{
          zIndex: Z.DROPDOWN,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: RADIUS.LG,
          padding: '4px 0',
          boxShadow: SHADOW.MD,
          minWidth,
          outline: 'none',
        }}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

// ── MenuItem ──────────────────────────────────────────────────────────────────
interface MenuItemProps {
  children: React.ReactNode;
  onSelect?: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Trailing slot — e.g. keyboard shortcut label */
  rightSlot?: React.ReactNode;
}

export function MenuItem({ children, onSelect, icon, danger, disabled, rightSlot }: MenuItemProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: RADIUS.LG,
        fontSize: 12,
        color: danger ? 'var(--color-error)' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'default',
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        background: hovered && !disabled ? 'var(--color-hover-row)' : 'transparent',
        transition: `background var(--transition-fast)`,
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon && (
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--color-text-muted)' }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{children}</span>
      {rightSlot && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {rightSlot}
        </span>
      )}
    </DropdownMenu.Item>
  );
}

// ── MenuSeparator ─────────────────────────────────────────────────────────────
export function MenuSeparator() {
  return (
    <DropdownMenu.Separator
      style={{
        borderTop: '1px solid var(--color-border)',
        margin: '4px 0',
      }}
    />
  );
}

// ── MenuLabel ─────────────────────────────────────────────────────────────────
interface MenuLabelProps {
  children: React.ReactNode;
}

export function MenuLabel({ children }: MenuLabelProps) {
  return (
    <DropdownMenu.Label
      style={{
        padding: '4px 12px 2px',
        fontSize: 11,
        color: 'var(--color-text-muted)',
        userSelect: 'none',
      }}
    >
      {children}
    </DropdownMenu.Label>
  );
}

// ── Sub-menu ──────────────────────────────────────────────────────────────────
export const MenuSub = DropdownMenu.Sub;

interface MenuSubTriggerProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export function MenuSubTrigger({ children, icon }: MenuSubTriggerProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <DropdownMenu.SubTrigger
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: RADIUS.LG,
        fontSize: 12,
        color: 'var(--color-text)',
        cursor: 'default',
        outline: 'none',
        background: hovered ? 'var(--color-hover-row)' : 'transparent',
        transition: `background var(--transition-fast)`,
        userSelect: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon && (
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--color-text-muted)' }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{children}</span>
      {/* Chevron right */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
        <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </DropdownMenu.SubTrigger>
  );
}

interface MenuSubContentProps {
  children: React.ReactNode;
  minWidth?: number;
}

export function MenuSubContent({ children, minWidth = 140 }: MenuSubContentProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent
        style={{
          zIndex: Z.DROPDOWN + 1,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: RADIUS.LG,
          padding: '4px 0',
          boxShadow: SHADOW.MD,
          minWidth,
          outline: 'none',
        }}
      >
        {children}
      </DropdownMenu.SubContent>
    </DropdownMenu.Portal>
  );
}
