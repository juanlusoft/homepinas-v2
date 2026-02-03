/**
 * HomePiNAS v2 - File Station Routes
 * Web file manager for browsing/managing files on NAS storage at /mnt/storage
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { requireAuth } = require('../middleware/auth');
const { logSecurityEvent } = require('../utils/security');
const { sanitizePathWithinBase } = require('../utils/sanitize');

// Base storage directory - all operations are confined here
const STORAGE_BASE = '/mnt/storage';

// MIME type mapping based on file extension
const MIME_TYPES = {
  '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.csv': 'text/csv',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.tiff': 'image/tiff',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime', '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.tar': 'application/x-tar',
  '.gz': 'application/gzip', '.7z': 'application/x-7z-compressed',
  '.rar': 'application/x-rar-compressed', '.bz2': 'application/x-bzip2',
  '.iso': 'application/x-iso9660-image',
  '.sh': 'application/x-sh', '.py': 'text/x-python',
  '.log': 'text/plain', '.md': 'text/markdown', '.yaml': 'text/yaml',
  '.yml': 'text/yaml', '.ini': 'text/plain', '.conf': 'text/plain',
};

/**
 * Guess MIME type from file extension
 */
function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Validate a path is within /mnt/storage. Returns sanitized path or sends 400 error.
 * Returns null if invalid (caller should return early).
 */
function validatePath(inputPath, res) {
  // Treat '/' or empty as root of storage
  let relativePath = inputPath || '/';
  if (relativePath === '/') relativePath = '.';
  // Remove leading slash to make it relative to STORAGE_BASE
  if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);
  
  const sanitized = sanitizePathWithinBase(relativePath, STORAGE_BASE);
  if (sanitized === null) {
    res.status(400).json({ error: 'Invalid path: must be within storage directory' });
    return null;
  }
  return sanitized;
}

/**
 * Recursive file search by name within a directory
 */
function searchFiles(dir, query, results, maxResults) {
  if (results.length >= maxResults) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxResults) return;

      const fullPath = path.join(dir, entry.name);
      // Check if the filename matches the query (case-insensitive)
      if (entry.name.toLowerCase().includes(query.toLowerCase())) {
        const relativePath = path.relative(STORAGE_BASE, fullPath);
        try {
          const stat = fs.statSync(fullPath);
          results.push({
            name: entry.name,
            path: '/' + relativePath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat.size,
            modified: stat.mtime,
          });
        } catch {
          // Skip files we can't stat
        }
      }

      // Recurse into subdirectories
      if (entry.isDirectory()) {
        searchFiles(fullPath, query, results, maxResults);
      }
    }
  } catch {
    // Skip directories we can't read
  }
}

// Configure multer to use temp directory first, then move to target
// (req.body.path may not be available when multer processes the file in multipart)
const os = require('os');
const tmpUploadDir = path.join(os.tmpdir(), 'homepinas-uploads');
if (!fs.existsSync(tmpUploadDir)) fs.mkdirSync(tmpUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tmpUploadDir);
  },
  filename: (req, file, cb) => {
    // Unique temp name to avoid collisions
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB per file
  },
});

// All routes require authentication
router.use(requireAuth);

/**
 * GET /list?path=/
 * List directory contents with file metadata
 */
