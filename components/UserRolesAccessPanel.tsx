import {
  hasMinRole,
  roleDescription,
  roleLabel,
  type UserRole,
} from "@/lib/auth/roles";
import { SIDEBAR_SECTIONS } from "@/lib/nav/structure";

const ROLE_COLUMNS: UserRole[] = ["user", "admin", "super_admin"];

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_6.75rem_6.75rem_7.5rem] items-center";

function accessMark(role: UserRole, minRole: UserRole): boolean {
  return hasMinRole(role, minRole);
}

function sectionChildLabels(
  children: NonNullable<(typeof SIDEBAR_SECTIONS)[number]["children"]>,
): string {
  return children
    .flatMap((child) => (child.children?.length ? child.children : [child]))
    .map((child) => child.label)
    .join(" · ");
}

export function UserRolesAccessPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <p className="shrink-0 text-sm text-slate-600">
        Roles are cumulative: each higher role includes everything below it.
        This table matches the sidebar and the route guards in the app.
      </p>

      <ul className="grid shrink-0 gap-3 sm:grid-cols-3">
        {ROLE_COLUMNS.map((role) => (
          <li
            key={role}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-900">
              {roleLabel(role)}
            </p>
            <p className="mt-1 text-sm text-slate-600">{roleDescription(role)}</p>
          </li>
        ))}
      </ul>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
        role="table"
        aria-label="Role access by area"
      >
        <div
          className={`shrink-0 overflow-hidden border-b border-slate-200 bg-slate-50 text-sm font-medium text-slate-700 [scrollbar-gutter:stable] ${ROW_GRID}`}
          role="row"
        >
          <div className="px-4 py-3 text-left" role="columnheader">
            Area
          </div>
          {ROLE_COLUMNS.map((role) => (
            <div key={role} className="px-4 py-3 text-center" role="columnheader">
              {roleLabel(role)}
            </div>
          ))}
        </div>
        <div
          className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto text-sm [scrollbar-gutter:stable]"
          role="rowgroup"
        >
          {SIDEBAR_SECTIONS.map((section) => (
            <div key={section.id} className={ROW_GRID} role="row">
              <div className="px-4 py-3" role="cell">
                <p className="font-medium text-slate-900">{section.label}</p>
                <p className="text-xs text-slate-500">{section.category}</p>
                {section.children && section.children.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {sectionChildLabels(section.children)}
                  </p>
                ) : null}
              </div>
              {ROLE_COLUMNS.map((role) => {
                const allowed = accessMark(role, section.minRole);
                return (
                  <div
                    key={role}
                    className="px-4 py-3 text-center"
                    role="cell"
                  >
                    {allowed ? (
                      <span className="font-semibold text-teal-700">Yes</span>
                    ) : (
                      <span className="text-slate-400">No</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
