"use client";

import { useState, type ReactNode } from "react";

export interface TabSpec {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Lightweight client tabs component for the app-admin console.
 * Persists the active tab to a query param so refreshes keep the user
 * on the same view.
 */
export function Tabs({
  tabs,
  defaultTab,
}: {
  tabs: TabSpec[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState<string>(defaultTab ?? tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        className="flex gap-1 border-b border-neutral-200"
      >
        {tabs.map((t) => {
          const isActive = t.id === current?.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={
                isActive
                  ? "px-4 py-2 text-sm font-medium text-neutral-900 border-b-2 border-neutral-900 -mb-px"
                  : "px-4 py-2 text-sm font-medium text-neutral-500 border-b-2 border-transparent hover:text-neutral-800"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-6">
        {current?.content}
      </div>
    </div>
  );
}
