import type { VNodeChild } from 'vue';

export type SelectOption = {
  label: string;
  value?: string | number;
  key?: string | number;
  type?: 'group';
  children?: SelectOption[];
  disabled?: boolean;
};

export type DropdownOption = {
  key: string | number;
  label?: string | (() => VNodeChild);
  icon?: () => VNodeChild;
  type?: 'group' | 'divider';
  children?: DropdownOption[];
  disabled?: boolean;
  props?: Record<string, unknown>;
};

export type DropdownGroupOption = DropdownOption;

export type TreeOption = {
  key: string | number;
  label?: string;
  isLeaf?: boolean;
  children?: TreeOption[];
  lazy?: boolean;
  deferred?: 'ignored' | 'large';
  deferredEntryCount?: number;
};

export type DataTableColumns<T> = Array<
  Record<string, unknown> & {
    key?: string;
    title?: string;
    render?: (row: T) => VNodeChild;
    sorter?: boolean;
    sortOrder?: 'ascend' | 'descend' | false;
    width?: number | string;
    align?: 'left' | 'center' | 'right';
  }
>;

export type DataTableSortState = {
  columnKey?: string | number;
  order?: 'ascend' | 'descend' | false;
};
