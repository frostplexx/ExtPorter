use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use ratatui_image::picker::Picker;
use ratatui_image::protocol::StatefulProtocol;
use image::DynamicImage;

/// Manages image downloading and caching for extension screenshots
pub struct ImageHandler {
    /// Thread-safe cache mapping image URLs to their downloaded DynamicImages
    cache: Arc<Mutex<HashMap<String, DynamicImage>>>,
    /// Track which extension we're currently downloading for (to avoid duplicates)
    downloading_for_ext: Option<String>,
    /// Protocol picker for rendering images
    picker: Option<Picker>,
}

impl ImageHandler {
    pub fn new() -> Self {
        // Create a picker
        let picker = Picker::from_query_stdio().ok();
        
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
            downloading_for_ext: None,
            picker,
        }
    }

    /// Start downloading images for the given extension asynchronously
    /// Downloads all images from the provided URLs
    pub fn start_downloading(&mut self, ext_id: String, image_urls: Vec<String>) {
        // Don't re-download if already downloading for this extension
        if self.downloading_for_ext.as_ref() == Some(&ext_id) {
            return;
        }
        
        self.downloading_for_ext = Some(ext_id.clone());
        
        let cache = self.cache.clone();
        
        // Spawn async task to download images via HTTP
        tokio::spawn(async move {
            let client = match reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .build() 
            {
                Ok(c) => c,
                Err(_) => return,
            };
            
            // Download all images
            for url in image_urls.iter() {
                match client.get(url).send().await {
                    Ok(response) => {
                        if response.status().is_success() {
                            if let Ok(bytes) = response.bytes().await {
                                // Try to load the image
                                if let Ok(img) = image::load_from_memory(&bytes) {
                                    // Cache the image
                                    if let Ok(mut cache) = cache.lock() {
                                        cache.insert(url.clone(), img);
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {},
                }
                
                // Small delay between requests to be polite
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
        });
    }

    /// Check if images are ready for a given set of URLs
    #[allow(dead_code)]
    pub fn images_ready(&self, urls: &[String]) -> bool {
        if let Ok(cache) = self.cache.lock() {
            urls.iter().any(|url| cache.contains_key(url))
        } else {
            false
        }
    }

    /// Create a StatefulProtocol for rendering an image at a URL
    /// Returns None if the image is not cached or picker is unavailable
    pub fn create_protocol(&mut self, url: &str) -> Option<StatefulProtocol> {
        let picker = self.picker.as_mut()?;
        let cache = self.cache.lock().ok()?;
        let img = cache.get(url)?.clone();
        drop(cache); // Release lock before creating protocol
        
        // Create a new protocol instance for this image
        // The picker will handle resizing automatically based on the widget's area
        Some(picker.new_resize_protocol(img))
    }
    
    /// Get the cached DynamicImage for a URL
    #[allow(dead_code)]
    pub fn get_image(&self, url: &str) -> Option<DynamicImage> {
        let cache = self.cache.lock().ok()?;
        cache.get(url).cloned()
    }

    /// Reset the downloading state for a new extension
    pub fn reset_for_extension(&mut self, _ext_id: String) {
        self.downloading_for_ext = None;
    }

    /// Clear all cached images
    #[allow(dead_code)]
    pub fn clear_cache(&mut self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.clear();
        }
        self.downloading_for_ext = None;
    }

    /// Get the number of cached images
    #[allow(dead_code)]
    pub fn cache_size(&self) -> usize {
        self.cache.lock().map(|c| c.len()).unwrap_or(0)
    }
    
    /// Check if the terminal supports image rendering
    #[allow(dead_code)]
    pub fn supports_images(&self) -> bool {
        self.picker.is_some()
    }
}

impl Default for ImageHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_handler_creation() {
        let handler = ImageHandler::new();
        assert_eq!(handler.cache_size(), 0);
        assert!(handler.downloading_for_ext.is_none());
    }

    #[test]
    fn test_clear_cache() {
        let mut handler = ImageHandler::new();
        handler.downloading_for_ext = Some("test-ext".to_string());
        handler.clear_cache();
        assert_eq!(handler.cache_size(), 0);
        assert!(handler.downloading_for_ext.is_none());
    }
}
