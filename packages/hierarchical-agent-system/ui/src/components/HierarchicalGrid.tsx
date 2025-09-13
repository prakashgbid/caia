import React, { useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-enterprise';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-material.css';
import { useProjectStore } from '../stores/projectStore';
import {
  ChevronRight,
  Package,
  Layers,
  GitBranch,
  FileText,
  CheckSquare,
  ListTodo,
  Tag
} from 'lucide-react';

const levelIcons = {
  'idea': Package,
  'initiative': Layers,
  'feature': GitBranch,
  'epic': FileText,
  'story': CheckSquare,
  'task': ListTodo,
  'subtask': Tag
};

export const HierarchicalGrid: React.FC = () => {
  const gridRef = useRef<AgGridReact>(null);
  const { hierarchicalData, selectedItem, setSelectedItem } = useProjectStore();

  const columnDefs = useMemo(() => [
    {
      field: 'title',
      headerName: 'Item',
      cellRenderer: 'agGroupCellRenderer',
      width: 400,
      cellRendererParams: {
        innerRenderer: (params: any) => {
          const Icon = levelIcons[params.data?.level] || ChevronRight;
          return (
            <div className="flex items-center gap-2">
              <Icon size={16} />
              <span className={`level-${params.data?.level}`}>
                {params.value}
              </span>
            </div>
          );
        }
      }
    },
    {
      field: 'level',
      headerName: 'Level',
      width: 120,
      cellRenderer: (params: any) => (
        <span className={`badge badge-${params.value}`}>
          {params.value?.toUpperCase()}
        </span>
      )
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      cellRenderer: (params: any) => {
        const statusColors: any = {
          'pending': 'gray',
          'in_progress': 'blue',
          'completed': 'green',
          'blocked': 'red'
        };
        return (
          <span className={`status-badge ${statusColors[params.value]}`}>
            {params.value?.replace('_', ' ')}
          </span>
        );
      }
    },
    {
      field: 'assignee',
      headerName: 'Assignee',
      width: 150
    },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 100,
      cellRenderer: (params: any) => {
        const priorityColors: any = {
          'critical': 'red',
          'high': 'orange',
          'medium': 'yellow',
          'low': 'green'
        };
        return (
          <span className={`priority-badge ${priorityColors[params.value]}`}>
            {params.value}
          </span>
        );
      }
    },
    {
      field: 'effort',
      headerName: 'Effort',
      width: 100,
      valueFormatter: (params: any) => params.value ? `${params.value} pts` : '-'
    },
    {
      field: 'labels',
      headerName: 'Labels',
      width: 200,
      cellRenderer: (params: any) => (
        <div className="labels-container">
          {params.value?.map((label: string) => (
            <span key={label} className="label-tag">
              {label}
            </span>
          ))}
        </div>
      )
    },
    {
      field: 'acceptanceCriteria',
      headerName: 'Acceptance Criteria',
      width: 300,
      autoHeight: true,
      cellRenderer: (params: any) => {
        if (!params.value || params.value.length === 0) return '-';
        return (
          <ul className="ac-list">
            {params.value.map((ac: string, idx: number) => (
              <li key={idx}>{ac}</li>
            ))}
          </ul>
        );
      }
    }
  ], []);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true
  }), []);

  const getDataPath = useCallback((data: any) => data.path, []);

  const autoGroupColumnDef = useMemo(() => ({
    headerName: 'Hierarchy',
    minWidth: 300,
    cellRendererParams: {
      suppressCount: false
    }
  }), []);

  const onRowClicked = useCallback((event: any) => {
    setSelectedItem(event.data);
  }, [setSelectedItem]);

  const onGridReady = useCallback((params: any) => {
    params.api.sizeColumnsToFit();
  }, []);

  return (
    <div className="hierarchical-grid-container">
      <div className="grid-toolbar">
        <button onClick={() => gridRef.current?.api?.expandAll()}>
          Expand All
        </button>
        <button onClick={() => gridRef.current?.api?.collapseAll()}>
          Collapse All
        </button>
        <button onClick={() => gridRef.current?.api?.exportDataAsCsv()}>
          Export CSV
        </button>
      </div>

      <div className="ag-theme-material grid-wrapper">
        <AgGridReact
          ref={gridRef}
          rowData={hierarchicalData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          treeData={true}
          getDataPath={getDataPath}
          autoGroupColumnDef={autoGroupColumnDef}
          groupDefaultExpanded={1}
          animateRows={true}
          onRowClicked={onRowClicked}
          onGridReady={onGridReady}
          enableRangeSelection={true}
          enableCharts={true}
          sideBar={{
            toolPanels: [
              {
                id: 'columns',
                labelDefault: 'Columns',
                labelKey: 'columns',
                iconKey: 'columns',
                toolPanel: 'agColumnsToolPanel',
              },
              {
                id: 'filters',
                labelDefault: 'Filters',
                labelKey: 'filters',
                iconKey: 'filter',
                toolPanel: 'agFiltersToolPanel',
              }
            ]
          }}
        />
      </div>

      {selectedItem && (
        <div className="item-details-panel">
          <h3>{selectedItem.title}</h3>
          <p>{selectedItem.description}</p>
          <div className="details-grid">
            <div>Level: {selectedItem.level}</div>
            <div>Status: {selectedItem.status}</div>
            <div>Priority: {selectedItem.priority}</div>
            <div>Effort: {selectedItem.effort}</div>
          </div>
        </div>
      )}
    </div>
  );
};