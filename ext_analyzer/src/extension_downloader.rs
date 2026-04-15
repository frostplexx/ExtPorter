use flate2::read::GzDecoder;
use md5::{Digest, Md5};
use std::collections::{HashMap, VecDeque};
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
    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("Incomplete download: received {received}/{total} chunks")]
    IncompleteDownload { received: usize, total: usize },
}

/// Manages a chunked download in progress
pub struct ChunkedDownload {
    pub ext_id: String,
    pub total_size: usize,
    pub total_chunks: usize,
    pub expected_hash: String,
    pub dir_hash: String,
    received_chunks: HashMap<usize, Vec<u8>>,
    bytes_received: usize,
}

impl ChunkedDownload {
    /// Create a new chunked download
    pub fn new(
        ext_id: String,
        total_size: usize,
        total_chunks: usize,
        expected_hash: String,
        dir_hash: String,
    ) -> Self {
        Self {
            ext_id,
            total_size,
            total_chunks,
            expected_hash,
            dir_hash,
            received_chunks: HashMap::with_capacity(total_chunks),
            bytes_received: 0,
        }
    }

    /// Add a chunk to the download. Returns true if this was a new chunk.
    pub fn add_chunk(&mut self, chunk_index: usize, data: Vec<u8>) -> bool {
        if self.received_chunks.contains_key(&chunk_index) {
            return false; // Duplicate chunk
        }

        self.bytes_received += data.len();
        self.received_chunks.insert(chunk_index, data);
        true
    }

    /// Check if download is complete
    pub fn is_complete(&self) -> bool {
        self.received_chunks.len() == self.total_chunks
    }

    /// Get download progress (chunks_received, total_chunks, bytes_received, total_bytes)
    pub fn progress(&self) -> (usize, usize, usize, usize) {
        (
            self.received_chunks.len(),
            self.total_chunks,
            self.bytes_received,
            self.total_size,
        )
    }

    /// Finalize download: assemble chunks, verify hash, return full payload
    pub fn finalize(mut self) -> Result<(Vec<u8>, String), ExtractError> {
        if !self.is_complete() {
            return Err(ExtractError::IncompleteDownload {
                received: self.received_chunks.len(),
                total: self.total_chunks,
            });
        }

        // Assemble chunks in order
        let mut payload = Vec::with_capacity(self.total_size);
        for i in 0..self.total_chunks {
            if let Some(chunk) = self.received_chunks.remove(&i) {
                payload.extend(chunk);
            } else {
                return Err(ExtractError::IncompleteDownload {
                    received: self.received_chunks.len(),
                    total: self.total_chunks,
                });
            }
        }

        // Verify MD5 hash
        let mut hasher = Md5::new();
        hasher.update(&payload);
        let actual_hash = format!("{:x}", hasher.finalize());

        if actual_hash != self.expected_hash {
            return Err(ExtractError::HashMismatch {
                expected: self.expected_hash,
                actual: actual_hash,
            });
        }

        Ok((payload, self.dir_hash))
    }
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
            // Remove old entry and add updated one with new hash
            self.cache.remove(pos);
            self.cache.push_front((ext_id, mv2, mv3, hash));
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