router.get('/list', (req, res) => {
  try {
    const inputPath = req.query.path || '/';
    const dirPath = validatePath(inputPath, res);
    if (dirPath === null) return;

    // Verify the path is a directory
    if (!fs.existsSync(dirPath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }
    const dirStat = fs.statSync(dirPath);
    if (!dirStat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(dirPath);
    const items = [];

    for (const entry of entries) {
      try {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);
        items.push({
          name: entry,
          size: stat.size,
          type: stat.isDirectory() ? 'directory' : 'file',
          modified: stat.mtime,
          permissions: '0' + (stat.mode & parseInt('777', 8)).toString(8),
        });
      } catch {
        // Skip entries we can't stat (broken symlinks, permission issues)
        items.push({
          name: entry,
          size: 0,
          type: 'unknown',
          modified: null,
          permissions: null,
        });
      }
    }

    // Sort: directories first, then alphabetically
    items.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    const relativePath = '/' + path.relative(STORAGE_BASE, dirPath);
    res.json({
      path: relativePath === '/.' ? '/' : relativePath,
      items,
      count: items.length,
    });
  } catch (err) {
    console.error('File list error:', err.message);
    res.status(500).json({ error: 'Failed to list directory' });
  }
});

/**
 * GET /download?path=/some/file.txt
 * Download a file from storage
 */
router.get('/download', (req, res) => {
  try {
    const inputPath = req.query.path;
    if (!inputPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }

    const filePath = validatePath(inputPath, res);
    if (filePath === null) return;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download a directory' });
    }

    logSecurityEvent('file_download', req.user.username, { path: inputPath });
    res.download(filePath);
  } catch (err) {
    console.error('File download error:', err.message);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

/**
 * POST /upload
 * Upload files to a directory within /mnt/storage
 * Body: path (target directory), files (multipart)
 */
router.post('/upload', (req, res) => {
  // Use multer middleware inline - handle up to 10 files at once
  upload.array('files', 10)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 2GB)' });
      }
      console.error('Upload error:', err.message);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Now req.body.path is available — move files from temp to target
    const uploadPath = req.body.path || '/';
    let targetDir;

    // Handle root path
    if (uploadPath === '/' || uploadPath === '') {
      targetDir = STORAGE_BASE;
    } else {
      targetDir = sanitizePathWithinBase(uploadPath, STORAGE_BASE);
    }

    if (!targetDir) {
      // Clean up temp files
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e) {} });
      return res.status(400).json({ error: 'Invalid upload directory' });
    }

    if (!fs.existsSync(targetDir)) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e) {} });
      return res.status(400).json({ error: 'Upload directory does not exist' });
    }

    // Move each file from temp to target
    const movedFiles = [];
    for (const f of req.files) {
      const destPath = path.join(targetDir, f.originalname);
      try {
        fs.renameSync(f.path, destPath);
        movedFiles.push({ name: f.originalname, size: f.size, path: path.relative(STORAGE_BASE, destPath) });
      } catch (moveErr) {
        // Try copy+delete if rename fails (cross-device)
        try {
          fs.copyFileSync(f.path, destPath);
          fs.unlinkSync(f.path);
          movedFiles.push({ name: f.originalname, size: f.size, path: path.relative(STORAGE_BASE, destPath) });
        } catch (copyErr) {
          console.error('Move file error:', copyErr.message);
        }
      }
    }

    logSecurityEvent('file_upload', req.user.username, {
      path: uploadPath,
      files: movedFiles.map(f => f.name),
    });

    res.json({
      message: `${movedFiles.length} file(s) uploaded successfully`,
      files: movedFiles,
    });
  });
});

/**
 * POST /mkdir
 * Create a new directory
 * Body: { path: "/new/directory" }
 */
router.post('/mkdir', (req, res) => {
  try {
    const inputPath = req.body.path;
    if (!inputPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }

    const dirPath = validatePath(inputPath, res);
    if (dirPath === null) return;

    if (fs.existsSync(dirPath)) {
      return res.status(409).json({ error: 'Directory already exists' });
    }

    fs.mkdirSync(dirPath, { recursive: true });
    logSecurityEvent('dir_create', req.user.username, { path: inputPath });

    res.json({ message: 'Directory created', path: inputPath });
  } catch (err) {
    console.error('Mkdir error:', err.message);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

/**
 * POST /rename
 * Rename a file or folder
 * Body: { oldPath: "/old/name", newPath: "/new/name" }
 */
router.post('/rename', (req, res) => {
  try {
    const { oldPath: oldInput, newPath: newInput } = req.body;
    if (!oldInput || !newInput) {
      return res.status(400).json({ error: 'Both oldPath and newPath are required' });
    }

    const oldPath = validatePath(oldInput, res);
    if (oldPath === null) return;
    const newPath = sanitizePathWithinBase(newInput, STORAGE_BASE);
    if (newPath === null) {
      return res.status(400).json({ error: 'Invalid new path: must be within storage directory' });
    }

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'Source path not found' });
    }
    if (fs.existsSync(newPath)) {
      return res.status(409).json({ error: 'Destination already exists' });
    }

    fs.renameSync(oldPath, newPath);
    logSecurityEvent('file_rename', req.user.username, { from: oldInput, to: newInput });

    res.json({ message: 'Renamed successfully', from: oldInput, to: newInput });
  } catch (err) {
    console.error('Rename error:', err.message);
    res.status(500).json({ error: 'Failed to rename' });
  }
});

/**
 * POST /delete
 * Delete a file or folder
 * Body: { path: "/file/to/delete" }
 */
