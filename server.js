const { Throttle } = require('stream-throttle');
const ipDownloadMap = new Map();
const express = require('express');
const fs = require('fs').promises;
const createReadStream = require('fs').createReadStream;
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const port = 3069;
app.use(cors());

const BASE_DIR = path.resolve('/srv/html/dl.kxtz.dev/files');

function sanitizePath(relativePath) {
  const sanitizedPath = path.normalize(relativePath || '').replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(BASE_DIR, sanitizedPath);

  if (!fullPath.startsWith(BASE_DIR)) {
    throw new Error('Invalid path');
  }

  return fullPath;
}

function registerDownload(ip, route, limit) {
  const now = Date.now();
  if (!ipDownloadMap.has(ip)) ipDownloadMap.set(ip, []);
  const events = ipDownloadMap.get(ip);

  events.push({ time: now, route });

  const cutoff = now - 5 * 60 * 1000;
  const recent = events.filter(e => e.time > cutoff);
  ipDownloadMap.set(ip, recent);

  const count = recent.filter(e => e.route === route).length;
  return count > limit;
}


function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(2)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(2)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}

async function getFileMetadata(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const metadata = await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.')) return null;

        const fullPath = path.join(dirPath, entry.name);
        let size = null;

        if (entry.isDirectory()) {
          try {
            size = await executeCommand(`du -sb "${fullPath}" | cut -f1`);
            size = formatSize(Number(size));
          } catch (error) {
            console.error(`Error getting size for ${fullPath}:`, error);
            size = 'N/A';
          }
        } else {
          try {
            const stats = await fs.stat(fullPath);
            size = formatSize(stats.size);
          } catch (error) {
            console.error(`Error getting file stats for ${fullPath}:`, error);
            size = 'N/A';
          }
        }

	const modified = new Date((await fs.stat(fullPath)).mtime).toLocaleString("en-US", {
		  hour: "2-digit",
		  minute: "2-digit",
		  hour12: true,
		  day: "2-digit",
		  month: "2-digit",
		  year: "numeric",
	}).replace(",", "");

        return {
          name: entry.name,
          modified,
	  size,
          type: entry.isDirectory() ? 'folder' : 'file',
        };
      })
    );

    return metadata.filter(Boolean).sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'folder' ? -1 : 1;
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    throw new Error('Unable to read directory');
  }
}

app.get('/api/v1/files', async (req, res) => {
  try {
    const dirPath = sanitizePath(req.query.path);
    const metadata = await getFileMetadata(dirPath);
    if (metadata.length === 0) {
      return res.status(404).json({ error: 'Directory is empty' });
    }
    res.json(metadata);
  } catch (error) {
    console.error('Error processing request:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/v1/download', async (req, res) => {
  try {
    const filePath = sanitizePath(req.query.path);
    await fs.access(filePath);

    const ip = req.socket.remoteAddress;
    const shouldThrottle = registerDownload(ip, 'download', 5);

    if (shouldThrottle) {
      console.log(`Throttling /api/v1/download for ${ip}`);
      const stream = createReadStream(filePath);
      const throttle = new Throttle({ rate: 5 * 1024 * 1024 }); // 5 Mbps
      res.attachment(path.basename(filePath));
      stream.pipe(throttle).pipe(res);
    } else {
      res.download(filePath);
    }
  } catch (error) {
    console.error('Error downloading file:', error.message);
    res.status(404).json({ error: 'File not found' });
  }
});


app.get('/api/v1/raw', async (req, res) => {
  try {
    const filePath = sanitizePath(req.query.path);
    await fs.access(filePath);

    const ip = req.socket.remoteAddress;
    const shouldThrottle = registerDownload(ip, 'raw', 30);

    const stream = createReadStream(filePath);
    res.type('text/plain');

    if (shouldThrottle) {
      console.log(`Throttling /api/v1/raw for ${ip}`);
      const throttle = new Throttle({ rate: 5 * 1024 * 1024 }); // 5 Mbps
      stream.pipe(throttle).pipe(res);
    } else {
      stream.pipe(res);
    }
  } catch (error) {
    console.error('Error reading file:', error.message);
    res.status(500).json({ error: 'Error reading file' });
  }
});


app.get('/', async (req, res) => {
  const now = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
  });

  const ip = req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  console.log(`[${now}] DIRECT ACCESS FROM ${ip} WITH USER AGENT ${userAgent}`);

  res.redirect(301, 'https://kxtz.dev');
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