    /// Invalidate cache entry for an extension.
    /// This should be called when the extension files on the server have changed
    /// (e.g., after an LLM fix) to force a fresh download.
    pub fn invalidate_cache(&mut self, ext_id: &str) {
        if let Some(pos) = self.cache.iter().position(|(id, _, _, _)| id == ext_id) {
            if let Some((_, old_mv2, _, _)) = self.cache.remove(pos) {
                // Delete the directory for invalidated extension
                if let Some(parent) = old_mv2.parent() {
                    let _ = std::fs::remove_dir_all(parent);
                }
                tracing::debug!("Invalidated cache for extension {}", ext_id);
            }
        }
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

    #[test]
    fn test_invalidate_cache_removes_entry() {
        let mut downloader = ExtensionDownloader::new().unwrap();

        // Manually add an entry to the cache for testing
        let ext_dir = downloader.temp_dir.path().join("test-ext");
        let mv2_dir = ext_dir.join("mv2");
        let mv3_dir = ext_dir.join("mv3");
        std::fs::create_dir_all(&mv2_dir).unwrap();
        std::fs::create_dir_all(&mv3_dir).unwrap();

        // Add to cache using the internal method through add_to_cache behavior
        downloader.cache.push_front((
            "test-ext".to_string(),
            mv2_dir.clone(),
            mv3_dir.clone(),
            "hash123".to_string(),
        ));

        assert!(downloader.is_cached("test-ext"));
        assert_eq!(downloader.cache_size(), 1);

        // Invalidate the cache
        downloader.invalidate_cache("test-ext");

        assert!(!downloader.is_cached("test-ext"));
        assert_eq!(downloader.cache_size(), 0);
    }

    #[test]
    fn test_invalidate_cache_deletes_directory() {
        let mut downloader = ExtensionDownloader::new().unwrap();

        // Create a directory structure
        let ext_dir = downloader.temp_dir.path().join("test-ext-2");
        let mv2_dir = ext_dir.join("mv2");
        let mv3_dir = ext_dir.join("mv3");
        std::fs::create_dir_all(&mv2_dir).unwrap();
        std::fs::create_dir_all(&mv3_dir).unwrap();

        // Create a test file in the directory
        std::fs::write(mv2_dir.join("test.txt"), "test content").unwrap();

        // Add to cache
        downloader.cache.push_front((
            "test-ext-2".to_string(),
            mv2_dir.clone(),
            mv3_dir.clone(),
            "hash456".to_string(),
        ));

        assert!(ext_dir.exists());

        // Invalidate the cache
        downloader.invalidate_cache("test-ext-2");

        // Directory should be deleted
        assert!(!ext_dir.exists());
    }

    #[test]
    fn test_invalidate_cache_nonexistent_entry() {
        let mut downloader = ExtensionDownloader::new().unwrap();

        // Should not panic when invalidating a non-existent entry
        downloader.invalidate_cache("nonexistent");

        assert_eq!(downloader.cache_size(), 0);
    }

    #[test]
    fn test_get_cached_hash() {
        let mut downloader = ExtensionDownloader::new().unwrap();

        let ext_dir = downloader.temp_dir.path().join("test-hash-ext");
        let mv2_dir = ext_dir.join("mv2");
        let mv3_dir = ext_dir.join("mv3");
        std::fs::create_dir_all(&mv2_dir).unwrap();
        std::fs::create_dir_all(&mv3_dir).unwrap();

        downloader.cache.push_front((
            "test-hash-ext".to_string(),
            mv2_dir,
            mv3_dir,
            "my-hash-123".to_string(),
        ));

        assert_eq!(
            downloader.get_cached_hash("test-hash-ext"),
            Some("my-hash-123".to_string())
        );
        assert_eq!(downloader.get_cached_hash("nonexistent"), None);
    }

    #[test]
    fn test_touch_cached_moves_to_front() {
        let mut downloader = ExtensionDownloader::new().unwrap();

        // Add two entries
        let ext1_dir = downloader.temp_dir.path().join("ext1");
        let ext2_dir = downloader.temp_dir.path().join("ext2");
        std::fs::create_dir_all(ext1_dir.join("mv2")).unwrap();
        std::fs::create_dir_all(ext1_dir.join("mv3")).unwrap();
        std::fs::create_dir_all(ext2_dir.join("mv2")).unwrap();
        std::fs::create_dir_all(ext2_dir.join("mv3")).unwrap();

        downloader.cache.push_front((
            "ext1".to_string(),
            ext1_dir.join("mv2"),
            ext1_dir.join("mv3"),
            "hash1".to_string(),
        ));
        downloader.cache.push_front((
            "ext2".to_string(),
            ext2_dir.join("mv2"),
            ext2_dir.join("mv3"),
            "hash2".to_string(),
        ));

        // ext2 is at front, ext1 is at back
        assert_eq!(downloader.cache.front().unwrap().0, "ext2");

        // Touch ext1 to move it to front
        downloader.touch_cached("ext1");

        assert_eq!(downloader.cache.front().unwrap().0, "ext1");
    }
}
