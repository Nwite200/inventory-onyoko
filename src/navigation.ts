import type { IconName } from './components/Icon';

export interface NavDefinition {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  managerOnly?: boolean;
  superOnly?: boolean;
}

export const NAV_GROUPS = ['Operations', 'Catalogue & stock', 'Finance', 'Insights', 'People', 'System'];

export const NAV_CATALOG: NavDefinition[] = [
  { id: 'home', label: 'Dashboard', group: 'Operations', icon: 'dashboard' },
  { id: 'pos', label: 'Point of sale', group: 'Operations', icon: 'pos' },
  { id: 'sales', label: 'Sales', group: 'Operations', icon: 'receipt' },
  { id: 'quotations', label: 'Quotations & orders', group: 'Operations', icon: 'clipboard' },
  { id: 'returns', label: 'Refund book', group: 'Operations', icon: 'refund' },
  { id: 'register', label: 'Cash register', group: 'Operations', icon: 'register' },

  { id: 'products', label: 'Products', group: 'Catalogue & stock', icon: 'products' },
  { id: 'categories', label: 'Categories', group: 'Catalogue & stock', icon: 'filter', managerOnly: true },
  { id: 'inventory', label: 'Inventory', group: 'Catalogue & stock', icon: 'inventory' },
  { id: 'warehouses', label: 'Warehouses & bins', group: 'Catalogue & stock', icon: 'store' },
  { id: 'transfers', label: 'Stock transfers', group: 'Catalogue & stock', icon: 'truck', managerOnly: true },
  { id: 'purchases', label: 'Purchases', group: 'Catalogue & stock', icon: 'package', managerOnly: true },

  { id: 'accounting', label: 'Accounting', group: 'Finance', icon: 'chart', managerOnly: true },
  { id: 'banking', label: 'Banking', group: 'Finance', icon: 'wallet', managerOnly: true },
  { id: 'expenses', label: 'Expenses', group: 'Finance', icon: 'wallet', managerOnly: true },
  { id: 'contacts', label: 'Customers & suppliers', group: 'Finance', icon: 'users' },
  { id: 'advanced', label: 'Operations suite', group: 'Finance', icon: 'sparkle', managerOnly: true },

  { id: 'reports', label: 'Reports', group: 'Insights', icon: 'clipboard' },

  { id: 'employees', label: 'Employees', group: 'People', icon: 'users', managerOnly: true },
  { id: 'branches', label: 'Branches', group: 'People', icon: 'store' },

  { id: 'branding', label: 'Branding & receipts', group: 'System', icon: 'palette', managerOnly: true },
  { id: 'settings', label: 'Settings', group: 'System', icon: 'settings' },
  { id: 'platform', label: 'Platform admin', group: 'System', icon: 'lock', superOnly: true },
];
