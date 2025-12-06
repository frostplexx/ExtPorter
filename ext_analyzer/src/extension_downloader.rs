use flate2::read::GzDecoder;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use tar::Archive;
use tempfile::TempDir;
use thiserror::Error;

const MAX_CACHED_EXTENSIONS: usize = 5;

#[derive(Debug, Error)]
pub enum ExtractError {
    #[error("Invalid archive format: {0}")]
    InvalidFormat(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Manages downloading and caching of extensions in a temporary directory.
/// Implements LRU caching with a maximum of 5 extensions.
pub struct ExtensionDownloader {
    temp_dir: TempDir,
    /// LRU cache: (ext_id, mv2_path, mv3_path, hash)
    cache: VecDeque<(String, PathBuf, PathBuf, String)>,
}

impl ExtensionDownloader {
    /// Create a new ExtensionDownloader with a temporary directory
    pub fn new() -> Result<Self, std::io::Error> {
        let temp_dir = TempDir::with_prefix("extporter_")?;
        Ok(Self {
            temp_dir,
            cache: VecDeque::with_capacity(MAX_CACHED_EXTENSIONS),
        })
    }

    /// Extract extension from binary data received from server.
    /// Format: [4B mv2_size][mv2.tar.gz][4B mv3_size][mv3.tar.gz]
    pub fn extract_extension(
        &mut self,
        ext_id: &str,
        data: &[u8],
        hash: &str,
    ) -> Result<(PathBuf, PathBuf), ExtractError> {
        if data.len() < 8 {
            return Err(ExtractError::InvalidFormat("Data too short".into()));
        }

        // Parse header
        let mv2_size = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let mv3_size = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;

        let expected_len = 8 + mv2_size + mv3_size;
        if data.len() < expected_len {
            return Err(ExtractError::InvalidFormat(format!(
                "Expected {} bytes, got {}",
                expected_len,
                data.len()
            )));
        }

        // Extract archives
        let mv2_data = &data[8..8 + mv2_size];
        let mv3_data = &data[8 + mv2_size..8 + mv2_size + mv3_size];

        // Create extraction directories
        let ext_dir = self.temp_dir.path().join(ext_id);
        let mv2_dir = ext_dir.join("mv2");
        let mv3_dir = ext_dir.join("mv3");

        // Remove existing directories if they exist
        if ext_dir.exists() {
            std::fs::remove_dir_all(&ext_dir)?;
        }

        std::fs::create_dir_all(&mv2_dir)?;
        std::fs::create_dir_all(&mv3_dir)?;

        // Extract MV2
        Self::extract_tar_gz(mv2_data, &mv2_dir)?;

        // Extract MV3
        Self::extract_tar_gz(mv3_data, &mv3_dir)?;

        // Update cache (LRU eviction)
        self.add_to_cache(
            ext_id.to_string(),
            mv2_dir.clone(),
            mv3_dir.clone(),
            hash.to_string(),
        );

        Ok((mv2_dir, mv3_dir))
    }

    /// Extract a tar.gz archive to a destination directory
    fn extract_tar_gz(data: &[u8], dest: &Path) -> Result<(), ExtractError> {
        let decoder = GzDecoder::new(data);
        let mut archive = Archive::new(decoder);
        archive.unpack(dest)?;
        Ok(())
    }

    /// Add entry to cache with LRU eviction
    fn add_to_cache(&mut self, ext_id: String, mv2: PathBuf, mv3: PathBuf, hash: String) {
        // Check if already in cache
        if let Some(pos) = self.cache.iter().position(|(id, _, _, _)| id == &ext_id) {
            // Move to front (most recently used)
            let entry = self.cache.remove(pos).unwrap();
            self.cache.push_front(entry);
            return;
        }

        // Evict oldest if at capacity
        while self.cache.len() >= MAX_CACHED_EXTENSIONS {
            if let Some((old_id, old_mv2, _, _)) = self.cache.pop_back() {
                // Delete the directory for evicted extension
                if let Some(parent) = old_mv2.parent() {
                    let _ = std::fs::remove_dir_all(parent);
                }
                tracing::debug!("Evicted extension {} from cache", old_id);
            }
        }

        // Add new entry
        self.cache.push_front((ext_id, mv2, mv3, hash));
    }

    /// Get cached paths for an extension
    pub fn get_cached(&self, ext_id: &str) -> Option<(PathBuf, PathBuf)> {
        self.cache
            .iter()
            .find(|(id, _, _, _)| id == ext_id)
            .map(|(_, mv2, mv3, _)| (mv2.clone(), mv3.clone()))
    }

    /// Get hash for cached extension (for server comparison)
    pub fn get_cached_hash(&self, ext_id: &str) -> Option<String> {
        self.cache
            .iter()
            .find(|(id, _, _, _)| id == ext_id)
            .map(|(_, _, _, hash)| hash.clone())
    }

    /// Mark extension as still valid (hash matched server) - moves to front of LRU cache
    pub fn touch_cached(&mut self, ext_id: &str) {
        if let Some(pos) = self.cache.iter().position(|(id, _, _, _)| id == ext_id) {
            let entry = self.cache.remove(pos).unwrap();
            self.cache.push_front(entry);
        }
    }

    /// Check if extension is cached
    pub fn is_cached(&self, ext_id: &str) -> bool {
        self.cache.iter().any(|(id, _, _, _)| id == ext_id)
    }

    /// Get temp directory path (for debug)
    #[allow(dead_code)]
    pub fn temp_path(&self) -> &Path {
        self.temp_dir.path()
    }

    /// Get number of cached extensions
    #[allow(dead_code)]
    pub fn cache_size(&self) -> usize {
        self.cache.len()
    }
}

// TempDir is automatically cleaned up when ExtensionDownloader is dropped

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_downloader() {
        let downloader = ExtensionDownloader::new();
        assert!(downloader.is_ok());
        let downloader = downloader.unwrap();
        assert!(downloader.temp_path().exists());
    }

    #[test]
    fn test_invalid_data() {
        let mut downloader = ExtensionDownloader::new().unwrap();
        let result = downloader.extract_extension("test", &[0, 1, 2], "hash");
        assert!(result.is_err());
    }
}
