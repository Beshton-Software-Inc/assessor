"use client";

import { useRouter, useSearchParams } from "next/navigation";

export interface OrgPickerOption {
  id: string;
  name: string;
}

export function OrgPicker({
  orgs,
  current,
}: {
  orgs: OrgPickerOption[];
  current: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", e.target.value);
    router.replace(`/admin/org?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-sm text-neutral-600">
      <span className="font-medium">Organization</span>
      <select
        value={current}
        onChange={onChange}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 focus:border-neutral-900 focus:outline-none"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
