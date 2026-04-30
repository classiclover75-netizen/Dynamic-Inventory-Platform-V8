import React, { useState, useEffect } from 'react';
import { Button, Modal } from './ui';
import { Column } from '../types';

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select Columns for Live Tracker" width="max-w-md">
      <div className="text-sm text-gray-600 mb-4">
        Choose which columns from <b>{sourcePage}</b> you want to include in the new Live Tracker. 
        "Row No." is always included. "Total Qty" and "Remaining Qty" will be added automatically.
      </div>
      
      <div className="flex gap-2 mb-3">
        <Button variant="outline" className="text-xs py-1" onClick={handleSelectAll}>Select All</Button>
        <Button variant="outline" className="text-xs py-1" onClick={handleDeselectAll}>Deselect All</Button>
      </div>

      <div className="max-h-[300px] overflow-auto border border-gray-200 rounded p-2 bg-gray-50 flex flex-col gap-1">
        {sourceColumns.map(c => (
          <label
            key={c.key}
            className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
              c.key === 'sr' ? 'bg-gray-100 border-gray-200 text-gray-500' : 'bg-white border-gray-300 hover:bg-blue-50'
            }`}
          >
            <input
              type="checkbox"
              className="w-4 h-4 text-blue-600 rounded cursor-pointer pointer-events-none"
              checked={c.key === 'sr' || selectedColKeys.includes(c.key)}
              readOnly={c.key === 'sr'}
              onChange={() => handleToggle(c.key)}
            />
            <div className="flex-1 flex justify-between items-center">
              <span className="text-sm font-semibold">{c.name}</span>
              <span className="text-xs text-gray-500">{c.type}</span>
            </div>
            {c.key === 'sr' && <span className="text-xs text-gray-400 italic">Locked</span>}
          </label>
        ))}
      </div>

      <div className="mt-4 flex justify-end gap-2 pt-3 border-t border-gray-100">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="green" onClick={() => onConfirm(selectedColKeys)}>
           ⚡ Create Linked Tracker
        </Button>
      </div>
    </Modal>
  );
};
