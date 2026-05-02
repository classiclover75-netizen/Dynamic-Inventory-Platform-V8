import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));

// MongoDB Connection with Retry
let isUsingMongoDB = false;

const connectDB = async () => {
  // 1. Clean the URI (remove extra quotes or spaces)
  let rawUri = process.env.MONGODB_URI;
  if (rawUri) {
    rawUri = rawUri.replace(/^["']|["']$/g, '').trim();
  }

  // 2. Determine final URI
  const uri = rawUri || (process.env.NODE_ENV === 'production' ? 'mongodb://db:27017/inventory' : '');

  // 3. Fallback check for AI Studio / Local Preview
  if (!uri || (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://'))) {
    console.warn('No valid MONGODB_URI found (Invalid scheme or empty). Using local file storage fallback for preview.');
    return;
  }

  // 4. Connection Loop
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
      console.log('Connected to MongoDB');
      isUsingMongoDB = true;
      return;
    } catch (err: any) {
      retries++;
      console.error(`MongoDB connection attempt ${retries} failed. ${err.message}`);
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  console.warn('Could not connect to MongoDB after retries. Falling back to local file storage for preview.');
};
connectDB();

// Local Storage Fallback Logic
const LOCAL_DB_PATH = path.join(process.cwd(), 'db.json');

async function getLocalDB() {
  try {
    const data = await fs.promises.readFile(LOCAL_DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { pages: [], settings: {} };
  }
}

async function saveLocalDB(data: any) {
  await fs.promises.writeFile(LOCAL_DB_PATH, JSON.stringify(data, null, 2));
}

// Image Helpers
async function processRowImages(row: any, forceSave = false, imageProcessingCache?: Map<string, Promise<string>>) {
  const newRow = { ...row };
  const writePromises: Promise<void>[] = [];

  for (const key in newRow) {
    const value = newRow[key];
    let imgVal = value;
    const isObject = typeof value === 'object' && value !== null && typeof value.data === 'string';
    if (isObject) {
      imgVal = value.data;
    }

    if (typeof imgVal === 'string') {
      if (/^[a-zA-Z0-9_\-\.]+\.(png|jpg|jpeg|webp|gif|avif|tiff)$/i.test(imgVal)) {
        if (fs.existsSync(path.join(UPLOADS_DIR, imgVal))) {
          continue; 
        }
      }

      if (/^https?:\/\//i.test(imgVal)) {
        if (imgVal.includes('/uploads/')) {
          const matchedFilename = imgVal.split('/uploads/').pop()?.split('?')[0];
          if (matchedFilename && fs.existsSync(path.join(UPLOADS_DIR, matchedFilename))) {
             newRow[key] = isObject ? { ...value, data: matchedFilename } : matchedFilename;
             continue;
          }
        }
        
        if (imageProcessingCache && imageProcessingCache.has(imgVal)) {
          writePromises.push((async () => {
            try {
              const filename = await imageProcessingCache.get(imgVal);
              newRow[key] = isObject ? { ...value, data: filename } : filename;
            } catch (err) {
              console.error(`Failed to get cached URL image ${imgVal}:`, err);
            }
          })());
        } else {
          const processPromise = (async () => {
            const response = await fetch(imgVal);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            let buffer = Buffer.from(arrayBuffer);
            let ext = 'jpg';
            
            const contentType = response.headers.get('content-type');
            if (contentType) {
               if (contentType.includes('png')) ext = 'png';
               else if (contentType.includes('gif')) ext = 'gif';
               else if (contentType.includes('webp')) ext = 'webp';
            }

            let skipSharp = false;
            if (buffer.byteLength <= 100 * 1024 && forceSave) {
              skipSharp = true;
            }

            if (!skipSharp) {
              try {
                const metadata = await sharp(buffer).metadata();
                if (buffer.byteLength > 300 * 1024 || (metadata.width && metadata.width > 1200) || (metadata.height && metadata.height > 1200)) {
                  buffer = await sharp(buffer)
                    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                  ext = 'jpg';
                }
              } catch (sharpError) {
                if (!forceSave) throw new Error('SHARP_UNSUPPORTED_FORMAT');
                console.error(`Sharp processing failed for ${imgVal}:`, sharpError);
              }
            }
            
            const filename = `${uuidv4()}.${ext}`;
            const filepath = path.join(UPLOADS_DIR, filename);
            await fs.promises.writeFile(filepath, buffer);
            return filename;
          })();

          if (imageProcessingCache) imageProcessingCache.set(imgVal, processPromise);

          writePromises.push((async () => {
            try {
              const filename = await processPromise;
              newRow[key] = isObject ? { ...value, data: filename } : filename;
            } catch (err: any) {
              if (imageProcessingCache) imageProcessingCache.delete(imgVal);
              if (err.message === 'SHARP_UNSUPPORTED_FORMAT') throw err;
              console.error(`Failed to process URL image ${imgVal}:`, err);
            }
          })());
        }
      } else if (imgVal.startsWith('data:image/')) {
        const hashBase64 = imgVal; // Use the exact base64 data for deduplication

        if (imageProcessingCache && imageProcessingCache.has(hashBase64)) {
          writePromises.push((async () => {
            try {
              const filename = await imageProcessingCache.get(hashBase64);
              newRow[key] = isObject ? { ...value, data: filename } : filename;
            } catch (err) {
              console.error("Failed to get cached base64 image:", err);
            }
          })());
        } else {
          const processPromise = (async () => {
            const parts = imgVal.split(';base64,');
            const mimeType = parts[0].replace('data:image/', '');
            let ext = mimeType.split('+')[0];
            if (ext === 'jpeg') ext = 'jpg';
            if (!ext) ext = 'png';
            const base64Data = parts[1];
            let buffer = Buffer.from(base64Data, 'base64');
            
            let skipSharp = false;
            if (buffer.byteLength <= 100 * 1024 && forceSave) {
              skipSharp = true;
            }

            if (!skipSharp) {
              try {
                const metadata = await sharp(buffer).metadata();
                if (buffer.byteLength > 300 * 1024 || (metadata.width && metadata.width > 1200) || (metadata.height && metadata.height > 1200)) {
                  buffer = await sharp(buffer)
                    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toBuffer();
                  ext = 'jpg';
                }
              } catch (sharpError) {
                 if (!forceSave) throw new Error('SHARP_UNSUPPORTED_FORMAT');
                 console.error("Sharp processing failed for base64:", sharpError);
              }
            }
            
            const filename = `${uuidv4()}.${ext}`;
            const filepath = path.join(UPLOADS_DIR, filename);
            await fs.promises.writeFile(filepath, buffer);
            return filename;
          })();

          if (imageProcessingCache) imageProcessingCache.set(hashBase64, processPromise);

          writePromises.push((async () => {
            try {
              const filename = await processPromise;
              newRow[key] = isObject ? { ...value, data: filename } : filename;
            } catch (err: any) {
              if (imageProcessingCache) imageProcessingCache.delete(hashBase64);
              if (err.message === 'SHARP_UNSUPPORTED_FORMAT') throw err;
              console.error("Failed to process base64 image:", err);
            }
          })());
        }
      }
    }
  }
  await Promise.all(writePromises);
  return newRow;
}

async function processRowsConcurrently(rows: any[], limit = 50, forceSave = false, providedCache?: Map<string, Promise<string>>) {
  const imageProcessingCache = providedCache || new Map<string, Promise<string>>();
  const results = [];
  for (let i = 0; i < rows.length; i += limit) {
    const chunk = rows.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(r => processRowImages(r, forceSave, imageProcessingCache)));
    results.push(...chunkResults);
    // Yield to event loop to avoid blocking during large batches
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return results;
}

async function cleanupOrphanImages(oldRows: any[], newRows: any[], skipDbCheck = false) {
  const oldFiles = new Set<string>();
  const newFiles = new Set<string>();
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

  const extractFiles = (rows: any[], set: Set<string>) => {
    rows.forEach(row => {
      Object.values(row).forEach(value => {
        let val = value;
        if (typeof value === 'object' && value !== null && typeof (value as any).data === 'string') {
          val = (value as any).data;
        }
        if (typeof val === 'string') {
          if (val.includes('/uploads/')) {
            val = val.split('/uploads/').pop() || val;
          }
          const strVal = val as string;
          if (imageExtensions.some(ext => strVal.toLowerCase().endsWith(ext)) && !/^https?:\/\//i.test(strVal)) {
            set.add(strVal);
          }
        }
      });
    });
  };

  extractFiles(oldRows, oldFiles);
  extractFiles(newRows, newFiles);

  const candidates = new Set<string>();
  oldFiles.forEach(file => {
    if (!newFiles.has(file)) {
      candidates.add(file);
    }
  });

  if (candidates.size === 0) return;

  const otherUsedFiles = new Set<string>();
  const oldRowIds = new Set(oldRows.map(r => String(r.id)));

  if (!skipDbCheck) {
    if (isUsingMongoDB) {
      const allRecords = await PageRow.find({});
      const remainingRecords = allRecords.filter(r => !oldRowIds.has(String(r.data.id)));
      extractFiles(remainingRecords.map(r => r.data), otherUsedFiles);
    } else {
      const db = await getLocalDB();
      db.pages.forEach((p: any) => {
        if (p.rows) {
          const remainingRows = p.rows.filter((r: any) => !oldRowIds.has(String(r.id)));
          extractFiles(remainingRows, otherUsedFiles);
        }
      });
    }
  }

  candidates.forEach(file => {
    if (!otherUsedFiles.has(file)) {
      try {
        const filepath = path.join(UPLOADS_DIR, file);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      } catch (err) {
        console.error(`Failed to delete orphaned image ${file}:`, err);
      }
    }
  });
}

// Mongoose Schema
const pageSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  config: { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Page = mongoose.model('Page', pageSchema);

const pageRowSchema = new mongoose.Schema({
  pageName: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});
const PageRow = mongoose.model('PageRow', pageRowSchema);

const settingsSchema = new mongoose.Schema({
  globalCopyBoxes: mongoose.Schema.Types.Mixed,
  globalRowNoWidth: Number,
  maxSearchHistory: { type: Number, default: 10 }
});
const AppSettings = mongoose.model('AppSettings', settingsSchema);

// API Routes
function embedImagesInRows(rows: any[]) {
  return rows.map(row => {
    const newRow = { ...row };
    for (const key in newRow) {
      let val = newRow[key];
      let isObject = false;
      if (typeof val === 'object' && val !== null && typeof val.data === 'string') {
        val = val.data;
        isObject = true;
      }

      if (typeof val === 'string') {
        let filename = val;
        let shouldEmbed = false;

        if (filename.includes('/uploads/')) {
          filename = filename.split('/uploads/').pop() || filename;
          filename = filename.split('?')[0]; // remove query string
          shouldEmbed = true;
        } else if (!/^https?:\/\//i.test(filename)) {
          shouldEmbed = true;
        }
        
        if (shouldEmbed && /\.(png|jpe?g|gif|webp|avif|tiff)$/i.test(filename)) {
          try {
            const filepath = path.join(UPLOADS_DIR, filename);
            if (fs.existsSync(filepath)) {
              const ext = path.extname(filename).substring(1).toLowerCase();
              const mimeType = ext === 'jpg' ? 'jpeg' : ext;
              const fileData = fs.readFileSync(filepath, { encoding: 'base64' });
              const result = `data:image/${mimeType};base64,${fileData}`;
              newRow[key] = isObject ? { ...newRow[key], data: result } : result;
            } else {
              newRow[key] = isObject ? { ...newRow[key], data: val } : val;
            }
          } catch (e) {
            console.error(`Failed to convert image ${val} to base64:`, e);
            newRow[key] = isObject ? { ...newRow[key], data: val } : val;
          }
        } else {
           newRow[key] = isObject ? { ...newRow[key], data: val } : val;
        }
      }
    }
    return newRow;
  });
}

app.post('/api/admin/migrate-images', async (req, res) => {
  try {
    let migratedCount = 0;
    const brokenImages: any[] = [];
    
    const migrateRow = async (row: any, pageName: string) => {
      let imageMigratedCount = 0;
      const newRow = { ...row };
      const rowPromises: Promise<void>[] = [];
      
      for (const key in newRow) {
        let val = newRow[key];
        let isObject = false;
        if (typeof val === 'object' && val !== null && typeof val.data === 'string') {
          val = val.data;
          isObject = true;
        }

        if (typeof val === 'string') {
          if (/^https?:\/\//i.test(val)) {
            if (val.includes('/uploads/')) {
              let filename = val.split('/uploads/').pop() || val;
              filename = filename.split('?')[0];
              newRow[key] = isObject ? { ...newRow[key], data: filename } : filename;
              imageMigratedCount++;
              
              if (!fs.existsSync(path.join(UPLOADS_DIR, filename))) {
                brokenImages.push({ page: pageName, rowId: row.id, column: key, filename });
              }
            } else {
              rowPromises.push((async () => {
                const dummyRow = { [key]: newRow[key] };
                try {
                  const processed = await processRowImages(dummyRow, true);
                  if (processed[key] !== newRow[key]) {
                     newRow[key] = processed[key];
                     imageMigratedCount++;
                  }
                } catch (e) {
                  console.error("Migration error for external URL:", e);
                }
              })());
            }
          } else if (!val.startsWith('data:') && /\.(png|jpe?g|gif|webp|avif|tiff)$/i.test(val)) {
            if (!fs.existsSync(path.join(UPLOADS_DIR, val))) {
              brokenImages.push({ page: pageName, rowId: row.id, column: key, filename: val });
            }
          }
        }
      }
      await Promise.all(rowPromises);
      return { newRow, imageMigratedCount };
    };

    const migrateRowsConcurrently = async (rows: any[], pageName: string) => {
       const mapped = [];
       for (let i = 0; i < rows.length; i += 50) {
         const chunk = rows.slice(i, i + 50);
         const chunkResults = await Promise.all(chunk.map(r => migrateRow(r, pageName)));
         mapped.push(...chunkResults);
       }
       return mapped;
    };

    if (isUsingMongoDB) {
      const oldPageRows = await PageRow.find({});
      const pagesMap = new Map<string, any[]>();
      
      for (const pr of oldPageRows) {
        if (!pagesMap.has(pr.pageName)) pagesMap.set(pr.pageName, []);
        pagesMap.get(pr.pageName)!.push(pr.data);
      }
      
      for (const [pageName, rows] of pagesMap.entries()) {
        const results = await migrateRowsConcurrently(rows, pageName);
        const newRows = results.map((r: any) => r.newRow);
        const thisPageMigratedCount = results.reduce((sum: number, r: any) => sum + r.imageMigratedCount, 0);
        
        if (thisPageMigratedCount > 0) {
          migratedCount += thisPageMigratedCount;
          await cleanupOrphanImages(rows, newRows);
          await PageRow.deleteMany({ pageName });
          await PageRow.insertMany(newRows.map((r: any) => ({ pageName, data: r })));
        }
      }
    } else {
      const db = await getLocalDB();
      for (const page of db.pages) {
        if (!page.rows || page.rows.length === 0) continue;
        const results = await migrateRowsConcurrently(page.rows, page.name);
        const newRows = results.map((r: any) => r.newRow);
        const thisPageMigratedCount = results.reduce((sum: number, r: any) => sum + r.imageMigratedCount, 0);
        
        if (thisPageMigratedCount > 0) {
          migratedCount += thisPageMigratedCount;
          await cleanupOrphanImages(page.rows, newRows);
          page.rows = newRows;
        }
      }
      if (migratedCount > 0) {
        await saveLocalDB(db);
      }
    }

    res.json({ success: true, count: migratedCount, brokenImages });
  } catch (err: any) {
    console.error("Migration failed:", err);
    res.status(500).json({ error: 'Migration failed' });
  }
});

app.get('/api/export/page/:name', async (req, res) => {
  try {
    const { name } = req.params;
    let pageData: any = null;

    if (isUsingMongoDB) {
      const page = await Page.findOne({ name });
      if (!page) {
        return res.status(404).json({ error: 'Page not found' });
      }
      const oldPageRows = await PageRow.find({ pageName: name });
      const rows = oldPageRows.map(r => r.data);
      
      pageData = {
        name: page.name,
        config: page.config,
        rows: embedImagesInRows(rows)
      };
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (!page) {
        return res.status(404).json({ error: 'Page not found' });
      }
      pageData = {
        name: page.name,
        config: page.config,
        rows: embedImagesInRows(page.rows || [])
      };
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}_backup_${Date.now()}.json"`);
    res.send(JSON.stringify(pageData, null, 2));

  } catch (err) {
    console.error("Export page failed:", err);
    res.status(500).json({ error: 'Failed to export page' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    let state: any = {};
    if (isUsingMongoDB) {
      const pages = await Page.find({});
      const rows = await PageRow.find({});
      const settings: any = await AppSettings.findOne() || {};
      
      const pageConfigs: Record<string, any> = {};
      const pageRows: Record<string, any[]> = {};
      
      pages.forEach(p => {
        pageConfigs[p.name] = p.config;
      });
      
      rows.forEach(r => {
        if (!pageRows[r.pageName]) pageRows[r.pageName] = [];
        pageRows[r.pageName].push(r.data);
      });

      // Embed images
      for (const pageName in pageRows) {
        pageRows[pageName] = embedImagesInRows(pageRows[pageName]);
      }
      
      state = {
        pages: pages.map(p => p.name),
        activePage: pages.length > 0 ? pages[0].name : '',
        pageConfigs,
        pageRows,
        globalCopyBoxes: settings.globalCopyBoxes,
        globalRowNoWidth: settings.globalRowNoWidth,
        maxSearchHistory: settings.maxSearchHistory
      };
    } else {
      state = await getLocalDB();
      if (state.pages) {
        state.pages = state.pages.map((page: any) => ({
          ...page,
          rows: embedImagesInRows(page.rows || [])
        }));
      }
    }

    const date = new Date();
    const day = String(date.getDate()).padStart(2, '0');
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    const formattedDate = `${day}-${month}-${year}`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=inventory_backup_${formattedDate}.json`);
    res.send(JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.get('/api/state', async (req, res) => {
  try {
    if (isUsingMongoDB) {
      const pages = await Page.find({}, 'name');
      const settings: any = await AppSettings.findOne() || {};
      
      const state = {
        pages: pages.map(p => p.name),
        globalCopyBoxes: settings.globalCopyBoxes,
        globalRowNoWidth: settings.globalRowNoWidth,
        maxSearchHistory: settings.maxSearchHistory
      };
      
      return res.json(state);
    } else {
      const db = await getLocalDB();
      const state = {
        pages: db.pages.map((p: any) => p.name),
        globalCopyBoxes: db.settings?.globalCopyBoxes,
        globalRowNoWidth: db.settings?.globalRowNoWidth,
        maxSearchHistory: db.settings?.maxSearchHistory
      };
      return res.json(state);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

app.get('/api/pages/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (isUsingMongoDB) {
      const page = await Page.findOne({ name });
      if (!page) return res.status(404).json({ error: 'Page not found' });
      
      const rows = await PageRow.find({ pageName: name });
      
      return res.json({
        name: page.name,
        config: page.config,
        rows: rows.map(r => r.data)
      });
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (!page) return res.status(404).json({ error: 'Page not found' });
      
      return res.json({
        name: page.name,
        config: page.config,
        rows: page.rows || []
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch page data' });
  }
});

app.post('/api/pages', async (req, res) => {
  try {
    const { name, config } = req.body;
    if (isUsingMongoDB) {
      const newPage = new Page({ name, config });
      await newPage.save();
    } else {
      const db = await getLocalDB();
      db.pages.push({ name, config, rows: [] });
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create page' });
  }
});

app.put('/api/pages/:name/rename', async (req, res) => {
  try {
    const { name } = req.params;
    const { newName } = req.body;
    if (isUsingMongoDB) {
      await Page.findOneAndUpdate({ name }, { name: newName });
      await PageRow.updateMany({ pageName: name }, { pageName: newName });
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (page) page.name = newName;
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename page' });
  }
});

app.delete('/api/pages/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (isUsingMongoDB) {
      await Page.findOneAndDelete({ name });
      await PageRow.deleteMany({ pageName: name });
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (page) {
        db.pages = db.pages.filter((p: any) => p.name !== name);
      }
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

app.put('/api/pageConfigs/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { config } = req.body;
    if (isUsingMongoDB) {
      await Page.findOneAndUpdate({ name }, { config });
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (page) page.config = config;
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

app.put('/api/pageRows/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { rows } = req.body;
    const forceSave = req.query.force === 'true';
    
    let rowsToProcess = rows || [];
    const seenIds = new Set<string>();
    rowsToProcess = rowsToProcess.map((row: any) => {
      if (!row.id || seenIds.has(String(row.id))) {
        row.id = uuidv4();
      }
      seenIds.add(String(row.id));
      return row;
    });

    if (isUsingMongoDB) {
      const oldPageRows = await PageRow.find({ pageName: name });
      const oldRows = oldPageRows.map(r => r.data);
      const newRows = await processRowsConcurrently(rowsToProcess, 50, forceSave);
      
      await PageRow.deleteMany({ pageName: name });
      if (newRows.length > 0) {
        await PageRow.insertMany(newRows.map((row: any) => ({ pageName: name, data: row })));
      }
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (page) {
        const oldRows = page.rows || [];
        const newRows = await processRowsConcurrently(rowsToProcess, 50, forceSave);
        page.rows = newRows;
      }
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'SHARP_UNSUPPORTED_FORMAT') {
      return res.status(400).json({ requiresConfirmation: true, error: "Unsupported image format detected. The system can only process standard images (JPG, PNG, WEBP, GIF, AVIF, TIFF). Do you want to force save this file as-is without processing?" });
    }
    res.status(500).json({ error: 'Failed to update rows' });
  }
});

app.patch('/api/pageRows/:name/:rowId', async (req, res) => {
  try {
    const { name, rowId } = req.params;
    const { updates } = req.body;
    const forceSave = req.query.force === 'true';

    if (isUsingMongoDB) {
      const allRows = await PageRow.find({ pageName: name });
      const rowToUpdate = allRows.find(r => String(r.data.id) === String(rowId));
      if (!rowToUpdate) {
        return res.status(404).json({ error: 'Row not found' });
      }

      const newRowData = { ...rowToUpdate.data, ...updates };
      const processedRow = await processRowImages(newRowData, forceSave);

      await PageRow.findByIdAndUpdate(rowToUpdate._id, { data: processedRow });
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (!page) return res.status(404).json({ error: 'Page not found' });

      const idx = page.rows?.findIndex((r: any) => String(r.id) === String(rowId));
      if (idx === undefined || idx === -1) {
        return res.status(404).json({ error: 'Row not found' });
      }

      const newRowData = { ...page.rows[idx], ...updates };
      const processedRow = await processRowImages(newRowData, forceSave);

      page.rows[idx] = processedRow;
      await saveLocalDB(db);
    }

    res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'SHARP_UNSUPPORTED_FORMAT') {
      return res.status(400).json({ requiresConfirmation: true, error: "Unsupported image format detected. The system can only process standard images (JPG, PNG, WEBP, GIF, AVIF, TIFF). Do you want to force save this file as-is without processing?" });
    }
    console.error("PATCH Row Error:", err);
    res.status(500).json({ error: 'Failed to update row' });
  }
});

app.post('/api/pageRows/:name/append', async (req, res) => {
  try {
    const { name } = req.params;
    const { rows } = req.body;
    const forceSave = req.query.force === 'true';

    const processedRows = await processRowsConcurrently(rows || [], 50, forceSave);

    if (isUsingMongoDB) {
      const recordsToInsert = processedRows.map(data => ({
        pageName: name,
        data
      }));
      if (recordsToInsert.length > 0) {
        await PageRow.insertMany(recordsToInsert);
      }
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (!page) return res.status(404).json({ error: 'Page not found' });
      page.rows = [...(page.rows || []), ...processedRows];
      await saveLocalDB(db);
    }
    
    res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'SHARP_UNSUPPORTED_FORMAT') {
      return res.status(400).json({ requiresConfirmation: true, error: "Unsupported image format detected. The system can only process standard images (JPG, PNG, WEBP, GIF, AVIF, TIFF). Do you want to force save this file as-is without processing?" });
    }
    console.error("POST Append Error:", err);
    res.status(500).json({ error: 'Failed to append rows' });
  }
});

app.delete('/api/pageRows/:name/:rowId', async (req, res) => {
  try {
    const { name, rowId } = req.params;

    if (isUsingMongoDB) {
      const allRows = await PageRow.find({ pageName: name });
      const rowToDelete = allRows.find(r => String(r.data.id) === String(rowId));
      if (!rowToDelete) {
        return res.status(404).json({ error: 'Row not found' });
      }
      await PageRow.findByIdAndDelete(rowToDelete._id);
    } else {
      const db = await getLocalDB();
      const page = db.pages.find((p: any) => p.name === name);
      if (!page) return res.status(404).json({ error: 'Page not found' });
      const rowToDelete = page.rows?.find((r: any) => String(r.id) === String(rowId));
      if (rowToDelete) {
        page.rows = page.rows.filter((r: any) => String(r.id) !== String(rowId));
        await saveLocalDB(db);
      }
    }
    
    res.json({ success: true });
  } catch (err: any) {
    console.error("DELETE Row Error:", err);
    res.status(500).json({ error: 'Failed to delete row' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { globalCopyBoxes, globalRowNoWidth, maxSearchHistory } = req.body;
    if (isUsingMongoDB) {
      await AppSettings.findOneAndUpdate({}, { globalCopyBoxes, globalRowNoWidth, maxSearchHistory }, { upsert: true });
    } else {
      const db = await getLocalDB();
      db.settings = { globalCopyBoxes, globalRowNoWidth, maxSearchHistory };
      await saveLocalDB(db);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    const newState = req.body;
    
    // Fix duplicate IDs across all pages first
    if (newState.pageRows) {
      for (const pageName in newState.pageRows) {
        const seenIds = new Set<string>();
        newState.pageRows[pageName] = (newState.pageRows[pageName] || []).map((row: any) => {
          if (!row.id || seenIds.has(String(row.id))) {
            row.id = uuidv4();
          }
          seenIds.add(String(row.id));
          return row;
        });
      }
    }

    // Repair tracker rows from source pages before processing
    if (newState.pageConfigs && newState.pageRows) {
      for (const [trackerName, trackerConfig] of Object.entries(newState.pageConfigs)) {
        const config = trackerConfig as any;
        if (config.linkedSourcePage && newState.pageRows[config.linkedSourcePage]) {
          const sourceRows = newState.pageRows[config.linkedSourcePage];
          
          if (!newState.pageRows[trackerName]) {
            newState.pageRows[trackerName] = [];
          }
          
          const trackerRowsMap = new Map();
          for (const tr of newState.pageRows[trackerName]) {
            if (tr.id) trackerRowsMap.set(String(tr.id), tr);
          }
          
          const repairedTrackerRows = sourceRows.map((sr: any) => {
            const existingTr = trackerRowsMap.get(String(sr.id));
            if (existingTr) {
              return { ...sr, ...existingTr };
            } else {
              return { ...sr, total_qty: "0" };
            }
          });
          
          newState.pageRows[trackerName] = repairedTrackerRows;
        }
      }
    }

    // Process all images in the new state
    const processedPageRows: Record<string, any[]> = {};
    const imageProcessingCache = new Map<string, Promise<string>>(); // Deduplication cache across all pages
    if (newState.pageRows) {
      for (const pageName in newState.pageRows) {
        processedPageRows[pageName] = await processRowsConcurrently(newState.pageRows[pageName], 50, true, imageProcessingCache);
      }
    }

    if (isUsingMongoDB) {
      // Fetch all existing rows to cleanup images
      const allOldPageRows = await PageRow.find({});
      const allOldRows = allOldPageRows.map(r => r.data);
      
      const allNewRows: any[] = [];
      for (const pageName in processedPageRows) {
        allNewRows.push(...processedPageRows[pageName]);
      }
      
      await cleanupOrphanImages(allOldRows, allNewRows, true);

      // Clear existing data
      await Page.deleteMany({});
      await PageRow.deleteMany({});
      await AppSettings.deleteMany({});
      
      // Insert new pages (without rows)
      const pagesToInsert = newState.pages.map((name: string) => ({
        name,
        config: newState.pageConfigs[name] || {}
      }));
      
      if (pagesToInsert.length > 0) {
        await Page.insertMany(pagesToInsert);
      }

      // Insert all rows
      const allRowsToInsert: any[] = [];
      newState.pages.forEach((pageName: string) => {
        const rows = processedPageRows[pageName] || [];
        rows.forEach((row: any) => {
          allRowsToInsert.push({ pageName, data: row });
        });
      });

      if (allRowsToInsert.length > 0) {
        await PageRow.insertMany(allRowsToInsert);
      }
      
      // Update settings
      await AppSettings.findOneAndUpdate({}, {
        globalCopyBoxes: newState.globalCopyBoxes,
        globalRowNoWidth: newState.globalRowNoWidth,
        maxSearchHistory: newState.maxSearchHistory
      }, { upsert: true });
    } else {
      const db = await getLocalDB();
      const allOldRows: any[] = [];
      db.pages.forEach((p: any) => {
        if (p.rows) allOldRows.push(...p.rows);
      });

      const allNewRows: any[] = [];
      for (const pageName in processedPageRows) {
        allNewRows.push(...processedPageRows[pageName]);
      }
      await cleanupOrphanImages(allOldRows, allNewRows, true);

      const newDb = {
        pages: newState.pages.map((name: string) => ({
          name,
          config: newState.pageConfigs[name] || {},
          rows: processedPageRows[name] || []
        })),
        settings: {
          globalCopyBoxes: newState.globalCopyBoxes,
          globalRowNoWidth: newState.globalRowNoWidth,
          maxSearchHistory: newState.maxSearchHistory
        }
      };
      await saveLocalDB(newDb);
    }
    
    // Clear processing cache to free up memory
    imageProcessingCache.clear();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Bulk sync error:', err);
    res.status(500).json({ error: 'Failed to sync state' });
  }
});

// Vite Middleware for Development
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
