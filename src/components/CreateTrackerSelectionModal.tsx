import React, { useState, useEffect } from 'react';
import { Button, Modal } from './ui';
import { Column } from '../types';
import { ArrowLeft, LayoutList } from 'lucide-react';

interface CreateTrackerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourcePage: string;
  sourceColumns: Column[];
  onConfirm: (selectedColKeys: string[]) => void;
}

export const CreateTrackerSelectionModal: React.FC<CreateTrackerSelectionModalProps> = ({
  isOpen,
  onClose,
  sourcePage,
  sourceColumns,
  onConfirm,
}) => {
  const [selectedColKeys, setSelectedColKeys] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Pre-select all columns except 'sr' (which is selected by default and immutable)
      setSelectedColKeys(sourceColumns.filter(c => c.key !== 'sr').map(c => c.key));
    }
  }, [isOpen, sourceColumns]);

  const handleToggle = (key: string) => {
    if (key === 'sr') return; // Cannot toggle 'sr'
    setSelectedColKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSelectAll = () => {
    setSelectedColKeys(sourceColumns.filter(c => c.key !== 'sr').map(c => c.key));
  };

  const handleDeselectAll = () => {
    setSelectedColKeys([]);
  };

  const availableColumnsCount = sourceColumns.filter(c => c.key !== 'sr').length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`⚡ Create Linked Tracker (${sourcePage})`} width="95vw" noScroll={true}>
      <div className="flex flex-col h-[85vh] p-4">
        
        <div className="flex flex-col gap-2 mb-4 shrink-0 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-700">Columns Setup:</span>
            <div className="flex gap-2">
              <button 
                onClick={handleSelectAll}
                className="px-2 py-1 text-[10px] font-bold bg-[#2b579a] text-white rounded hover:bg-[#1a3c6d] transition-colors"
              >
                Select All
              </button>
              <button 
                onClick={handleDeselectAll}
                className="px-2 py-1 text-[10px] font-bold bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors border border-gray-300"
              >
                Select None
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Choose which columns from <b>{sourcePage}</b> you want to include in the new Live Tracker. 
            "Row No." is always included. "Total Qty" and "Remaining Qty" will be added automatically.
          </p>
        </div>

        <div className="flex-1 overflow-auto border rounded relative bg-white">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-100 z-10 shadow-sm">
              <tr>
                <th className="p-2 border w-10 text-center">
                  <input 
                    type="checkbox" 
                    className="cursor-pointer"
                    checked={selectedColKeys.length === availableColumnsCount && availableColumnsCount > 0}
                    onChange={(e) => {
                      if (e.target.checked) handleSelectAll();
                      else handleDeselectAll();
                    }} 
                  />
                </th>
                <th className="p-2 border text-left">
                  <div className="flex items-center gap-1">Column Name</div>
                </th>
                <th className="p-2 border text-left">
                  <div className="flex items-center gap-1">Data Type</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sourceColumns.map((col, idx) => {
                const isSelected = col.key === 'sr' || selectedColKeys.includes(col.key);
                return (
                  <tr key={col.key} className={isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="p-2 border text-center">
                      <input 
                        type="checkbox" 
                        className="cursor-pointer"
                        checked={isSelected}
                        disabled={col.key === 'sr'}
                        onChange={() => handleToggle(col.key)} 
                      />
                    </td>
                    <td className="p-2 border whitespace-pre-wrap break-words min-w-[150px]">
                      <div className="flex items-center gap-1">
                         {idx + 1}. {col.name} {col.key === 'sr' && '🔒'}
                      </div>
                    </td>
                    <td className="p-2 border whitespace-pre-wrap break-words min-w-[150px] capitalize">
                      {col.type.replace('_', ' ')}
                    </td>
                  </tr>
                );
              })}
              {sourceColumns.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-gray-500 font-medium">
                    No columns available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t sticky bottom-0 bg-white z-10 pb-2 shrink-0">
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-md">
            {selectedColKeys.length} active columns
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex items-center gap-2">
              <ArrowLeft size={16} /> Cancel
            </Button>
            <Button 
              variant="dark" 
              onClick={() => onConfirm(selectedColKeys)} 
              className="flex items-center gap-2"
              disabled={selectedColKeys.length === 0 && sourceColumns.length > 1}
            >
              <LayoutList size={16} /> ⚡ Create Linked Tracker
            </Button>
          </div>
        </div>

      </div>
    </Modal>
  );
};

