const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const port = 3069;
app.use(cors());

const BASE_DIR = path.resolve('/srv/html/dl.kxtz.dev/files');

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

async function getFileMetadata(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const filesAndDirs = await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.')) return null;

        const fullPath = path.join(dirPath, entry.name);

        try {
          const stats = await fs.stat(fullPath);
          const size = await executeCommand(`du -sh "${fullPath}" | cut -f1`);

          return {
            name: entry.name,
            modified: new Date(stats.mtime).toLocaleString(),
            size,
            type: entry.isDirectory() ? 'folder' : 'file',
          };
        } catch (error) {
          console.error(`Error getting size for ${fullPath}:`, error);
          return null;
        }
      })
    );

    const validResults = filesAndDirs.filter(Boolean);

    return validResults.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'folder' ? -1 : 1;
    });
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
}

app.get('/api/v1/files', async (req, res) => {
  const userPath = path.join(BASE_DIR, req.query.path || '');

  try {
    const metadata = await getFileMetadata(userPath);
    if (metadata.length === 0) {
      return res.status(400).json({ error: "Empty directory" });
    }

    res.json(metadata);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/v1/download', async (req, res) => {
  const userPath = path.join(BASE_DIR, req.query.path || '');

  try {
    await fs.access(userPath);
    res.download(userPath);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

