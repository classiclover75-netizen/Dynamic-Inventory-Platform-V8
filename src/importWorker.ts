import { openDB } from 'idb';
import ExcelJS from 'exceljs';

const bufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
};

self.onmessage = async (e) => {
  const { file, type } = e.data;
  
  if (type === 'excel') {
    try {
      postMessage({ type: 'progress', message: 'Reading Excel file...', percent: 10 });
      const arrayBuffer = await file.arrayBuffer();
      
      postMessage({ type: 'progress', message: 'Parsing workbook (this might take a while)...', percent: 40 });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      
      const worksheet = workbook.worksheets[0];
      const extractedHeaders: string[] = [];
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        extractedHeaders[colNumber - 1] = cell.value?.toString() || `Col ${colNumber}`;
      });

      const rows: any[] = [];
      let currentTrimCount = 0;
      
      postMessage({ type: 'progress', message: 'Extracting data...', percent: 60 });
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        
        const rowData: any = { _id: `import_${Date.now()}_${rowNumber}` };
        let hasData = false;
        
        extractedHeaders.forEach((h, i) => {
          if (!h) return;
          const cell = row.getCell(i + 1);
          let cellValue = '';
          const val = cell.value;
          
          if (val && typeof val === 'object') {
            if ('result' in val) {
              cellValue = (val as any).result !== null && (val as any).result !== undefined ? String((val as any).result) : '';
            } else if ('richText' in val && Array.isArray((val as any).richText)) {
              cellValue = (val as any).richText.map((rt: any) => {
                let text = rt.text;
                if (rt.font) {
                  let style = '';
                  if (rt.font.color && rt.font.color.argb) {
                    const argb = rt.font.color.argb;
                    const color = argb.length === 8 ? `#${argb.substring(2)}` : `#${argb}`;
                    style += `color: ${color};`;
                  }
                  if (rt.font.bold) style += 'font-weight: bold;';
                  if (rt.font.italic) style += 'font-style: italic;';
                  if (rt.font.underline) style += 'text-decoration: underline;';
                  if (rt.font.strike) style += 'text-decoration: line-through;';
                  
                  if (style) {
                    return text.split(/\r?\n/).map((line: any) => line ? `<span style="${style}">${line}</span>` : '').join('\n');
                  }
                }
                return text;
              }).join('');
            } else if ('text' in val) {
              cellValue = String((val as any).text);
            } else {
              cellValue = '';
            }
          } else {
            cellValue = val !== null && val !== undefined ? String(val) : '';
          }
          
          const trimmedValue = cellValue.trim();
          if (cellValue !== trimmedValue) {
            currentTrimCount++;
          }
          
          rowData[h] = trimmedValue;
          if (trimmedValue !== '') hasData = true;
        });

        if (!hasData) return;

        rowData._excelIdx = rowNumber;
        rows.push(rowData);
      });

      postMessage({ type: 'progress', message: 'Extracting images...', percent: 70 });
      const images = worksheet.getImages();
      if (images.length > 0) {
        const rowMap = new Map();
        rows.forEach(r => rowMap.set(r._excelIdx, r));

        for (let i = 0; i < images.length; i++) {
          const image = images[i];
          const img = workbook.getImage(Number(image.imageId));
          const targetRowIdx = Math.floor(image.range.tl.nativeRow) + 1;
          const targetRow = rowMap.get(targetRowIdx);
          
          if (targetRow && img.buffer) {
            const base64 = bufferToBase64(img.buffer as ArrayBuffer);
            const dataUrl = `data:image/${img.extension};base64,${base64}`;
            const picCol = extractedHeaders.find(h => h && h.includes('Pics')) || extractedHeaders[0];
            if (picCol) {
              targetRow[picCol] = dataUrl;
            }
          }
          if (i % 20 === 0) {
             postMessage({ type: 'progress', percent: 70 + Math.floor((i / images.length) * 20), message: `Extracting images... (${i}/${images.length})` });
          }
        }
      }

      // Memory leak cleanup: exceljs is heavy
      workbook.worksheets.forEach(ws => {
         // @ts-ignore
         if (ws.destroy) ws.destroy();
      });

      postMessage({
        type: 'success',
        headers: extractedHeaders.filter(h => h),
        rows,
        trimmedCount: currentTrimCount
      });
    } catch (error: any) {
      postMessage({ type: 'error', message: error.message || 'Unknown error' });
    }
    return;
  }
  
  // Normal JSON backup import (original code)
  try {
    postMessage({ type: 'progress', message: 'Reading file...', percent: 10 });
    const text = await file.text();
    
    postMessage({ type: 'progress', message: 'Parsing data...', percent: 30 });
    const parsed = JSON.parse(text);
    
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.pages)) {
      throw new Error("Invalid backup file format");
    }

    if (parsed.pages.length > 0 && !parsed.activePage) {
      parsed.activePage = parsed.pages[0];
    }
    
    if (!parsed.globalCopyBoxes) {
      parsed.globalCopyBoxes = {
        enabled: true,
        box1: { sourcePage: '', sourceColumn: '' },
        box2: { sourcePage: '', sourceColumn: '' },
        separator: '-',
        order: ['box1', 'box2', 'box3']
      };
    } else if (typeof parsed.globalCopyBoxes.enabled !== 'boolean') {
      parsed.globalCopyBoxes.enabled = true;
    }

    if (parsed.pageRows) {
      const pageNames = Object.keys(parsed.pageRows);
      let totalRows = 0;
      for (const p of pageNames) {
        totalRows += Array.isArray(parsed.pageRows[p]) ? parsed.pageRows[p].length : 0;
      }
      
      let processed = 0;
      if (totalRows > 0) {
        for (const p of pageNames) {
          const rows = parsed.pageRows[p];
          if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) {
              processed++;
              if (processed % 1000 === 0) {
                 const pct = Math.floor(30 + (processed / totalRows) * 50);
                 postMessage({ type: 'progress', message: `Processing rows (${processed}/${totalRows})...`, percent: pct });
              }
            }
          }
        }
      }
    }

    postMessage({ type: 'progress', message: 'Buffering in IndexedDB...', percent: 80 });
    const db = await openDB('InventoryImportDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('import_buffer')) {
          db.createObjectStore('import_buffer');
        }
      },
    });

    await db.put('import_buffer', parsed, 'latest_import');
    db.close();
    
    postMessage({ type: 'progress', message: 'Syncing with backend...', percent: 95 });
    postMessage({ type: 'success' });
  } catch (error: any) {
    postMessage({ type: 'error', error: error.message || 'Unknown error' });
  }
};
