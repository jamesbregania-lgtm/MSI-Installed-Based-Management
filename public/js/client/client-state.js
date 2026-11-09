// Activity type constants
// Only PREVENTIVE_MAINTENANCE and PARTS_REPLACEMENT are schedule-based: they
// open the maintenance/parts checker and move service dates. Only the
// maintenance date runs on a clock and raises warnings — parts have no due date.
// REPAIR uses the same report flow as PM but is NOT schedule-based, so it
// never touches part/maintenance due dates and shows no parts checker.
// INSPECTION is functionally identical to REPAIR — same flow, same fields —
// it exists only as a separate label for a different kind of visit.
// PULL_OUT takes the REPAIR flow too — no parts checker, no due-date changes,
// a Service Report at the end.
// CANNIBALIZE (and PARTS_RETURN, its reverse) are ad-hoc activity records only.
const ACTIVITY_TYPES = {
    PREVENTIVE_MAINTENANCE: 'Preventive Maintenance',
    PARTS_REPLACEMENT: 'Parts Replacement',
    REPAIR: 'Repair',
    INSPECTION: 'Inspection',
    PULL_OUT: 'Pull Out',
    CANNIBALIZE: 'Cannibalize',
    PARTS_RETURN: 'Parts Return'
};

const SCHEDULED_ACTIVITY_TYPES = new Set([
    ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE,
    ACTIVITY_TYPES.PARTS_REPLACEMENT
]);

// Activities saved without a Service Report. Everything NOT in this set has
// a report (ref no, other technicians) — including Repair,
// which is unscheduled but still report-backed. Checked explicitly rather
// than as "not scheduled", so unscheduled-but-reported types stay correct.
// Pull Out left this set when it gained a report; its older entries were saved
// without one, which isAdHocHistoryRow() accounts for.
const ADHOC_ACTIVITY_TYPES = new Set([
    ACTIVITY_TYPES.CANNIBALIZE,
    ACTIVITY_TYPES.PARTS_RETURN
]);

/**
 * Single source of truth for the machine-detail activity menu.
 *
 * Adding a new activity to the UI is a one-line addition here — the menu
 * renders itself from this list and scrolls internally, so it never runs
 * out of room the way a fixed row of buttons does.
 *
 * flow: 'edit'  → edit modal, then the Service Report step
 *                 (parts checker only appears for SCHEDULED_ACTIVITY_TYPES)
 *       'adhoc' → ad-hoc modal, saved directly with no report
 */
const MACHINE_ACTIVITY_ACTIONS = [
    {
        type: ACTIVITY_TYPES.PREVENTIVE_MAINTENANCE,
        label: 'Preventive Maintenance',
        description: 'Scheduled service — resets the maintenance due date',
        tone: 'navy',
        flow: 'edit',
        icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />'
    },
    {
        type: ACTIVITY_TYPES.PARTS_REPLACEMENT,
        label: 'Parts Replacement',
        description: 'Record which parts were replaced on this visit',
        tone: 'blue',
        flow: 'edit',
        icon: '<rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />'
    },
    {
        type: ACTIVITY_TYPES.REPAIR,
        label: 'Repair',
        description: 'Corrective fix — no parts checker, does not change due dates',
        tone: 'teal',
        flow: 'edit',
        icon: '<path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" /><path d="M17.64 15 22 10.64" /><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91" />'
    },
    {
        type: ACTIVITY_TYPES.INSPECTION,
        label: 'Inspection',
        description: 'Routine check — no parts checker, does not change due dates',
        tone: 'green',
        flow: 'edit',
        icon: '<circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><path d="M11 8v3l2 1.5" />'
    },
    {
        type: ACTIVITY_TYPES.CANNIBALIZE,
        label: 'Cannibalize',
        description: 'Take parts from this unit for use elsewhere',
        tone: 'purple',
        flow: 'adhoc',
        icon: '<circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />'
    },
    {
        type: ACTIVITY_TYPES.PULL_OUT,
        label: 'Pull Out',
        description: 'Remove the entire unit from the client site',
        tone: 'orange',
        flow: 'edit',
        icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />'
    }
];

var allMachines = [];
var filteredMachines = [];
var currentDetailIndex = null;
var currentPage = 1;
const PAGE_SIZE = 10;

// Same triangle icon for both maintenance states — only the color changes:
// orange while due soon, red once it's actually overdue.
function getMaintenanceWarningIcon(isOverdue) {
    const color = isOverdue ? '#c0392b' : '#e67e22';
    const label = isOverdue ? 'Maintenance overdue' : 'Maintenance due soon';
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
         fill="${color}" class="warning-icon" aria-label="${label}">
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
</svg>`;
}