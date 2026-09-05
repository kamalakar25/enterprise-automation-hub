/**
 * Per-module configuration: defines what inputs the ModuleRunner form shows,
 * which parameters get sent to the API, and which fields are required.
 *
 * Keep this in sync with the backend worker processor validation.
 */

export const MODULE_CONFIG = {
  // ── SAP Daily Tracker (VBS + Python pipeline on Windows worker) ──────
  'sap-daily-tracker': {
    requiresFile: true,
    fileLabel: 'SAP_Daily_Input.xlsx',
    fileAccept: '.xlsx,.xls',
    fileHelp: 'Upload the master SAP Daily Input workbook. The pipeline will take a fresh SAP snapshot, reconcile, validate, run the VBS updater, apply statuses back, and return the updated XLSX.',
    params: [
      {
        name: 'pernr',
        label: 'Employee ID (PERNR)',
        type: 'text',
        placeholder: 'e.g. 104523',
        required: true,
        pattern: '^[0-9]{6}$',
        patternError: 'PERNR must be exactly 6 digits',
        help: 'Your 6-digit SAP employee ID for audit trail',
      },
      {
        name: 'cummode',
        label: 'Communication Mode',
        type: 'select',
        required: true,
        options: [
          { value: '', label: 'Select mode...' },
          { value: 'EMAIL', label: 'EMAIL' },
          { value: 'PHONE', label: 'PHONE' },
          { value: 'VISIT', label: 'VISIT' },
          { value: 'SANYOG', label: 'SANYOG' },
        ],
        help: 'Dispatch/contact channel recorded in SAP for these transactions',
      },
      {
        name: 'runMode',
        label: 'Run Mode',
        type: 'select',
        required: true,
        defaultValue: 'LIVE',
        options: [
          { value: 'DRY_RUN', label: '🔍 Safe Dry-Run (no SAP write)' },
          { value: 'LIVE', label: '🟢 Live Production Run' },
          { value: 'RETRY_FAILED', label: '🔁 Retriage Failed Rows Only' },
        ],
        help: 'Dry-Run validates and matches rows without clicking Save in SAP. Use it first.',
      },
    ],
  },

  // ── ZPRS Pending Tracker ─────────────────────────────────────────────
  'zprs-pending-tracker': {
    requiresFile: true,
    fileLabel: 'ZPRS Input File',
    fileAccept: '.xlsx,.xls,.csv',
    fileHelp: 'Upload ZPRS pending tracker file. Requires Windows SAP GUI worker.',
    params: [
      {
        name: 'pernr',
        label: 'Employee ID (PERNR)',
        type: 'text',
        placeholder: 'e.g. 104523',
        required: true,
        pattern: '^[0-9]{6}$',
        patternError: 'PERNR must be exactly 6 digits',
      },
      {
        name: 'cummode',
        label: 'Communication Mode',
        type: 'select',
        required: true,
        options: [
          { value: '', label: 'Select mode...' },
          { value: 'EMAIL', label: 'EMAIL' },
          { value: 'PHONE', label: 'PHONE' },
          { value: 'VISIT', label: 'VISIT' },
          { value: 'SANYOG', label: 'SANYOG' },
        ],
      },
      {
        name: 'plant',
        label: 'Plant',
        type: 'text',
        placeholder: 'e.g. 1000',
      },
    ],
  },

  // ── ME2M Procurement Analyzer ────────────────────────────────────────
  'me2m-analyzer': {
    requiresFile: true,
    fileLabel: 'ME2M Raw Export (CSV/XLSX)',
    fileAccept: '.csv,.xlsx,.xls',
    fileHelp: 'Upload the raw ME2M export from SAP. The Python engine will run the 90-day horizon analysis and return an action report.',
    params: [
      {
        name: 'horizonDays',
        label: 'Analysis Horizon (days)',
        type: 'number',
        placeholder: '90',
        defaultValue: '90',
        help: 'Number of days to look ahead for procurement schedule analysis',
      },
    ],
  },

  // ── Bulk Vendor Email Dispatcher ─────────────────────────────────────
  'vendor-email': {
    requiresFile: true,
    fileLabel: 'Recipient List (Excel/CSV)',
    fileAccept: '.xlsx,.xls,.csv',
    fileHelp: 'Upload recipient list with columns: Vendor, Email, PO, etc.',
    params: [
      {
        name: 'subject',
        label: 'Email Subject',
        type: 'text',
        required: true,
        placeholder: 'Follow-up on your open POs',
        defaultValue: 'Follow-up on your open POs',
      },
      {
        name: 'body',
        label: 'Email Body Template',
        type: 'textarea',
        required: true,
        placeholder: 'Dear {vendor},\n\nPlease update us on PO {po}.\n\nRegards,\nProcurement Team',
        defaultValue: 'Dear {vendor},\n\nPlease update us on the status of PO {po}.\n\nRegards,\nProcurement Team',
        help: 'Use placeholders: {vendor}, {email}, {po}, {material}, {qty}',
      },
    ],
  },
};

export function getModuleConfig(slug) {
  return MODULE_CONFIG[slug] || {
    requiresFile: true,
    fileAccept: '.xlsx,.xls,.csv',
    params: [],
  };
}
