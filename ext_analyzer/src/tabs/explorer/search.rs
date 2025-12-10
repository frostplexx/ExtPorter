use crate::types::Extension;

pub fn filter_extensions<'a>(
    extensions: &'a [Extension],
    search_query: &str,
) -> Vec<&'a Extension> {
    extensions
        .iter()
        .filter(|ext| {
            search_query.is_empty()
                || ext
                    .name
                    .to_lowercase()
                    .contains(&search_query.to_lowercase())
                || ext
                    .get_id()
                    .to_lowercase()
                    .contains(&search_query.to_lowercase())
                || ext
                    .tags
                    .iter()
                    .any(|t| t.to_lowercase().contains(&search_query.to_lowercase()))
        })
        .collect()
}

#[derive(Clone, Copy)]
pub enum SortBy {
    Interestingness,
    Name,
    Version,
}

impl SortBy {
    pub fn next(&self) -> Self {
        match self {
            SortBy::Interestingness => SortBy::Name,
            SortBy::Name => SortBy::Version,
            SortBy::Version => SortBy::Interestingness,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            SortBy::Interestingness => "interestingness",
            SortBy::Name => "name",
            SortBy::Version => "version",
        }
    }
}

pub fn sort_extensions(extensions: &mut Vec<&Extension>, sort_by: SortBy, search_query: &str) {
    match sort_by {
        SortBy::Interestingness => {
            // Already sorted by server, but re-sort if search filtered the list
            if !search_query.is_empty() {
                extensions.sort_by(|a, b| {
                    b.interestingness
                        .unwrap_or(0.0)
                        .partial_cmp(&a.interestingness.unwrap_or(0.0))
                        .unwrap()
                });
            }
        }
        SortBy::Name => {
            extensions.sort_by(|a, b| a.name.cmp(&b.name));
        }
        SortBy::Version => {
            extensions.sort_by(|a, b| {
                a.version
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.version.as_deref().unwrap_or(""))
            });
        }
    }
}