router.post('/delete', (req, res) => {
  try {
    const inputPath = req.body.path;
    if (!inputPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }

    const targetPath = validatePath(inputPath, res);
    if (targetPath === null) return;

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    // Prevent deleting the storage root
    if (targetPath === STORAGE_BASE) {
      return res.status(403).json({ error: 'Cannot delete storage root' });
    }

    const stat = fs.statSync(targetPath);
    fs.rmSync(targetPath, { recursive: true, force: true });
    logSecurityEvent('file_delete', req.user.username, {
      path: inputPath,
      type: stat.isDirectory() ? 'directory' : 'file',
    });

    res.json({ message: 'Deleted successfully', path: inputPath });
  } catch (err) {
    console.error('Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/**
 * POST /move
 * Move a file or folder to a new location
 * Body: { source: "/path/to/source", destination: "/path/to/dest" }
 */
router.post('/move', (req, res) => {
  try {
    const { source: srcInput, destination: destInput } = req.body;
    if (!srcInput || !destInput) {
      return res.status(400).json({ error: 'Both source and destination are required' });
    }

    const sourcePath = validatePath(srcInput, res);
    if (sourcePath === null) return;
    const destPath = sanitizePathWithinBase(destInput, STORAGE_BASE);
    if (destPath === null) {
      return res.status(400).json({ error: 'Invalid destination: must be within storage directory' });
    }

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source not found' });
    }

    fs.renameSync(sourcePath, destPath);
    logSecurityEvent('file_move', req.user.username, { from: srcInput, to: destInput });

    res.json({ message: 'Moved successfully', from: srcInput, to: destInput });
  } catch (err) {
    console.error('Move error:', err.message);
    res.status(500).json({ error: 'Failed to move' });
  }
});

/**
 * POST /copy
 * Copy a file or folder
 * Body: { source: "/path/to/source", destination: "/path/to/dest" }
 */
router.post('/copy', (req, res) => {
  try {
    const { source: srcInput, destination: destInput } = req.body;
    if (!srcInput || !destInput) {
      return res.status(400).json({ error: 'Both source and destination are required' });
    }

    const sourcePath = validatePath(srcInput, res);
    if (sourcePath === null) return;
    const destPath = sanitizePathWithinBase(destInput, STORAGE_BASE);
    if (destPath === null) {
      return res.status(400).json({ error: 'Invalid destination: must be within storage directory' });
    }

    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: 'Source not found' });
    }

    fs.cpSync(sourcePath, destPath, { recursive: true });
    logSecurityEvent('file_copy', req.user.username, { from: srcInput, to: destInput });

    res.json({ message: 'Copied successfully', from: srcInput, to: destInput });
  } catch (err) {
    console.error('Copy error:', err.message);
    res.status(500).json({ error: 'Failed to copy' });
  }
});

/**
 * GET /info?path=/some/file.txt
 * Get detailed file info including stat data and MIME type
 */
router.get('/info', (req, res) => {
  try {
    const inputPath = req.query.path;
    if (!inputPath) {
      return res.status(400).json({ error: 'Path parameter required' });
    }

    const filePath = validatePath(inputPath, res);
    if (filePath === null) return;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(filePath);
    const relativePath = '/' + path.relative(STORAGE_BASE, filePath);

    res.json({
      name: path.basename(filePath),
      path: relativePath,
      type: stat.isDirectory() ? 'directory' : 'file',
      mimeType: stat.isDirectory() ? null : guessMimeType(filePath),
      size: stat.size,
      created: stat.birthtime,
      modified: stat.mtime,
      accessed: stat.atime,
      permissions: '0' + (stat.mode & parseInt('777', 8)).toString(8),
      owner: stat.uid,
      group: stat.gid,
      isSymlink: fs.lstatSync(filePath).isSymbolicLink(),
    });
  } catch (err) {
    console.error('File info error:', err.message);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

/**
 * GET /search?path=/&query=filename
 * Recursive search by filename within a directory. Max 100 results.
 */
router.get('/search', (req, res) => {
  try {
    const inputPath = req.query.path || '/';
    const query = req.query.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchDir = validatePath(inputPath, res);
    if (searchDir === null) return;

    if (!fs.existsSync(searchDir) || !fs.statSync(searchDir).isDirectory()) {
      return res.status(404).json({ error: 'Search directory not found' });
    }

    const MAX_RESULTS = 100;
    const results = [];
    searchFiles(searchDir, query.trim(), results, MAX_RESULTS);

    res.json({
      query: query.trim(),
      searchPath: inputPath,
      results,
      count: results.length,
      truncated: results.length >= MAX_RESULTS,
    });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
