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

  const availableColumnsCount = sourceColumns.filter(c => c.key !== 'sr').length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`⚡ Create Linked Tracker (${sourcePage})`} width="max-w-4xl" noScroll={true}>
      <div className="flex flex-col h-[70vh] p-4">
        
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
            Choose which columns to include in the Live Tracker. <b>Row No.</b> is always included. 
            <b> Total Qty</b> and <b>Remaining Qty</b> will be automatically appended.
          </p>
        </div>

        <div className="flex-1 overflow-auto border rounded relative bg-white">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-100 z-10 shadow-sm">
              <tr>
                <th className="p-2 border w-10 text-center">
                  <input 
                    type="checkbox" 
                    className="cursor-pointer accent-[#2b579a]"
                    checked={selectedColKeys.length === availableColumnsCount && availableColumnsCount > 0}
                    onChange={(e) => {
                      if (e.target.checked) handleSelectAll();
                      else handleDeselectAll();
                    }} 
                  />
                </th>
                <th className="p-2 border text-left">Column Name</th>
                <th className="p-2 border text-left">Data Type</th>
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
                        className={`cursor-pointer ${col.key === 'sr' ? 'accent-gray-400' : 'accent-[#2b579a]'}`}
                        checked={isSelected}
                        disabled={col.key === 'sr'}
                        onChange={() => handleToggle(col.key)} 
                      />
                    </td>
                    <td className="p-2 border text-gray-800">
                      <div className="flex items-center gap-1 font-medium">
                         {idx + 1}. {col.name} {col.key === 'sr' && <span className="text-xs italic text-gray-500 ml-1">🔒 Locked</span>}
                      </div>
                    </td>
                    <td className="p-2 border text-gray-600 capitalize">
                      {col.type.replace('_', ' ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center mt-4 pt-4 border-t sticky bottom-0 bg-white z-10 pb-2 shrink-0">
          <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-md">
            {selectedColKeys.length} active columns
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex items-center gap-2">
               Cancel
            </Button>
            <Button 
              variant="dark" 
              onClick={() => onConfirm(selectedColKeys)} 
              className="flex items-center gap-2 !bg-[#2b579a] hover:!bg-[#1a3c6d] text-white"
              disabled={selectedColKeys.length === 0 && sourceColumns.length > 1}
            >
               ⚡ Create Linked Tracker
            </Button>
          </div>
        </div>

      </div>
    </Modal>
  );
};

